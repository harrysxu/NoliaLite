// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { TextSelection } from "@tiptap/pm/state";
import { EditorContent } from "@tiptap/react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createEditorExtensions } from "./extensions";
import { parseTrackedMarkdown } from "./sourceDocument";
import { TableInsertDialog, TableToolbar, _testing } from "./TableToolbar";

const editors: Editor[] = [];

afterEach(() => {
  cleanup();
  editors.splice(0).forEach((editor) => editor.destroy());
});

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as DOMRectList;
}
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
}
if (!("getBoundingClientRect" in Text.prototype)) {
  Object.defineProperty(Text.prototype, "getBoundingClientRect", {
    value: () => new DOMRect(0, 0, 0, 0)
  });
}

function renderTable() {
  const extensions = createEditorExtensions();
  const manager = new MarkdownManager({ extensions });
  const content = parseTrackedMarkdown("| A | B |\n|---|---|\n| 1 | 2 |\n", manager);
  const editor = new Editor({ extensions, content });
  editors.push(editor);
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 4)));
  render(<><EditorContent editor={editor} /><TableToolbar editor={editor} /></>);
  return editor;
}

describe("TableToolbar", () => {
  it("aligns the active cell and exposes Nolia-compatible structure actions", async () => {
    const editor = renderTable();
    const toolbar = await screen.findByRole("toolbar", { name: "表格操作" });
    fireEvent.click(screen.getByRole("button", { name: "居中对齐" }));
    await waitFor(() => expect(editor.getAttributes("tableHeader").align).toBe("center"));

    fireEvent.click(withinElement(toolbar, "更多表格操作"));
    expect(await screen.findByRole("menuitem", { name: "在左侧新增列" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "编辑 Markdown 源码" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "切换表头行" })).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: "在右侧新增列" }));
    expect(tableDimensions(editor)).toEqual({ rows: 2, columns: 3 });
    fireEvent.click(withinElement(toolbar, "更多表格操作"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "在下方新增行" }));
    expect(tableDimensions(editor)).toEqual({ rows: 3, columns: 3 });

    fireEvent.click(withinElement(toolbar, "更多表格操作"));
    fireEvent.click(await screen.findByRole("button", { name: "4 x 4" }));
    expect(tableDimensions(editor)).toEqual({ rows: 4, columns: 4 });
    fireEvent.click(withinElement(toolbar, "更多表格操作"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "切换表头行" }));
    expect(firstTable(editor).firstChild?.firstChild?.type.name).toBe("tableCell");

    fireEvent.click(withinElement(toolbar, "更多表格操作"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "删除当前行" }));
    fireEvent.click(withinElement(toolbar, "更多表格操作"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "删除当前列" }));
    expect(tableDimensions(editor)).toEqual({ rows: 3, columns: 3 });
  });

  it("applies a valid table from the local Markdown source editor", async () => {
    const editor = renderTable();
    await screen.findByRole("toolbar", { name: "表格操作" });
    fireEvent.click(screen.getByRole("button", { name: "更多表格操作" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "编辑 Markdown 源码" }));
    const source = screen.getByRole("textbox", { name: "表格 Markdown 源码" });
    fireEvent.change(source, { target: { value: "| Name | Value |\n|---|---:|\n| Updated | 42 |" } });
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    await waitFor(() => expect(editor.state.doc.textContent).toContain("Updated"));
    expect(editor.state.doc.textContent).toContain("42");
  });

  it("applies valid table source when focus leaves the popover", async () => {
    const editor = renderTable();
    await screen.findByRole("toolbar", { name: "表格操作" });
    fireEvent.click(screen.getByRole("button", { name: "更多表格操作" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "编辑 Markdown 源码" }));
    const source = screen.getByRole("textbox", { name: "表格 Markdown 源码" });
    fireEvent.change(source, { target: { value: "| Key | Result |\n|---|---|\n| blur | applied |" } });
    fireEvent.blur(source, { relatedTarget: document.body });

    await waitFor(() => expect(editor.state.doc.textContent).toContain("applied"));
    expect(screen.queryByRole("dialog", { name: "表格 Markdown 源码" })).toBeNull();
  });

  it("opens the complete table menu from a right click", async () => {
    const editor = renderTable();
    const table = document.querySelector("table")!;
    const target = table.querySelector("th, td")!;
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => target });
    fireEvent.contextMenu(target, { clientX: 1, clientY: 1 });
    expect(await screen.findByRole("menu", { name: "表格操作" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "在左侧新增列" })).toBeTruthy();
    expect(editor.isActive("table")).toBe(true);
  });

  it("inserts the exact table size selected from the grid", () => {
    const onInsert = vi.fn();
    render(<TableInsertDialog open onClose={() => undefined} onInsert={onInsert} />);
    fireEvent.click(screen.getByRole("button", { name: "4 x 5" }));
    expect(onInsert).toHaveBeenCalledWith(4, 5);
  });
});

function firstTable(editor: Editor) {
  const table = editor.state.doc.firstChild;
  if (!table || table.type.name !== "table") throw new Error("Table not found");
  return table;
}

function tableDimensions(editor: Editor) {
  return _testing.tableDimensions(firstTable(editor));
}

function withinElement(element: HTMLElement, name: string): HTMLButtonElement {
  const button = Array.from(element.querySelectorAll("button")).find((candidate) => candidate.getAttribute("aria-label") === name);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${name}`);
  return button;
}
