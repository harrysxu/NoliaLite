// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReadDocumentResult, SaveDocumentResult } from "../bridge/contracts";
import { App } from "./App";

const bridge = vi.hoisted(() => ({
  closeHandler: undefined as undefined | (() => void),
  menuHandler: undefined as undefined | ((command: string) => void),
  openHandler: undefined as undefined | ((paths: string[]) => void),
  dropHandler: undefined as undefined | ((paths: string[]) => void),
  documentHandler: undefined as undefined | ((filePath: string) => void),
  headingHandler: undefined as undefined | ((fragment: string) => void),
  quitHandler: undefined as undefined | ((requestId: number) => void),
  dropRegistrationError: undefined as Error | undefined,
  editorActions: {
    toggleSource: vi.fn(),
    toggleBold: vi.fn(),
    toggleItalic: vi.fn(),
    toggleStrike: vi.fn(),
    toggleCode: vi.fn(),
    setParagraph: vi.fn(),
    toggleHeading: vi.fn(),
    toggleBlockquote: vi.fn(),
    toggleBulletList: vi.fn(),
    toggleOrderedList: vi.fn(),
    toggleTaskList: vi.fn(),
    toggleCodeBlock: vi.fn(),
    insertHorizontalRule: vi.fn(),
    copyCode: vi.fn(async () => true),
    insertImage: vi.fn(async () => 1),
    insertImageFiles: vi.fn(async () => 1),
    editLink: vi.fn(),
    insertTable: vi.fn(),
    insertMermaid: vi.fn(),
    insertMath: vi.fn(),
    prepareExport: vi.fn(async () => undefined),
    getExportHtml: vi.fn(),
    jumpToHeading: vi.fn()
  },
  listRecentFiles: vi.fn(),
  listDrafts: vi.fn(),
  pickMarkdownFiles: vi.fn(),
  pickMarkdownSavePath: vi.fn(),
  pickExportSavePath: vi.fn(),
  exportPdf: vi.fn(),
  focusExistingDocumentWindow: vi.fn(),
  readDocument: vi.fn(),
  saveDocument: vi.fn(),
  writeExportDocument: vi.fn(),
  inspectDocument: vi.fn(),
  writeDraft: vi.fn(),
  deleteDraft: vi.fn(),
  removeRecentFile: vi.fn(),
  clearRecentFiles: vi.fn(),
  resolveMarkdownLink: vi.fn(),
  openExternalUrl: vi.fn(),
  openDocumentWindowAt: vi.fn(),
  openDocumentWindows: vi.fn(),
  createDocumentWindow: vi.fn(),
  setWindowDocument: vi.fn(),
  closeCurrentWindow: vi.fn(),
  answerQuitRequest: vi.fn(),
  setWindowTitle: vi.fn(),
  watchDocument: vi.fn(),
  stopDocumentWatch: vi.fn(),
  takePendingOpenPaths: vi.fn(),
  takePendingHeadingFragment: vi.fn()
}));

vi.mock("../bridge/tauriClient", () => ({
  isTauriRuntime: () => true,
  listRecentFiles: bridge.listRecentFiles,
  listDrafts: bridge.listDrafts,
  pickMarkdownFiles: bridge.pickMarkdownFiles,
  pickMarkdownSavePath: bridge.pickMarkdownSavePath,
  pickExportSavePath: bridge.pickExportSavePath,
  exportPdf: bridge.exportPdf,
  focusExistingDocumentWindow: bridge.focusExistingDocumentWindow,
  readDocument: bridge.readDocument,
  saveDocument: bridge.saveDocument,
  writeExportDocument: bridge.writeExportDocument,
  inspectDocument: bridge.inspectDocument,
  writeDraft: bridge.writeDraft,
  deleteDraft: bridge.deleteDraft,
  removeRecentFile: bridge.removeRecentFile,
  clearRecentFiles: bridge.clearRecentFiles,
  resolveMarkdownLink: bridge.resolveMarkdownLink,
  openExternalUrl: bridge.openExternalUrl,
  openDocumentWindowAt: bridge.openDocumentWindowAt,
  openDocumentWindows: bridge.openDocumentWindows,
  createDocumentWindow: bridge.createDocumentWindow,
  setWindowDocument: bridge.setWindowDocument,
  closeCurrentWindow: bridge.closeCurrentWindow,
  answerQuitRequest: bridge.answerQuitRequest,
  setWindowTitle: bridge.setWindowTitle,
  watchDocument: bridge.watchDocument,
  stopDocumentWatch: bridge.stopDocumentWatch,
  takePendingOpenPaths: bridge.takePendingOpenPaths,
  takePendingHeadingFragment: bridge.takePendingHeadingFragment,
  onDocumentFileEvent: vi.fn(async (handler: (filePath: string) => void) => {
    bridge.documentHandler = handler;
    return () => undefined;
  }),
  onOpenDocumentPaths: vi.fn(async (handler: (paths: string[]) => void) => {
    bridge.openHandler = handler;
    return () => undefined;
  }),
  onNavigateDocumentHeading: vi.fn(async (handler: (fragment: string) => void) => {
    bridge.headingHandler = handler;
    return () => undefined;
  }),
  onWindowFileDrop: vi.fn(async (handler: (paths: string[]) => void) => {
    if (bridge.dropRegistrationError) throw bridge.dropRegistrationError;
    bridge.dropHandler = handler;
    return () => undefined;
  }),
  onCloseRequested: vi.fn(async (handler: () => void) => {
    bridge.closeHandler = handler;
    return () => undefined;
  }),
  onQuitRequested: vi.fn(async (handler: (requestId: number) => void) => {
    bridge.quitHandler = handler;
    return () => undefined;
  }),
  onMenuCommand: vi.fn(async (handler: (command: string) => void) => {
    bridge.menuHandler = handler;
    return () => undefined;
  })
}));

vi.mock("../editor/MarkdownEditor", async () => {
  const React = await import("react");
  const MarkdownEditor = React.forwardRef(function MockEditor(
    props: {
      value: string;
      filePath?: string;
      editable: boolean;
      onChange: (value: string) => void;
      onOpenLink?: (href: string, options: { newWindow: boolean }) => void;
    },
    ref: React.ForwardedRef<Record<string, () => void>>
  ) {
    const [extensionConfig] = React.useState({ filePath: props.filePath ?? "", editable: props.editable });
    React.useImperativeHandle(ref, () => ({
      focus: () => undefined,
      toggleSource: bridge.editorActions.toggleSource,
      toggleBold: bridge.editorActions.toggleBold,
      toggleItalic: bridge.editorActions.toggleItalic,
      toggleStrike: bridge.editorActions.toggleStrike,
      toggleCode: bridge.editorActions.toggleCode,
      setParagraph: bridge.editorActions.setParagraph,
      toggleHeading: bridge.editorActions.toggleHeading,
      toggleBlockquote: bridge.editorActions.toggleBlockquote,
      toggleBulletList: bridge.editorActions.toggleBulletList,
      toggleOrderedList: bridge.editorActions.toggleOrderedList,
      toggleTaskList: bridge.editorActions.toggleTaskList,
      toggleCodeBlock: bridge.editorActions.toggleCodeBlock,
      insertHorizontalRule: bridge.editorActions.insertHorizontalRule,
      copyCode: bridge.editorActions.copyCode,
      insertImage: bridge.editorActions.insertImage,
      insertImageFiles: bridge.editorActions.insertImageFiles,
      editLink: bridge.editorActions.editLink,
      undo: () => undefined,
      redo: () => undefined,
      insertTable: bridge.editorActions.insertTable,
      insertMermaid: bridge.editorActions.insertMermaid,
      insertMath: bridge.editorActions.insertMath,
      prepareExport: bridge.editorActions.prepareExport,
      getExportHtml: bridge.editorActions.getExportHtml,
      find: () => ({ current: 0, total: 0 }),
      jumpToHeading: bridge.editorActions.jumpToHeading
    }));
    return React.createElement(
      "div",
      {
        role: "textbox",
        "aria-label": "Markdown 文档",
        "data-editable": String(props.editable),
        "data-extension-file-path": extensionConfig.filePath,
        "data-extension-editable": String(extensionConfig.editable)
      },
      React.createElement("span", null, props.value),
      props.editable
        ? React.createElement(
            React.Fragment,
            null,
            React.createElement("button", { type: "button", onClick: () => props.onChange("changed markdown") }, "模拟编辑"),
            React.createElement("button", { type: "button", onClick: () => props.onOpenLink?.("./next.md#section", { newWindow: false }) }, "模拟打开链接"),
            React.createElement("button", { type: "button", onClick: () => props.onOpenLink?.("./next.md#section", { newWindow: true }) }, "模拟新窗口打开链接"),
            React.createElement("button", { type: "button", onClick: () => props.onOpenLink?.("https://example.com", { newWindow: false }) }, "模拟打开外链")
          )
        : null
    );
  });
  return { MarkdownEditor };
});

const openedFile = (overrides: Partial<ReadDocumentResult> = {}): ReadDocumentResult => ({
  filePath: "/tmp/opened.md",
  displayName: "opened.md",
  content: "disk markdown",
  fingerprint: { sha256: "disk-hash", size: 13, mtimeMs: 1 },
  format: { encoding: "utf-8", encodingSupported: true, bom: false, preferredEol: "lf" },
  writable: true,
  draftId: "opened-draft",
  ...overrides
});

const savedResult = (filePath = "/tmp/saved.md"): SaveDocumentResult => ({
  status: "saved",
  revision: 1,
  filePath,
  fingerprint: { sha256: "saved-hash", size: 16, mtimeMs: 2 }
});

beforeEach(() => {
  vi.clearAllMocks();
  bridge.closeHandler = undefined;
  bridge.menuHandler = undefined;
  bridge.openHandler = undefined;
  bridge.dropHandler = undefined;
  bridge.documentHandler = undefined;
  bridge.headingHandler = undefined;
  bridge.quitHandler = undefined;
  bridge.dropRegistrationError = undefined;
  bridge.listRecentFiles.mockResolvedValue([]);
  bridge.listDrafts.mockResolvedValue([]);
  bridge.pickMarkdownFiles.mockResolvedValue([]);
  bridge.pickMarkdownSavePath.mockResolvedValue("/tmp/saved.md");
  bridge.pickExportSavePath.mockResolvedValue("/tmp/opened.html");
  bridge.readDocument.mockResolvedValue(openedFile());
  bridge.saveDocument.mockResolvedValue(savedResult());
  bridge.writeExportDocument.mockResolvedValue("/tmp/opened.html");
  bridge.exportPdf.mockResolvedValue("/tmp/opened.pdf");
  bridge.focusExistingDocumentWindow.mockResolvedValue(false);
  bridge.editorActions.getExportHtml.mockReturnValue("<h1>Exported</h1>");
  bridge.inspectDocument.mockResolvedValue({ status: "current", fingerprint: openedFile().fingerprint });
  bridge.writeDraft.mockResolvedValue(undefined);
  bridge.deleteDraft.mockResolvedValue(undefined);
  bridge.removeRecentFile.mockResolvedValue([]);
  bridge.clearRecentFiles.mockResolvedValue([]);
  bridge.resolveMarkdownLink.mockResolvedValue("/tmp/next.md");
  bridge.openExternalUrl.mockResolvedValue(undefined);
  bridge.openDocumentWindowAt.mockResolvedValue(undefined);
  bridge.openDocumentWindows.mockResolvedValue(undefined);
  bridge.createDocumentWindow.mockResolvedValue(undefined);
  bridge.setWindowDocument.mockResolvedValue(undefined);
  bridge.closeCurrentWindow.mockResolvedValue(undefined);
  bridge.answerQuitRequest.mockResolvedValue(undefined);
  bridge.setWindowTitle.mockResolvedValue(undefined);
  bridge.watchDocument.mockResolvedValue(undefined);
  bridge.stopDocumentWatch.mockResolvedValue(undefined);
  bridge.takePendingOpenPaths.mockResolvedValue([]);
  bridge.takePendingHeadingFragment.mockResolvedValue(undefined);
  bridge.editorActions.jumpToHeading.mockReturnValue(true);
});

afterEach(cleanup);

describe("product workflows", () => {
  it("shows recovery and recent files in the history sidebar and clears history", async () => {
    bridge.listRecentFiles.mockResolvedValue([{
      filePath: "/tmp/recent.md",
      displayName: "recent.md",
      openedAt: Date.now(),
      available: true
    }]);
    bridge.listDrafts.mockResolvedValue([{
      schemaVersion: 1,
      draftId: "draft-1",
      displayName: "recovery.md",
      baseSha256: "new",
      revision: 1,
      markdown: "draft",
      bom: false,
      preferredEol: "lf",
      updatedAt: Date.now()
    }]);
    render(<App />);
    expect(await screen.findByRole("complementary", { name: "文件历史" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: /recovery\.md/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^recent\.md/ })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Nolia Lite" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "清空历史" }));
    await waitFor(() => expect(bridge.clearRecentFiles).toHaveBeenCalledOnce());
  });

  it("reuses an empty window for startup and opens later Finder paths in new windows", async () => {
    bridge.takePendingOpenPaths.mockResolvedValueOnce(["/tmp/startup.md"]);
    render(<App />);
    await waitFor(() => expect(bridge.readDocument).toHaveBeenCalledWith("/tmp/startup.md"));
    await waitFor(() => expect(bridge.openHandler).toBeTypeOf("function"));

    act(() => bridge.openHandler!(["/tmp/later.markdown"]));
    await waitFor(() => expect(bridge.openDocumentWindows).toHaveBeenCalledWith(["/tmp/later.markdown"]));

    bridge.takePendingOpenPaths.mockResolvedValueOnce(["/tmp/focus-fallback.md"]);
    fireEvent.focus(window);
    await waitFor(() => expect(bridge.openDocumentWindows).toHaveBeenCalledWith(["/tmp/focus-fallback.md"]));
  });

  it("still consumes queued Finder paths when an unrelated native listener fails", async () => {
    bridge.dropRegistrationError = new Error("drag-drop listener unavailable");
    bridge.takePendingOpenPaths.mockResolvedValueOnce(["/tmp/isolated-listener.md"]);
    render(<App />);
    await waitFor(() => expect(bridge.readDocument).toHaveBeenCalledWith("/tmp/isolated-listener.md"));
  });

  it("focuses an existing document window instead of opening a duplicate", async () => {
    bridge.pickMarkdownFiles.mockResolvedValue(["/tmp/already-open.md"]);
    bridge.focusExistingDocumentWindow.mockResolvedValue(true);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "打开文件" }));

    await waitFor(() => expect(bridge.focusExistingDocumentWindow).toHaveBeenCalledWith("/tmp/already-open.md"));
    expect(bridge.readDocument).not.toHaveBeenCalled();
  });

  it("creates, edits, saves, and transitions an untitled document to a file session", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "新建文档" }));
    fireEvent.click(await screen.findByRole("button", { name: "模拟编辑" }));
    expect(screen.getByRole("status").textContent).toContain("未保存");
    expect(screen.queryByRole("button", { name: "保存文档" })).toBeNull();
    expect(screen.queryByRole("button", { name: "打开 Markdown 文件" })).toBeNull();
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    await waitFor(() => expect(bridge.saveDocument).toHaveBeenCalledOnce());
    expect(bridge.saveDocument.mock.calls[0][0]).toMatchObject({
      filePath: "/tmp/saved.md",
      content: "changed markdown",
      mode: "saveAs"
    });
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("已保存"));
    expect(screen.getByRole("textbox", { name: "Markdown 文档" }).getAttribute("data-extension-file-path"))
      .toBe("/tmp/saved.md");
  });

  it("does not start a second save while the save path picker is open", async () => {
    let resolvePath: ((path: string) => void) | undefined;
    bridge.pickMarkdownSavePath.mockImplementation(() => new Promise((resolve) => {
      resolvePath = resolve;
    }));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "新建文档" }));
    fireEvent.click(await screen.findByRole("button", { name: "模拟编辑" }));

    fireEvent.keyDown(window, { key: "s", metaKey: true });
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    expect(bridge.pickMarkdownSavePath).toHaveBeenCalledOnce();
    await act(async () => resolvePath!("/tmp/saved.md"));

    await waitFor(() => expect(bridge.saveDocument).toHaveBeenCalledOnce());
  });

  it("opens unsupported encoding as truly readonly and blocks normal save", async () => {
    bridge.pickMarkdownFiles.mockResolvedValue(["/tmp/legacy.md"]);
    bridge.readDocument.mockResolvedValue(openedFile({
      filePath: "/tmp/legacy.md",
      displayName: "legacy.md",
      format: { encoding: "utf-8", encodingSupported: false, bom: false, preferredEol: "lf" },
      writable: false
    }));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "打开文件" }));
    const editor = await screen.findByRole("textbox", { name: "Markdown 文档" });
    expect(editor.getAttribute("data-editable")).toBe("false");
    expect(screen.getByText(/不是受支持的 UTF-8 编码/)).toBeTruthy();
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    expect(bridge.saveDocument).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "模拟编辑" })).toBeNull();
  });

  it("surfaces a save conflict and requires confirmation before force overwrite", async () => {
    bridge.pickMarkdownFiles.mockResolvedValue(["/tmp/opened.md"]);
    bridge.saveDocument
      .mockResolvedValueOnce({ status: "conflict", revision: 1, disk: { sha256: "other", size: 5, mtimeMs: 3 } })
      .mockResolvedValueOnce(savedResult("/tmp/opened.md"));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "打开文件" }));
    fireEvent.click(await screen.findByRole("button", { name: "模拟编辑" }));
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    expect(await screen.findByText(/文件已在其他应用中更改/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "覆盖磁盘文件" }));
    const dialog = await screen.findByRole("dialog", { name: "覆盖磁盘文件" });
    fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((button) => button.textContent === "覆盖磁盘文件")!);
    await waitFor(() => expect(bridge.saveDocument).toHaveBeenCalledTimes(2));
    expect(bridge.saveDocument.mock.calls[1][0].mode).toBe("force");
  });

  it("preserves a dirty untitled draft before closing its window", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "新建文档" }));
    fireEvent.click(await screen.findByRole("button", { name: "模拟编辑" }));
    await waitFor(() => expect(bridge.closeHandler).toBeTypeOf("function"));
    act(() => {
      bridge.closeHandler!();
      bridge.closeHandler!();
    });
    fireEvent.click(await screen.findByRole("button", { name: "保留草稿并退出" }));
    await waitFor(() => expect(bridge.writeDraft).toHaveBeenCalled());
    expect(bridge.writeDraft.mock.calls.at(-1)?.[0].markdown).toBe("changed markdown");
    expect(bridge.closeCurrentWindow).toHaveBeenCalledOnce();
  });

  it("opens multiple dropped Markdown files in separate windows", async () => {
    render(<App />);
    await waitFor(() => expect(bridge.dropHandler).toBeTypeOf("function"));
    act(() => bridge.dropHandler!(["/tmp/dropped.md"]));
    await waitFor(() => expect(bridge.readDocument).toHaveBeenCalledWith("/tmp/dropped.md"));

    act(() => bridge.dropHandler!(["/tmp/one.md", "/tmp/two.md"]));
    await waitFor(() => expect(bridge.openDocumentWindows).toHaveBeenCalledWith(["/tmp/one.md", "/tmp/two.md"]));
    expect(bridge.readDocument).toHaveBeenCalledTimes(1);
  });

  it("reuses an empty window for the first selected file and opens the rest separately", async () => {
    bridge.pickMarkdownFiles.mockResolvedValue(["/tmp/one.md", "/tmp/two.md", "/tmp/three.markdown"]);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "打开文件" }));

    await waitFor(() => expect(bridge.readDocument).toHaveBeenCalledWith("/tmp/one.md"));
    expect(bridge.openDocumentWindows).toHaveBeenCalledWith(["/tmp/two.md", "/tmp/three.markdown"]);
  });

  it("creates a new native window when New is used from an open document", async () => {
    bridge.pickMarkdownFiles.mockResolvedValue(["/tmp/opened.md"]);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "打开文件" }));
    await screen.findByText("disk markdown");
    fireEvent.keyDown(window, { key: "n", metaKey: true });

    await waitFor(() => expect(bridge.createDocumentWindow).toHaveBeenCalledOnce());
  });

  it("answers a native quit request only after the current draft is protected", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "新建文档" }));
    fireEvent.click(await screen.findByRole("button", { name: "模拟编辑" }));
    await waitFor(() => expect(bridge.quitHandler).toBeTypeOf("function"));
    act(() => bridge.quitHandler!(7));
    fireEvent.click(await screen.findByRole("button", { name: "保留草稿并退出" }));

    await waitFor(() => expect(bridge.answerQuitRequest).toHaveBeenCalledWith(7, true));
    expect(bridge.closeCurrentWindow).not.toHaveBeenCalled();
  });

  it("resolves relative Markdown links before switching the document", async () => {
    bridge.pickMarkdownFiles.mockResolvedValue(["/tmp/opened.md"]);
    bridge.readDocument.mockImplementation(async (filePath: string) => openedFile({
      filePath,
      displayName: filePath.endsWith("next.md") ? "next.md" : "opened.md",
      content: filePath.endsWith("next.md") ? "# Section" : "[Next](./next.md#section)"
    }));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "打开文件" }));
    fireEvent.click(await screen.findByRole("button", { name: "模拟打开链接" }));

    await waitFor(() => expect(bridge.resolveMarkdownLink).toHaveBeenCalledWith("/tmp/opened.md", "./next.md"));
    await waitFor(() => expect(bridge.readDocument).toHaveBeenCalledWith("/tmp/next.md"));
    await waitFor(() => expect(bridge.editorActions.jumpToHeading).toHaveBeenCalledWith("section"));
  });

  it("opens external links with the system URL handler", async () => {
    bridge.pickMarkdownFiles.mockResolvedValue(["/tmp/opened.md"]);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "打开文件" }));
    fireEvent.click(await screen.findByRole("button", { name: "模拟打开外链" }));

    await waitFor(() => expect(bridge.openExternalUrl).toHaveBeenCalledWith("https://example.com"));
  });

  it("opens modified relative Markdown links in a new native window", async () => {
    bridge.pickMarkdownFiles.mockResolvedValue(["/tmp/opened.md"]);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "打开文件" }));
    fireEvent.click(await screen.findByRole("button", { name: "模拟新窗口打开链接" }));

    await waitFor(() => expect(bridge.resolveMarkdownLink).toHaveBeenCalledWith("/tmp/opened.md", "./next.md"));
    expect(bridge.openDocumentWindowAt).toHaveBeenCalledWith("/tmp/next.md", "section");
    expect(bridge.readDocument).toHaveBeenCalledTimes(1);
  });

  it("imports dropped images into the current saved document", async () => {
    bridge.pickMarkdownFiles.mockResolvedValue(["/tmp/opened.md"]);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "打开文件" }));
    await waitFor(() => expect(bridge.dropHandler).toBeTypeOf("function"));

    act(() => bridge.dropHandler!(["/tmp/cover.png"]));
    await waitFor(() => expect(bridge.editorActions.insertImageFiles).toHaveBeenCalledWith(["/tmp/cover.png"]));
  });

  it("maps native menu commands to find and every complex editor action", async () => {
    bridge.pickMarkdownFiles.mockResolvedValue(["/tmp/opened.md"]);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "打开文件" }));
    await screen.findByRole("textbox", { name: "Markdown 文档" });
    await waitFor(() => expect(bridge.menuHandler).toBeTypeOf("function"));

    for (const command of [
      "edit.find",
      "edit.copy_code",
      "format.source",
      "format.paragraph",
      "format.heading3",
      "format.blockquote",
      "format.bullet_list",
      "format.ordered_list",
      "format.task_list",
      "format.code_block",
      "format.horizontal_rule",
      "format.image",
      "format.bold",
      "format.italic",
      "format.strike",
      "format.code",
      "format.link",
      "format.table",
      "format.mermaid",
      "format.math"
    ]) act(() => bridge.menuHandler!(command));

    expect(await screen.findByRole("textbox", { name: "在文档中查找" })).toBeTruthy();
    expect(bridge.editorActions.copyCode).toHaveBeenCalledOnce();
    expect(bridge.editorActions.toggleSource).toHaveBeenCalledOnce();
    expect(bridge.editorActions.setParagraph).toHaveBeenCalledOnce();
    expect(bridge.editorActions.toggleHeading).toHaveBeenCalledWith(3);
    expect(bridge.editorActions.toggleBlockquote).toHaveBeenCalledOnce();
    expect(bridge.editorActions.toggleBulletList).toHaveBeenCalledOnce();
    expect(bridge.editorActions.toggleOrderedList).toHaveBeenCalledOnce();
    expect(bridge.editorActions.toggleTaskList).toHaveBeenCalledOnce();
    expect(bridge.editorActions.toggleCodeBlock).toHaveBeenCalledOnce();
    expect(bridge.editorActions.insertHorizontalRule).toHaveBeenCalledOnce();
    expect(bridge.editorActions.insertImage).toHaveBeenCalledOnce();
    expect(bridge.editorActions.toggleBold).toHaveBeenCalledOnce();
    expect(bridge.editorActions.toggleItalic).toHaveBeenCalledOnce();
    expect(bridge.editorActions.toggleStrike).toHaveBeenCalledOnce();
    expect(bridge.editorActions.toggleCode).toHaveBeenCalledOnce();
    expect(bridge.editorActions.editLink).toHaveBeenCalledOnce();
    expect(bridge.editorActions.insertTable).toHaveBeenCalledOnce();
    expect(bridge.editorActions.insertMermaid).toHaveBeenCalledOnce();
    expect(bridge.editorActions.insertMath).toHaveBeenCalledOnce();
  });

  it("exports the rendered document as a standalone HTML file from the native menu", async () => {
    bridge.pickMarkdownFiles.mockResolvedValue(["/tmp/opened.md"]);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "打开文件" }));
    await screen.findByRole("textbox", { name: "Markdown 文档" });
    await waitFor(() => expect(bridge.menuHandler).toBeTypeOf("function"));

    act(() => bridge.menuHandler!("file.export_html"));

    await waitFor(() => expect(bridge.writeExportDocument).toHaveBeenCalledOnce());
    expect(bridge.pickExportSavePath).toHaveBeenCalledWith("html", "/tmp/opened.html");
    expect(bridge.writeExportDocument).toHaveBeenCalledWith(expect.objectContaining({
      filePath: "/tmp/opened.html",
      format: "html",
      content: expect.stringContaining("<h1>Exported</h1>")
    }));
    expect(await screen.findByText("已导出 /tmp/opened.html")).toBeTruthy();
  });

  it("exports PDF directly to the selected path", async () => {
    bridge.pickMarkdownFiles.mockResolvedValue(["/tmp/opened.md"]);
    bridge.pickExportSavePath.mockResolvedValue("/tmp/opened.pdf");
    bridge.exportPdf.mockImplementation(async () => {
      expect(document.documentElement.classList.contains("is-pdf-exporting")).toBe(true);
      return "/tmp/opened.pdf";
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "打开文件" }));
    await waitFor(() => expect(bridge.menuHandler).toBeTypeOf("function"));

    act(() => bridge.menuHandler!("file.export_pdf"));

    await waitFor(() => expect(bridge.exportPdf).toHaveBeenCalledWith("/tmp/opened.pdf"));
    expect(document.documentElement.classList.contains("is-pdf-exporting")).toBe(false);
    expect(bridge.pickExportSavePath).toHaveBeenCalledWith("pdf", "/tmp/opened.pdf");
    expect(await screen.findByText("已导出 /tmp/opened.pdf")).toBeTruthy();
  });

  it("surfaces a clean external file change without replacing the editor", async () => {
    bridge.pickMarkdownFiles.mockResolvedValue(["/tmp/opened.md"]);
    bridge.inspectDocument.mockResolvedValue({
      status: "changed",
      fingerprint: { sha256: "external", size: 15, mtimeMs: 3 }
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "打开文件" }));
    await waitFor(() => expect(bridge.documentHandler).toBeTypeOf("function"));
    act(() => bridge.documentHandler!("/tmp/opened.md"));

    expect(await screen.findByText("磁盘上的文件已更改。")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Markdown 文档" }).textContent).toContain("disk markdown");
    fireEvent.click(screen.getByRole("button", { name: "保留当前内容" }));
    await waitFor(() => expect(screen.queryByText("磁盘上的文件已更改。")).toBeNull());
  });

  it("keeps a recovery draft and recovery actions after a save error", async () => {
    bridge.pickMarkdownFiles.mockResolvedValue(["/tmp/opened.md"]);
    bridge.saveDocument.mockResolvedValue({
      status: "error",
      revision: 1,
      code: "io_error",
      message: "disk full"
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "打开文件" }));
    fireEvent.click(await screen.findByRole("button", { name: "模拟编辑" }));
    fireEvent.keyDown(window, { key: "s", metaKey: true });

    expect((await screen.findByRole("alert")).textContent).toContain("无法保存更改，恢复草稿已保留。");
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "另存为…" })).toBeTruthy();
    await waitFor(() => expect(bridge.writeDraft).toHaveBeenCalled());
    expect(bridge.writeDraft.mock.calls.at(-1)?.[0].markdown).toBe("changed markdown");
  });
});
