import { lazy, Suspense, useCallback, useEffect, useReducer, useRef, useState } from "react";

import type { RecentFile, RecoveryDraft, SaveMode } from "../bridge/contracts";
import {
  answerQuitRequest,
  clearRecentFiles,
  closeCurrentWindow,
  createDocumentWindow,
  deleteDraft,
  exportPdf,
  focusExistingDocumentWindow,
  inspectDocument,
  isTauriRuntime,
  listDrafts,
  listRecentFiles,
  onCloseRequested,
  onDocumentFileEvent,
  onMenuCommand,
  onNavigateDocumentHeading,
  onOpenDocumentPaths,
  onQuitRequested,
  onWindowFileDrop,
  openDocumentWindowAt,
  openDocumentWindows,
  openExternalUrl,
  pickExportSavePath,
  pickMarkdownFiles,
  pickMarkdownSavePath,
  readDocument,
  removeRecentFile,
  resolveMarkdownLink,
  saveDocument,
  setWindowDocument,
  setWindowTitle,
  stopDocumentWatch,
  takePendingHeadingFragment,
  takePendingOpenPaths,
  watchDocument,
  writeExportDocument,
  writeDraft
} from "../bridge/tauriClient";
import { DecisionDialog, type DecisionSpec } from "../components/DecisionDialog";
import { FindBar } from "../components/FindBar";
import { HistorySidebar } from "../components/HistorySidebar";
import { StatusBanner } from "../components/StatusBanner";
import { TitleBar } from "../components/TitleBar";
import type { FindResult, MarkdownEditorHandle } from "../editor/MarkdownEditor";
import { createExportHtml } from "../editor/exportDocument";
import { EditorErrorBoundary } from "../components/EditorErrorBoundary";
import {
  createFileSession,
  createUntitledSession,
  documentSessionReducer,
  type DocumentSession
} from "./documentSession";

type DecisionState = {
  spec: DecisionSpec;
  resolve: (value: string) => void;
};

const emptyFindResult: FindResult = { current: 0, total: 0 };
const MarkdownEditor = lazy(() => import("../editor/MarkdownEditor").then((module) => ({ default: module.MarkdownEditor })));

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return typeof error === "string" ? error : "操作未完成";
}

function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(path);
}

function externalMarkdownHref(href: string): boolean {
  return /^(?:https?:|mailto:|tel:|ftp:|file:)/i.test(href);
}

function splitMarkdownHref(href: string): { path: string; fragment?: string } | undefined {
  const unwrapped = href.trim().replace(/^<|>$/g, "");
  const hash = unwrapped.indexOf("#");
  const rawPath = hash >= 0 ? unwrapped.slice(0, hash) : unwrapped;
  const rawFragment = hash >= 0 ? unwrapped.slice(hash + 1) : undefined;
  try {
    return {
      path: rawPath ? decodeURIComponent(rawPath) : "",
      fragment: rawFragment ? decodeURIComponent(rawFragment) : undefined
    };
  } catch {
    return undefined;
  }
}

export function App() {
  const [session, dispatch] = useReducer(documentSessionReducer, undefined);
  const sessionRef = useRef<DocumentSession | undefined>(undefined);
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const closeInFlightRef = useRef(false);
  const saveInFlightRef = useRef(false);
  const guardInFlightRef = useRef<Promise<boolean> | undefined>(undefined);
  const [recentFiles, setRecentFiles] = useState<Awaited<ReturnType<typeof listRecentFiles>>>([]);
  const [drafts, setDrafts] = useState<RecoveryDraft[]>([]);
  const [decision, setDecision] = useState<DecisionState>();
  const [notice, setNotice] = useState<string>();
  const noticeTimerRef = useRef<number | undefined>(undefined);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findResult, setFindResult] = useState<FindResult>(emptyFindResult);

  sessionRef.current = session;

  const refreshLibrary = useCallback(async () => {
    const [recent, recovery] = await Promise.all([listRecentFiles(), listDrafts()]);
    setRecentFiles(recent);
    setDrafts(recovery);
  }, []);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(undefined), 4200);
  }, []);

  const ask = useCallback((spec: DecisionSpec): Promise<string> => {
    return new Promise((resolve) => setDecision({ spec, resolve }));
  }, []);

  const chooseDecision = useCallback((value: string) => {
    setDecision((current) => {
      current?.resolve(value);
      return undefined;
    });
  }, []);

  const persistDraft = useCallback(async (target: DocumentSession) => {
    await writeDraft({
      schemaVersion: 1,
      draftId: target.draftId,
      filePath: target.filePath,
      displayName: target.displayName,
      baseSha256: target.baseFingerprint.sha256,
      revision: target.revision,
      markdown: target.markdown,
      bom: target.format.bom,
      preferredEol: target.format.preferredEol,
      updatedAt: Date.now()
    });
  }, []);

  const saveCurrent = useCallback(async (requestedMode: SaveMode, expectedSessionId?: string): Promise<boolean> => {
    const current = sessionRef.current;
    if (!current || (expectedSessionId && current.sessionId !== expectedSessionId)) return false;
    if (current.access === "readonly-encoding") {
      showNotice("此文件无法无损写入 UTF-8。内容保持只读。");
      return false;
    }
    if (requestedMode === "normal" && current.filePath && current.saveState === "clean" && !current.externalState) {
      return true;
    }
    if (saveInFlightRef.current) return false;
    saveInFlightRef.current = true;

    let mode = requestedMode;
    let filePath = current.filePath;
    if (!filePath || requestedMode === "saveAs" || current.access === "readonly-permission") {
      mode = "saveAs";
      const defaultPath = current.filePath ?? `${current.displayName === "未命名" ? "未命名" : current.displayName}.md`;
      try {
        filePath = await pickMarkdownSavePath(defaultPath);
      } catch (error) {
        saveInFlightRef.current = false;
        showNotice(errorMessage(error));
        return false;
      }
      if (!filePath) {
        saveInFlightRef.current = false;
        if (!isTauriRuntime()) showNotice("请在桌面应用中选择保存位置。");
        return false;
      }
    }
    if (await focusExistingDocumentWindow(filePath)) {
      saveInFlightRef.current = false;
      return false;
    }

    const revision = current.revision;
    const markdown = current.markdown;
    dispatch({ type: "saveStarted", sessionId: current.sessionId });
    try {
      const result = await saveDocument({
        filePath,
        content: markdown,
        baseSha256: current.baseFingerprint.sha256,
        revision,
        bom: current.format.bom,
        mode,
        draftId: current.draftId
      });
      if (result.status === "saved") {
        dispatch({
          type: "saveSucceeded",
          sessionId: current.sessionId,
          requestRevision: revision,
          savedMarkdown: markdown,
          filePath: result.filePath,
          fingerprint: result.fingerprint
        });
        try {
          await refreshLibrary();
        } catch (error) {
          showNotice(`文档已保存，但无法刷新历史：${errorMessage(error)}`);
        }
        return true;
      }
      if (result.status === "conflict") {
        dispatch({ type: "saveFailed", sessionId: current.sessionId, state: "conflict" });
      } else if (result.status === "missing") {
        dispatch({ type: "saveFailed", sessionId: current.sessionId, state: "missing" });
      } else {
        dispatch({
          type: "saveFailed",
          sessionId: current.sessionId,
          state: "error"
        });
      }
      await persistDraft({ ...current, saveState: "error" });
      return false;
    } catch (error) {
      dispatch({
        type: "saveFailed",
        sessionId: current.sessionId,
        state: "error"
      });
      await persistDraft({ ...current, saveState: "error" });
      return false;
    } finally {
      saveInFlightRef.current = false;
    }
  }, [persistDraft, refreshLibrary, showNotice]);

  const runGuardCurrent = useCallback(async (reason: "switch" | "close" = "switch"): Promise<boolean> => {
    let current = sessionRef.current;
    if (!current || (current.saveState === "clean" && !current.externalState)) return true;

    if (
      current.saveState === "dirty"
      && current.filePath
      && current.access === "writable"
      && !current.externalState
    ) {
      if (await saveCurrent("normal", current.sessionId)) return true;
      current = sessionRef.current ?? current;
    }

    const actions = [
      { id: "cancel", label: "取消" },
      { id: "discard", label: "丢弃更改", tone: "danger" as const },
      { id: "save", label: "另存为…", tone: "primary" as const }
    ];
    if (reason === "close") actions.splice(1, 0, { id: "keep", label: "保留草稿并退出", tone: "primary" as const });
    const choice = await ask({
      title: reason === "close" ? "退出前处理当前文档" : "打开另一份文档前保存更改",
      message: current.saveState === "conflict"
        ? "磁盘版本与当前内容不同。当前内容已经保留在恢复草稿中。"
        : "当前文档包含尚未写入磁盘的更改。",
      actions
    });
    if (choice === "cancel") return false;
    if (choice === "save") return saveCurrent("saveAs", current.sessionId);
    if (choice === "keep") {
      await persistDraft(current);
      return true;
    }
    if (choice === "discard") {
      await deleteDraft(current.draftId);
      return true;
    }
    return false;
  }, [ask, persistDraft, saveCurrent]);

  const guardCurrent = useCallback((reason: "switch" | "close" = "switch"): Promise<boolean> => {
    if (guardInFlightRef.current) return guardInFlightRef.current;
    const pending = runGuardCurrent(reason).finally(() => {
      if (guardInFlightRef.current === pending) guardInFlightRef.current = undefined;
    });
    guardInFlightRef.current = pending;
    return pending;
  }, [runGuardCurrent]);

  const openPath = useCallback(async (
    filePath: string,
    options: { guard?: boolean; ignoreDraft?: boolean } = {}
  ) => {
    if (!isMarkdownPath(filePath)) {
      showNotice("只能打开 .md 或 .markdown 文件。");
      return false;
    }
    if (await focusExistingDocumentWindow(filePath)) return false;
    if (options.guard !== false && !(await guardCurrent("switch"))) return false;

    try {
      const result = await readDocument(filePath);
      let recovered: RecoveryDraft | undefined;
      if (result.draft && !options.ignoreDraft) {
        const conflict = result.draft.baseSha256 !== result.fingerprint.sha256;
        const choice = await ask({
          title: conflict ? "恢复草稿与磁盘版本不同" : "发现未保存的草稿",
          message: conflict
            ? "草稿创建后，磁盘文件又发生了变化。恢复后需要另存为或明确覆盖。"
            : "可以恢复异常退出前尚未成功保存的内容。",
          actions: [
            { id: "cancel", label: "取消" },
            { id: "disk", label: "使用磁盘版本" },
            { id: "recover", label: "恢复草稿", tone: "primary" }
          ]
        });
        if (choice === "cancel") return false;
        if (choice === "recover") recovered = result.draft;
        else await deleteDraft(result.draft.draftId);
      }
      dispatch({ type: "replace", session: createFileSession(result, recovered) });
      await setWindowDocument(result.filePath);
      setFindOpen(false);
      await refreshLibrary();
      return true;
    } catch (error) {
      showNotice(errorMessage(error));
      return false;
    }
  }, [ask, guardCurrent, refreshLibrary, showNotice]);

  const openPathsInWindows = useCallback(async (paths: string[]) => {
    const markdown = paths.filter(isMarkdownPath);
    if (markdown.length !== paths.length) {
      showNotice("只能打开 .md 或 .markdown 文件。");
    }
    if (!markdown.length) return;
    try {
      if (!sessionRef.current) {
        const [first, ...remaining] = markdown;
        const opened = await openPath(first, { guard: false });
        if (!opened && !sessionRef.current) await setWindowDocument();
        if (remaining.length) await openDocumentWindows(remaining);
      } else {
        await openDocumentWindows(markdown);
      }
    } catch (error) {
      showNotice(errorMessage(error));
    }
  }, [openPath, showNotice]);

  const jumpToHeadingSoon = useCallback((fragment: string) => {
    let attempts = 0;
    const jump = () => {
      if (editorRef.current?.jumpToHeading(fragment)) return;
      attempts += 1;
      if (attempts < 12) window.setTimeout(jump, 30);
      else showNotice(`未找到标题：${fragment}`);
    };
    window.requestAnimationFrame(jump);
  }, [showNotice]);

  const openMarkdownLink = useCallback(async (href: string, options: { newWindow?: boolean } = {}) => {
    const trimmed = href.trim();
    if (!trimmed) return;
    if (externalMarkdownHref(trimmed)) {
      try {
        await openExternalUrl(trimmed);
      } catch (error) {
        showNotice(`无法打开链接：${errorMessage(error)}`);
      }
      return;
    }
    const target = splitMarkdownHref(trimmed);
    if (!target) {
      showNotice("链接包含无效的转义字符。");
      return;
    }
    if (!target.path) {
      if (target.fragment) jumpToHeadingSoon(target.fragment);
      return;
    }
    const current = sessionRef.current;
    if (!current?.filePath) {
      showNotice("请先保存当前文档，再打开相对 Markdown 链接。");
      return;
    }
    try {
      const resolved = await resolveMarkdownLink(current.filePath, target.path);
      if (options.newWindow) {
        if (target.fragment) await openDocumentWindowAt(resolved, target.fragment);
        else await openDocumentWindows([resolved]);
      } else {
        if (resolved !== current.filePath && !(await openPath(resolved))) return;
        if (target.fragment) jumpToHeadingSoon(target.fragment);
      }
    } catch (error) {
      showNotice(`无法打开链接：${errorMessage(error)}`);
    }
  }, [jumpToHeadingSoon, openPath, showNotice]);

  const newDocument = useCallback(async () => {
    if (sessionRef.current) {
      try {
        await createDocumentWindow();
      } catch (error) {
        showNotice(errorMessage(error));
      }
      return;
    }
    dispatch({ type: "replace", session: createUntitledSession() });
    setFindOpen(false);
  }, [showNotice]);

  const openPicker = useCallback(async () => {
    const selected = await pickMarkdownFiles();
    if (selected.length) await openPathsInWindows(selected);
    else if (!isTauriRuntime()) showNotice("请在桌面应用中使用系统文件选择器。");
  }, [openPathsInWindows, showNotice]);

  const recoverDraft = useCallback(async (draft: RecoveryDraft) => {
    if (draft.filePath) {
      await openPathsInWindows([draft.filePath]);
      return;
    }
    if (!(await guardCurrent("switch"))) return;
    dispatch({ type: "replace", session: createUntitledSession(draft) });
  }, [guardCurrent, openPathsInWindows]);

  const removeRecent = useCallback(async (filePath: string) => {
    try {
      setRecentFiles(await removeRecentFile(filePath));
    } catch (error) {
      showNotice(errorMessage(error));
    }
  }, [showNotice]);

  const clearRecent = useCallback(async () => {
    try {
      setRecentFiles(await clearRecentFiles());
    } catch (error) {
      showNotice(errorMessage(error));
    }
  }, [showNotice]);

  const openRecent = useCallback(async (file: RecentFile) => {
    if (file.available) {
      await openPathsInWindows([file.filePath]);
      return;
    }
    const choice = await ask({
      title: "文件不存在",
      message: "这个文件已被移动或删除，可以从最近文件中移除。",
      actions: [
        { id: "cancel", label: "取消" },
        { id: "remove", label: "移除", tone: "danger" }
      ]
    });
    if (choice === "remove") await removeRecent(file.filePath);
  }, [ask, openPathsInWindows, removeRecent]);

  const reloadDiskVersion = useCallback(async () => {
    const current = sessionRef.current;
    if (!current?.filePath) return;
    if (current.saveState !== "clean") {
      const choice = await ask({
        title: "重新载入磁盘版本",
        message: "当前编辑内容将从画布中移除。恢复草稿会在确认后删除。",
        actions: [
          { id: "cancel", label: "取消" },
          { id: "reload", label: "重新载入", tone: "danger" }
        ]
      });
      if (choice !== "reload") return;
    }
    await deleteDraft(current.draftId);
    await openPath(current.filePath, { guard: false, ignoreDraft: true });
  }, [ask, openPath]);

  const forceOverwrite = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return;
    const choice = await ask({
      title: "覆盖磁盘文件",
      message: "磁盘上由其他应用写入的版本将被当前编辑内容替换。",
      actions: [
        { id: "cancel", label: "取消" },
        { id: "overwrite", label: "覆盖磁盘文件", tone: "danger" }
      ]
    });
    if (choice === "overwrite") await saveCurrent("force", current.sessionId);
  }, [ask, saveCurrent]);

  const exportCurrent = useCallback(async (format: "html" | "pdf") => {
    const current = sessionRef.current;
    if (!current) {
      showNotice("请先打开或新建一份文档。");
      return;
    }
    const baseName = current.displayName.replace(/\.(md|markdown)$/i, "") || "未命名";
    const extension = format === "pdf" ? "pdf" : "html";
    const defaultPath = current.filePath
      ? current.filePath.replace(/\.(md|markdown)$/i, `.${extension}`)
      : `${baseName}.${extension}`;
    const filePath = await pickExportSavePath(format, defaultPath);
    if (!filePath) return;
    try {
      await editorRef.current?.prepareExport();
      const body = editorRef.current?.getExportHtml() ?? "";
      if (!body) throw new Error("文档仍在载入，请稍后重试。");
      let outputPath: string | undefined;
      if (format === "pdf") {
        const root = document.documentElement;
        root.classList.add("is-pdf-exporting");
        void root.offsetHeight;
        try {
          outputPath = await exportPdf(filePath);
        } finally {
          root.classList.remove("is-pdf-exporting");
        }
      } else {
        outputPath = await writeExportDocument({
          filePath,
          format: "html",
          content: createExportHtml(baseName, body)
        });
      }
      showNotice(`已导出 ${outputPath ?? filePath}`);
    } catch (error) {
      showNotice(`导出失败：${errorMessage(error)}`);
    }
  }, [showNotice]);

  const updateFind = useCallback((query: string, direction: "next" | "previous" = "next") => {
    setFindQuery(query);
    setFindResult(editorRef.current?.find(query, direction) ?? emptyFindResult);
  }, []);

  const copyCurrentCode = useCallback(async () => {
    const copied = await editorRef.current?.copyCode();
    if (!copied) showNotice("请先将光标置于代码块内。");
  }, [showNotice]);

  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  useEffect(() => {
    const state = (() => {
      if (!session) return "";
      if (session.access !== "writable") return " (只读)";
      if (session.saveState === "dirty") return " (未保存)";
      if (session.saveState === "saving") return " (正在保存)";
      if (session.saveState === "conflict") return " (保存冲突)";
      if (session.saveState === "error") return " (保存失败)";
      if (session.saveState === "missing") return " (原文件不存在)";
      return "";
    })();
    const title = session ? `${session.displayName}${state} - Nolia Lite` : "Nolia Lite";
    void setWindowTitle(title);
  }, [session?.access, session?.displayName, session?.saveState]);

  useEffect(() => {
    if (!session) return;
    void setWindowDocument(session.filePath);
  }, [session?.filePath, session?.sessionId]);

  useEffect(() => {
    if (!session || session.saveState !== "dirty" || !session.filePath || session.access !== "writable" || session.externalState) {
      return;
    }
    const sessionId = session.sessionId;
    const timer = window.setTimeout(() => void saveCurrent("normal", sessionId), 800);
    return () => window.clearTimeout(timer);
  }, [saveCurrent, session]);

  useEffect(() => {
    if (!session || !["dirty", "conflict", "error", "missing"].includes(session.saveState)) return;
    const snapshot = session;
    const timer = window.setTimeout(() => void persistDraft(snapshot).then(refreshLibrary), 250);
    return () => window.clearTimeout(timer);
  }, [persistDraft, refreshLibrary, session]);

  useEffect(() => {
    if (!session?.filePath) {
      void stopDocumentWatch();
      return;
    }
    const sessionId = session.sessionId;
    const watchedPath = session.filePath;
    let disposed = false;
    let unlisten: () => void = () => undefined;
    let debounceTimer: number | undefined;
    const check = async () => {
      const current = sessionRef.current;
      if (!current || current.sessionId !== sessionId || current.saveState === "saving") return;
      const result = await inspectDocument(current.filePath!, current.baseFingerprint.sha256);
      if (result.status === "changed") dispatch({ type: "external", sessionId, state: "changed" });
      else if (result.status === "missing") dispatch({ type: "external", sessionId, state: "missing" });
    };
    const scheduleCheck = () => {
      if (debounceTimer) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => void check(), 120);
    };
    void (async () => {
      const stopListening = await onDocumentFileEvent((filePath) => {
        if (filePath === watchedPath) scheduleCheck();
      });
      if (disposed) {
        stopListening();
        return;
      }
      unlisten = stopListening;
      await watchDocument(watchedPath);
      if (disposed) await stopDocumentWatch(watchedPath);
    })().catch(() => undefined);
    const timer = window.setInterval(() => void check(), 10000);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      if (debounceTimer) window.clearTimeout(debounceTimer);
      unlisten();
      void stopDocumentWatch(watchedPath);
      window.removeEventListener("focus", onFocus);
    };
  }, [session?.filePath, session?.sessionId]);

  useEffect(() => {
    let disposed = false;
    let unlisteners: Array<() => void> = [];
    const handlePaths = async (paths: string[]) => {
      if (paths.length) await openPathsInWindows(paths);
    };
    const handleDropPaths = (paths: string[]) => {
      const documents = paths.filter(isMarkdownPath);
      const images = paths.filter(isImagePath);
      if (documents.length) void openPathsInWindows(documents);
      if (images.length) {
        const current = sessionRef.current;
        if (!current?.filePath) {
          showNotice("请先保存当前文档，再插入图片。");
        } else if (current.access === "writable") {
          void editorRef.current?.insertImageFiles(images).catch((error) => showNotice(`插入图片失败：${errorMessage(error)}`));
        }
      }
    };
    const drainPendingOpenPaths = () => {
      void (async () => {
        await handlePaths(await takePendingOpenPaths());
        const fragment = await takePendingHeadingFragment();
        if (fragment) jumpToHeadingSoon(fragment);
      })().catch(() => undefined);
    };
    const requestClose = () => {
      if (closeInFlightRef.current) return;
      closeInFlightRef.current = true;
      void guardCurrent("close").then((allowed) => {
        if (!allowed) {
          closeInFlightRef.current = false;
          return;
        }
        void closeCurrentWindow().catch((error) => {
          closeInFlightRef.current = false;
          showNotice(errorMessage(error));
        });
      }).catch((error) => {
        closeInFlightRef.current = false;
        showNotice(errorMessage(error));
      });
    };
    const requestQuit = (requestId: number) => {
      void guardCurrent("close")
        .then((allowed) => answerQuitRequest(requestId, allowed))
        .catch(() => answerQuitRequest(requestId, false));
    };
    const register = async () => {
      const registrations = await Promise.allSettled([
        onOpenDocumentPaths((paths) => void handlePaths(paths)),
        onNavigateDocumentHeading(jumpToHeadingSoon),
        onWindowFileDrop(handleDropPaths),
        onCloseRequested(requestClose),
        onQuitRequested(requestQuit),
        onMenuCommand((command) => {
          if (command === "file.new") void newDocument();
          else if (command === "file.open") void openPicker();
          else if (command === "file.save") void saveCurrent("normal");
          else if (command === "file.save_as") void saveCurrent("saveAs");
          else if (command === "file.export_html") void exportCurrent("html");
          else if (command === "file.export_pdf") void exportCurrent("pdf");
          else if (command === "edit.find") setFindOpen(true);
          else if (command === "edit.copy_code") void copyCurrentCode();
          else if (command === "format.source") editorRef.current?.toggleSource();
          else if (command === "format.paragraph") editorRef.current?.setParagraph();
          else if (command.startsWith("format.heading")) editorRef.current?.toggleHeading(Number(command.slice(-1)) as 1 | 2 | 3 | 4 | 5 | 6);
          else if (command === "format.bold") editorRef.current?.toggleBold();
          else if (command === "format.italic") editorRef.current?.toggleItalic();
          else if (command === "format.strike") editorRef.current?.toggleStrike();
          else if (command === "format.code") editorRef.current?.toggleCode();
          else if (command === "format.blockquote") editorRef.current?.toggleBlockquote();
          else if (command === "format.bullet_list") editorRef.current?.toggleBulletList();
          else if (command === "format.ordered_list") editorRef.current?.toggleOrderedList();
          else if (command === "format.task_list") editorRef.current?.toggleTaskList();
          else if (command === "format.code_block") editorRef.current?.toggleCodeBlock();
          else if (command === "format.horizontal_rule") editorRef.current?.insertHorizontalRule();
          else if (command === "format.image") {
            if (!sessionRef.current?.filePath) showNotice("请先保存当前文档，再插入图片。");
            else void editorRef.current?.insertImage().catch((error) => showNotice(`插入图片失败：${errorMessage(error)}`));
          }
          else if (command === "format.link") editorRef.current?.editLink();
          else if (command === "format.table") editorRef.current?.insertTable();
          else if (command === "format.mermaid") editorRef.current?.insertMermaid();
          else if (command === "format.math") editorRef.current?.insertMath();
        })
      ]);
      const registered = registrations.flatMap((registration) =>
        registration.status === "fulfilled" ? [registration.value] : []
      );
      if (disposed) {
        registered.forEach((unlisten) => unlisten());
        return;
      }
      unlisteners = registered;
      await handlePaths(await takePendingOpenPaths());
      const fragment = await takePendingHeadingFragment();
      if (fragment) jumpToHeadingSoon(fragment);
    };
    window.addEventListener("focus", drainPendingOpenPaths);
    void register();
    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
      window.removeEventListener("focus", drainPendingOpenPaths);
    };
  }, [copyCurrentCode, exportCurrent, guardCurrent, jumpToHeadingSoon, newDocument, openPathsInWindows, openPicker, saveCurrent, showNotice]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || (event.metaKey && event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "n") {
        event.preventDefault();
        void newDocument();
      } else if (key === "o") {
        event.preventDefault();
        void openPicker();
      } else if (key === "s") {
        event.preventDefault();
        void saveCurrent(event.shiftKey ? "saveAs" : "normal");
      } else if (key === "f") {
        event.preventDefault();
        setFindOpen(true);
      } else if (key === "b" && sessionRef.current?.access === "writable") {
        event.preventDefault();
        editorRef.current?.toggleBold();
      } else if (key === "i" && sessionRef.current?.access === "writable") {
        event.preventDefault();
        editorRef.current?.toggleItalic();
      } else if (key === "k" && sessionRef.current?.access === "writable") {
        event.preventDefault();
        editorRef.current?.editLink();
      } else if (key === "c" && event.shiftKey) {
        event.preventDefault();
        void copyCurrentCode();
      } else if (key === "/") {
        event.preventDefault();
        editorRef.current?.toggleSource();
      } else if (!event.shiftKey && /^[0-6]$/.test(key) && sessionRef.current?.access === "writable") {
        event.preventDefault();
        if (key === "0") editorRef.current?.setParagraph();
        else editorRef.current?.toggleHeading(Number(key) as 1 | 2 | 3 | 4 | 5 | 6);
      } else if (event.shiftKey && event.code === "Digit7" && sessionRef.current?.access === "writable") {
        event.preventDefault();
        editorRef.current?.toggleOrderedList();
      } else if (event.shiftKey && event.code === "Digit8" && sessionRef.current?.access === "writable") {
        event.preventDefault();
        editorRef.current?.toggleBulletList();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [copyCurrentCode, newDocument, openPicker, saveCurrent]);

  const banner = (() => {
    if (notice) return <StatusBanner tone="info" message={notice} />;
    if (!session) return null;
    if (session.access === "readonly-encoding") {
      return <StatusBanner tone="warning" message="此文件不是受支持的 UTF-8 编码，已以只读方式打开。" />;
    }
    if (session.access === "readonly-permission") {
      return <StatusBanner tone="info" message="此文件不可写，已以只读方式打开。" actions={[{ label: "另存为…", onClick: () => void saveCurrent("saveAs") }]} />;
    }
    if (session.saveState === "conflict") {
      return (
        <StatusBanner
          tone="warning"
          alert
          message="文件已在其他应用中更改。当前内容已保留在恢复草稿中。"
          actions={[
            { label: "重新载入", onClick: () => void reloadDiskVersion() },
            { label: "覆盖磁盘文件", onClick: () => void forceOverwrite(), danger: true },
            { label: "另存为…", onClick: () => void saveCurrent("saveAs") }
          ]}
        />
      );
    }
    if (session.saveState === "missing") {
      return <StatusBanner tone="warning" message="原文件已被移动或删除。当前内容仍然保留。" actions={[{ label: "另存为…", onClick: () => void saveCurrent("saveAs") }]} />;
    }
    if (session.saveState === "error") {
      return (
        <StatusBanner
          tone="danger"
          alert
          message="无法保存更改，恢复草稿已保留。"
          actions={[
            { label: "重试", onClick: () => void saveCurrent("normal") },
            { label: "另存为…", onClick: () => void saveCurrent("saveAs") }
          ]}
        />
      );
    }
    if (session.externalState === "changed") {
      return (
        <StatusBanner
          tone="info"
          message="磁盘上的文件已更改。"
          actions={[
            { label: "重新载入", onClick: () => void reloadDiskVersion() },
            { label: "保留当前内容", onClick: () => dispatch({ type: "keepCurrent", sessionId: session.sessionId }) }
          ]}
        />
      );
    }
    return null;
  })();

  return (
    <div className="app-shell">
      <TitleBar session={session} />
      {banner}
      {session ? (
        <main className="document-view">
          {findOpen ? (
            <FindBar
              query={findQuery}
              result={findResult}
              onQueryChange={(query) => updateFind(query)}
              onPrevious={() => updateFind(findQuery, "previous")}
              onNext={() => updateFind(findQuery, "next")}
              onClose={() => {
                editorRef.current?.find("");
                setFindOpen(false);
                editorRef.current?.focus();
              }}
            />
          ) : null}
          <EditorErrorBoundary key={`${session.sessionId}:${session.filePath ?? ""}:${session.access}`}>
            <Suspense fallback={<div className="editor-loading" aria-label="正在载入文档" />}>
              <MarkdownEditor
                ref={editorRef}
                value={session.markdown}
                filePath={session.filePath}
                preferredEol={session.format.preferredEol}
                editable={session.access === "writable"}
                autofocus={session.kind === "untitled"}
                onChange={(markdown) => dispatch({ type: "edit", sessionId: session.sessionId, markdown })}
                onOpenLink={(href, options) => void openMarkdownLink(href, options)}
                onError={showNotice}
              />
            </Suspense>
          </EditorErrorBoundary>
        </main>
      ) : (
        <HistorySidebar
          recentFiles={recentFiles}
          drafts={drafts}
          onNew={() => void newDocument()}
          onOpen={() => void openPicker()}
          onOpenRecent={(file) => void openRecent(file)}
          onRemoveRecent={(path) => void removeRecent(path)}
          onClearRecent={() => void clearRecent()}
          onRecoverDraft={(draft) => void recoverDraft(draft)}
        />
      )}
      {decision ? <DecisionDialog spec={decision.spec} onChoose={chooseDecision} /> : null}
    </div>
  );
}
