// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { EditorContent } from "@tiptap/react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createEditorExtensions } from "./extensions";
import { renderDiagramSvg } from "./mermaidRenderer";
import { parseTrackedMarkdown } from "./sourceDocument";

vi.mock("./mermaidRenderer", () => ({
  renderDiagramSvg: vi.fn(async (source: string) => {
    if (source.includes("INVALID")) throw new Error("Parse error");
    return '<svg viewBox="0 0 100 80"><text>diagram</text></svg>';
  })
}));

const editors: Editor[] = [];

afterEach(() => {
  cleanup();
  editors.splice(0).forEach((editor) => editor.destroy());
  vi.clearAllMocks();
  vi.unstubAllGlobals();
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
    const language = screen.getByRole("textbox", { name: "图表语言" });
    const source = screen.getByRole("textbox", { name: "Mermaid 图表源码" });
    expect((language as HTMLInputElement).value).toBe("mermaid");
    expect((source as HTMLTextAreaElement).value).toBe("graph TD\n  A --> B");
    fireEvent.change(source, { target: { value: "graph TD\n  A --> C" } });
    expect(editor.state.doc.firstChild?.attrs.markdown).toContain("A --> C");
    fireEvent.change(language, { target: { value: "flow" } });
    expect(editor.state.doc.firstChild?.attrs.markdown).toContain("```flow");
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

  it("rerenders the SVG when the system color scheme changes", async () => {
    let dark = false;
    let changeListener: ((event: MediaQueryListEvent) => void) | undefined;
    const mediaQuery = {
      get matches() { return dark; },
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
        changeListener = listener;
      }),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    } as unknown as MediaQueryList;
    vi.stubGlobal("matchMedia", vi.fn(() => mediaQuery));

    renderDiagram();
    await waitFor(() => expect(renderDiagramSvg).toHaveBeenCalledTimes(1));

    act(() => {
      dark = true;
      changeListener?.({ matches: true } as MediaQueryListEvent);
    });

    await waitFor(() => expect(renderDiagramSvg).toHaveBeenCalledTimes(2));
    expect(renderDiagramSvg).toHaveBeenLastCalledWith(expect.stringContaining("graph TD"));
  });
});
