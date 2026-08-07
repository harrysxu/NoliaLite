// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorContent } from "@tiptap/react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createEditorExtensions } from "./extensions";
import { parseTrackedMarkdown } from "./sourceDocument";

const editors: Editor[] = [];

afterEach(() => {
  cleanup();
  editors.splice(0).forEach((editor) => editor.destroy());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderComplexDocument() {
  const markdown = `Inline $x$ and note[^note].

$$
y = 2
$$

<section><strong>Safe HTML</strong></section>

[^note]: original definition
`;
  const extensions = createEditorExtensions();
  const manager = new MarkdownManager({ extensions });
  const editor = new Editor({ extensions, content: parseTrackedMarkdown(markdown, manager) });
  editors.push(editor);
  const view = render(<EditorContent editor={editor} />);
  return { editor, ...view };
}

describe("complex Markdown block interactions", () => {
  it("edits math, HTML, and footnotes locally while keeping preview HTML inert", async () => {
    const { editor, container } = renderComplexDocument();

    fireEvent.click(await screen.findByRole("group", { name: "块公式" }));
    const blockMath = screen.getByRole("textbox", { name: "块公式 Markdown 源码" });
    fireEvent.change(blockMath, { target: { value: "$$\ny = 3\n$$" } });
    expect(nodeByType(editor, "mathBlock")?.attrs.markdown).toContain("y = 3");
    fireEvent.keyDown(blockMath, { key: "Escape" });

    fireEvent.click(screen.getByRole("group", { name: "HTML 块" }));
    const html = screen.getByRole("textbox", { name: "HTML 块 Markdown 源码" });
    fireEvent.change(html, {
      target: { value: "<section><em>Updated</em><script>window.bad = true</script></section>" }
    });
    await waitFor(() => expect(screen.getByRole("group", { name: "HTML 块" }).textContent).toContain("Updated"));
    expect(container.querySelector("script")).toBeNull();
    fireEvent.keyDown(html, { key: "Escape" });

    const inlineMathNode = await waitFor(() => {
      const value = container.querySelector(".inline-math");
      if (!value) throw new Error("Inline math not rendered");
      return value;
    });
    fireEvent.click(inlineMathNode);
    const inlineMath = screen.getByRole("textbox", { name: "行内公式源码" });
    fireEvent.change(inlineMath, { target: { value: "$z$" } });
    expect(nodeByType(editor, "inlineMath")?.attrs.latex).toBe("z");
    fireEvent.keyDown(inlineMath, { key: "Enter" });

    const footnoteReference = await waitFor(() => {
      const value = container.querySelector(".footnote-reference");
      if (!value) throw new Error("Footnote reference not rendered");
      return value;
    });
    fireEvent.click(footnoteReference);
    const reference = screen.getByRole("textbox", { name: "脚注引用源码" });
    fireEvent.change(reference, { target: { value: "[^next]" } });
    expect(nodeByType(editor, "footnoteReference")?.attrs.label).toBe("next");
    expect(String(nodeByType(editor, "footnoteBlock")?.attrs.markdown).trimEnd()).toBe("[^next]: original definition");
    fireEvent.keyDown(reference, { key: "Enter" });

    fireEvent.click(screen.getByRole("group", { name: "脚注定义" }));
    const definition = screen.getByRole("textbox", { name: "脚注定义 Markdown 源码" });
    fireEvent.change(definition, { target: { value: "[^next]: updated definition" } });
    await waitFor(() => expect(screen.getByRole("group", { name: "脚注定义" }).textContent).toContain("updated definition"));
  });

  it("keeps invalid inline math source open until it is fixed or cancelled", async () => {
    const { editor, container } = renderComplexDocument();
    const inlineMathNode = await waitFor(() => {
      const value = container.querySelector(".inline-math");
      if (!value) throw new Error("Inline math not rendered");
      return value;
    });
    fireEvent.click(inlineMathNode);
    const input = screen.getByRole("textbox", { name: "行内公式源码" });
    fireEvent.change(input, { target: { value: "missing delimiters" } });

    expect(nodeByType(editor, "inlineMath")?.attrs.markdown).toBe("missing delimiters");
    expect(nodeByType(editor, "inlineMath")?.attrs.latex).toBe("x");
    expect(container.querySelector(".inline-math")?.classList.contains("has-source-error")).toBe(true);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("textbox", { name: "行内公式源码" })).toBeTruthy();
    fireEvent.blur(input, { relatedTarget: document.body });
    expect(screen.getByRole("textbox", { name: "行内公式源码" })).toBeTruthy();

    fireEvent.change(input, { target: { value: "$z$" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "行内公式源码" })).toBeNull());
    expect(nodeByType(editor, "inlineMath")?.attrs.latex).toBe("z");
  });

  it("jumps from a modified footnote reference to its definition", async () => {
    const { container } = renderComplexDocument();
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView
    });
    vi.stubGlobal("CSS", { escape: (value: string) => value });

    const footnoteReference = await waitFor(() => {
      const value = container.querySelector(".footnote-reference");
      if (!value) throw new Error("Footnote reference not rendered");
      return value;
    });
    fireEvent.click(footnoteReference, { metaKey: true });
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(screen.queryByRole("textbox", { name: "脚注引用源码" })).toBeNull();
  });
});

function nodeByType(editor: Editor, type: string) {
  let found: ProseMirrorNode | undefined;
  editor.state.doc.descendants((node) => {
    if (node.type.name === type) {
      found = node;
      return false;
    }
    return true;
  });
  return found;
}
