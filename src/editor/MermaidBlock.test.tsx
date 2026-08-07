// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { EditorContent } from "@tiptap/react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createEditorExtensions } from "./extensions";
import { parseTrackedMarkdown } from "./sourceDocument";

vi.mock("./mermaidRenderer", () => ({
  renderMermaidSvg: vi.fn(async (source: string) => {
    if (source.includes("INVALID")) throw new Error("Parse error");
    return '<svg viewBox="0 0 100 80"><text>diagram</text></svg>';
  })
}));

const editors: Editor[] = [];

afterEach(() => {
  cleanup();
  editors.splice(0).forEach((editor) => editor.destroy());
});

function renderDiagram(onOpenDiagram = vi.fn()) {
  const extensions = createEditorExtensions(undefined, onOpenDiagram);
  const manager = new MarkdownManager({ extensions });
  const content = parseTrackedMarkdown("```mermaid\ngraph TD\n  A --> B\n```\n", manager);
  const editor = new Editor({ extensions, content });
  editors.push(editor);
  render(<EditorContent editor={editor} />);
  return { editor, onOpenDiagram };
}

describe("Mermaid block interactions", () => {
  it("enters local source editing on a normal click and saves the Markdown attribute", async () => {
    const { editor } = renderDiagram();
    const block = await screen.findByRole("group", { name: "Mermaid 图表" });
    await waitFor(() => expect(block.querySelector("svg")).toBeTruthy());
    fireEvent.click(block);
    const source = screen.getByRole("textbox", { name: "Mermaid 图表源码" });
    fireEvent.change(source, { target: { value: "```mermaid\ngraph TD\n  A --> C\n```" } });
    expect(editor.state.doc.firstChild?.attrs.markdown).toContain("A --> C");
    fireEvent.keyDown(source, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Mermaid 图表源码" })).toBeNull();
  });

  it("opens the viewer on a modified click and copies Markdown instead of SVG", async () => {
    const { editor, onOpenDiagram } = renderDiagram();
    const block = await screen.findByRole("group", { name: "Mermaid 图表" });
    await waitFor(() => expect(block.querySelector("svg")).toBeTruthy());
    fireEvent.click(block, { metaKey: true });
    expect(onOpenDiagram).toHaveBeenCalledOnce();
    expect(onOpenDiagram.mock.calls[0][0].svg).toContain("<svg");

    const setData = vi.fn();
    fireEvent.copy(editor.view.dom, { clipboardData: { setData } });
    expect(setData).toHaveBeenCalledWith("text/plain", expect.stringContaining("```mermaid"));
  });
});
