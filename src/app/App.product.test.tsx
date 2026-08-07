// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReadDocumentResult, SaveDocumentResult } from "../bridge/contracts";
import { App } from "./App";

const bridge = vi.hoisted(() => ({
  closeHandler: undefined as undefined | ((preventDefault: () => void) => void),
  menuHandler: undefined as undefined | ((command: string) => void),
  openHandler: undefined as undefined | ((paths: string[]) => void),
  dropHandler: undefined as undefined | ((paths: string[]) => void),
  documentHandler: undefined as undefined | ((filePath: string) => void),
  quitHandler: undefined as undefined | ((requestId: number) => void),
  dropRegistrationError: undefined as Error | undefined,
  editorActions: {
    toggleBold: vi.fn(),
    toggleItalic: vi.fn(),
    editLink: vi.fn(),
    insertTable: vi.fn(),
    insertMermaid: vi.fn(),
    insertMath: vi.fn(),
    getExportHtml: vi.fn(),
    jumpToHeading: vi.fn()
  },
  listRecentFiles: vi.fn(),
  listDrafts: vi.fn(),
  pickMarkdownFiles: vi.fn(),
  pickMarkdownSavePath: vi.fn(),
  pickExportSavePath: vi.fn(),
  exportPdf: vi.fn(),
  readDocument: vi.fn(),
  saveDocument: vi.fn(),
  writeExportDocument: vi.fn(),
  inspectDocument: vi.fn(),
  writeDraft: vi.fn(),
  deleteDraft: vi.fn(),
  removeRecentFile: vi.fn(),
  resolveMarkdownLink: vi.fn(),
  openExternalUrl: vi.fn(),
  openDocumentWindows: vi.fn(),
  createDocumentWindow: vi.fn(),
  setWindowDocument: vi.fn(),
  closeCurrentWindow: vi.fn(),
  answerQuitRequest: vi.fn(),
  setWindowTitle: vi.fn(),
  watchDocument: vi.fn(),
  stopDocumentWatch: vi.fn(),
  takePendingOpenPaths: vi.fn()
}));

vi.mock("../bridge/tauriClient", () => ({
  isTauriRuntime: () => true,
  listRecentFiles: bridge.listRecentFiles,
  listDrafts: bridge.listDrafts,
  pickMarkdownFiles: bridge.pickMarkdownFiles,
  pickMarkdownSavePath: bridge.pickMarkdownSavePath,
  pickExportSavePath: bridge.pickExportSavePath,
  exportPdf: bridge.exportPdf,
  readDocument: bridge.readDocument,
  saveDocument: bridge.saveDocument,
  writeExportDocument: bridge.writeExportDocument,
  inspectDocument: bridge.inspectDocument,
  writeDraft: bridge.writeDraft,
  deleteDraft: bridge.deleteDraft,
  removeRecentFile: bridge.removeRecentFile,
  resolveMarkdownLink: bridge.resolveMarkdownLink,
  openExternalUrl: bridge.openExternalUrl,
  openDocumentWindows: bridge.openDocumentWindows,
  createDocumentWindow: bridge.createDocumentWindow,
  setWindowDocument: bridge.setWindowDocument,
  closeCurrentWindow: bridge.closeCurrentWindow,
  answerQuitRequest: bridge.answerQuitRequest,
  setWindowTitle: bridge.setWindowTitle,
  watchDocument: bridge.watchDocument,
  stopDocumentWatch: bridge.stopDocumentWatch,
  takePendingOpenPaths: bridge.takePendingOpenPaths,
  onDocumentFileEvent: vi.fn(async (handler: (filePath: string) => void) => {
    bridge.documentHandler = handler;
    return () => undefined;
  }),
  onOpenDocumentPaths: vi.fn(async (handler: (paths: string[]) => void) => {
    bridge.openHandler = handler;
    return () => undefined;
  }),
  onWindowFileDrop: vi.fn(async (handler: (paths: string[]) => void) => {
    if (bridge.dropRegistrationError) throw bridge.dropRegistrationError;
    bridge.dropHandler = handler;
    return () => undefined;
  }),
  onCloseRequested: vi.fn(async (handler: (preventDefault: () => void) => void) => {
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
    props: { value: string; editable: boolean; onChange: (value: string) => void; onOpenLink?: (href: string) => void },
    ref: React.ForwardedRef<Record<string, () => void>>
  ) {
    React.useImperativeHandle(ref, () => ({
      focus: () => undefined,
      toggleBold: bridge.editorActions.toggleBold,
      toggleItalic: bridge.editorActions.toggleItalic,
      editLink: bridge.editorActions.editLink,
      undo: () => undefined,
      redo: () => undefined,
      insertTable: bridge.editorActions.insertTable,
      insertMermaid: bridge.editorActions.insertMermaid,
      insertMath: bridge.editorActions.insertMath,
      getExportHtml: bridge.editorActions.getExportHtml,
      find: () => ({ current: 0, total: 0 }),
      jumpToHeading: bridge.editorActions.jumpToHeading
    }));
    return React.createElement(
      "div",
      { role: "textbox", "aria-label": "Markdown 文档", "data-editable": String(props.editable) },
      React.createElement("span", null, props.value),
      props.editable
        ? React.createElement(
            React.Fragment,
            null,
            React.createElement("button", { type: "button", onClick: () => props.onChange("changed markdown") }, "模拟编辑"),
            React.createElement("button", { type: "button", onClick: () => props.onOpenLink?.("./next.md#section") }, "模拟打开链接"),
            React.createElement("button", { type: "button", onClick: () => props.onOpenLink?.("https://example.com") }, "模拟打开外链")
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
  bridge.editorActions.getExportHtml.mockReturnValue("<h1>Exported</h1>");
  bridge.inspectDocument.mockResolvedValue({ status: "current", fingerprint: openedFile().fingerprint });
  bridge.writeDraft.mockResolvedValue(undefined);
  bridge.deleteDraft.mockResolvedValue(undefined);
  bridge.removeRecentFile.mockResolvedValue([]);
  bridge.resolveMarkdownLink.mockResolvedValue("/tmp/next.md");
  bridge.openExternalUrl.mockResolvedValue(undefined);
  bridge.openDocumentWindows.mockResolvedValue(undefined);
  bridge.createDocumentWindow.mockResolvedValue(undefined);
  bridge.setWindowDocument.mockResolvedValue(undefined);
  bridge.closeCurrentWindow.mockResolvedValue(undefined);
  bridge.answerQuitRequest.mockResolvedValue(undefined);
  bridge.setWindowTitle.mockResolvedValue(undefined);
  bridge.watchDocument.mockResolvedValue(undefined);
  bridge.stopDocumentWatch.mockResolvedValue(undefined);
  bridge.takePendingOpenPaths.mockResolvedValue([]);
  bridge.editorActions.jumpToHeading.mockReturnValue(true);
});

afterEach(cleanup);

describe("product workflows", () => {
  it("loads recovery and recent-file entry points without adding workspace UI", async () => {
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
    expect(await screen.findByRole("button", { name: /recovery\.md/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /recent\.md/ })).toBeTruthy();
    expect(screen.queryByText(/工作区|文件树|标签页/)).toBeNull();
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
    const preventDefault = vi.fn();
    act(() => bridge.closeHandler!(preventDefault));
    expect(preventDefault).toHaveBeenCalledOnce();
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

  it("maps native menu commands to find and every complex editor action", async () => {
    bridge.pickMarkdownFiles.mockResolvedValue(["/tmp/opened.md"]);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "打开文件" }));
    await screen.findByRole("textbox", { name: "Markdown 文档" });
    await waitFor(() => expect(bridge.menuHandler).toBeTypeOf("function"));

    for (const command of [
      "edit.find",
      "format.bold",
      "format.italic",
      "format.link",
      "format.table",
      "format.mermaid",
      "format.math"
    ]) act(() => bridge.menuHandler!(command));

    expect(await screen.findByRole("textbox", { name: "在文档中查找" })).toBeTruthy();
    expect(bridge.editorActions.toggleBold).toHaveBeenCalledOnce();
    expect(bridge.editorActions.toggleItalic).toHaveBeenCalledOnce();
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
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "打开文件" }));
    await waitFor(() => expect(bridge.menuHandler).toBeTypeOf("function"));

    act(() => bridge.menuHandler!("file.export_pdf"));

    await waitFor(() => expect(bridge.exportPdf).toHaveBeenCalledWith("/tmp/opened.pdf"));
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
