import { invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";

import type {
  InspectDocumentResult,
  ReadDocumentResult,
  RecentFile,
  RecoveryDraft,
  ExportDocumentRequest,
  ExportFormat,
  SaveDocumentRequest,
  SaveDocumentResult
} from "./contracts";

export const isTauriRuntime = (): boolean => "__TAURI_INTERNALS__" in window;

export async function pickMarkdownFiles(): Promise<string[]> {
  if (!isTauriRuntime()) return [];
  const selected = await open({
    multiple: true,
    directory: false,
    title: "打开 Markdown 文件（可多选）",
    filters: [{ name: "Markdown", extensions: ["md", "markdown"] }]
  });
  if (!selected) return [];
  return typeof selected === "string" ? [selected] : selected;
}

export async function pickMarkdownSavePath(defaultPath: string): Promise<string | undefined> {
  if (!isTauriRuntime()) return undefined;
  const selected = await save({
    title: "保存 Markdown 文件",
    defaultPath,
    filters: [{ name: "Markdown", extensions: ["md", "markdown"] }]
  });
  if (!selected) return undefined;
  return /\.(md|markdown)$/i.test(selected) ? selected : `${selected}.md`;
}

export async function pickExportSavePath(format: ExportFormat, defaultPath: string): Promise<string | undefined> {
  if (!isTauriRuntime()) return undefined;
  const isPdf = format === "pdf";
  const selected = await save({
    title: "导出文档",
    defaultPath,
    filters: [isPdf
      ? { name: "PDF 文档", extensions: ["pdf"] }
      : { name: "HTML 文档", extensions: ["html", "htm"] }]
  });
  if (!selected) return undefined;
  if (format === "html" && !/\.html?$/i.test(selected)) return `${selected}.html`;
  if (format === "pdf" && !/\.pdf$/i.test(selected)) return `${selected}.pdf`;
  return selected;
}

export async function writeExportDocument(request: ExportDocumentRequest): Promise<string | undefined> {
  if (!isTauriRuntime()) return undefined;
  return invoke<string>("write_export_document", { request });
}

export async function exportPdf(filePath: string): Promise<string | undefined> {
  if (!isTauriRuntime()) return undefined;
  return invoke<string>("export_pdf", { filePath });
}

export async function readDocument(filePath: string): Promise<ReadDocumentResult> {
  return invoke<ReadDocumentResult>("read_document", { filePath });
}

export async function saveDocument(request: SaveDocumentRequest): Promise<SaveDocumentResult> {
  return invoke<SaveDocumentResult>("save_document", { request });
}

export async function inspectDocument(filePath: string, baseSha256: string): Promise<InspectDocumentResult> {
  return invoke<InspectDocumentResult>("inspect_document", { filePath, baseSha256 });
}

export async function readLocalImage(documentPath: string, imageSource: string): Promise<string | undefined> {
  if (!isTauriRuntime()) return undefined;
  return invoke<string>("read_local_image", { documentPath, imageSource });
}

export async function resolveMarkdownLink(documentPath: string, targetPath: string): Promise<string> {
  return invoke<string>("resolve_markdown_link", { documentPath, targetPath });
}

export async function openExternalUrl(url: string): Promise<void> {
  if (isTauriRuntime()) {
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function watchDocument(filePath: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("watch_document", { filePath });
}

export async function stopDocumentWatch(): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("stop_document_watch");
}

export async function onDocumentFileEvent(handler: (filePath: string) => void): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => undefined;
  return getCurrentWindow().listen<string>("document-file-event", (event) => handler(event.payload));
}

export async function writeDraft(draft: RecoveryDraft): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("write_draft", { draft });
}

export async function deleteDraft(draftId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("delete_draft", { draftId });
}

export async function listDrafts(): Promise<RecoveryDraft[]> {
  if (!isTauriRuntime()) return [];
  return invoke<RecoveryDraft[]>("list_drafts");
}

export async function listRecentFiles(): Promise<RecentFile[]> {
  if (!isTauriRuntime()) return [];
  return invoke<RecentFile[]>("list_recent_files");
}

export async function removeRecentFile(filePath: string): Promise<RecentFile[]> {
  if (!isTauriRuntime()) return [];
  return invoke<RecentFile[]>("remove_recent_file", { filePath });
}

export async function setWindowTitle(title: string): Promise<void> {
  if (!isTauriRuntime()) {
    document.title = title;
    return;
  }
  await getCurrentWindow().setTitle(title);
}

export async function openDocumentWindows(paths: string[]): Promise<void> {
  if (isTauriRuntime() && paths.length) await invoke("open_document_windows", { paths });
}

export async function createDocumentWindow(): Promise<void> {
  if (isTauriRuntime()) await invoke("create_document_window");
}

export async function setWindowDocument(filePath?: string): Promise<void> {
  if (isTauriRuntime()) await invoke("set_window_document", { filePath });
}

export async function closeCurrentWindow(): Promise<void> {
  if (isTauriRuntime()) await invoke("close_current_window");
}

export async function answerQuitRequest(requestId: number, allowed: boolean): Promise<void> {
  if (isTauriRuntime()) await invoke("answer_quit_request", { requestId, allowed });
}

export async function onOpenDocumentPaths(handler: (paths: string[]) => void): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => undefined;
  return getCurrentWindow().listen<string[]>("open-document-paths", (event) => {
    void takePendingOpenPaths()
      .then((paths) => handler(paths.length ? paths : event.payload))
      .catch(() => handler(event.payload));
  });
}

export async function takePendingOpenPaths(): Promise<string[]> {
  if (!isTauriRuntime()) return [];
  return invoke<string[]>("take_pending_open_paths");
}

export async function onMenuCommand(handler: (command: string) => void): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => undefined;
  return getCurrentWindow().listen<string>("menu-command", (event) => handler(event.payload));
}

export async function onWindowFileDrop(handler: (paths: string[]) => void): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => undefined;
  return getCurrentWindow().onDragDropEvent((event) => {
    if (event.payload.type === "drop") handler(event.payload.paths);
  });
}

export async function onCloseRequested(handler: (preventDefault: () => void) => void): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => undefined;
  return getCurrentWindow().listen("close-requested", () => handler(() => undefined));
}

export async function onQuitRequested(handler: (requestId: number) => void): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => undefined;
  return getCurrentWindow().listen<number>("quit-requested", (event) => handler(event.payload));
}
