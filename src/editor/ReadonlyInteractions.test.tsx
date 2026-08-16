// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { EditorContent } from "@tiptap/react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createEditorExtensions } from "./extensions";
import { parseTrackedMarkdown } from "./sourceDocument";

vi.mock("./mermaidRenderer", () => ({
  renderDiagramSvg: vi.fn(async () => '<svg viewBox="0 0 100 80"></svg>')
}));

const editors: Editor[] = [];

afterEach(() => {
  cleanup();
  editors.splice(0).forEach((editor) => editor.destroy());
});

describe("readonly complex content", () => {
  it("allows viewing and copying but exposes no local source editors", async () => {
    const openDiagram = vi.fn();
    const markdown = `---
title: Locked
---

![locked](./locked.png)

$x$

$$
y = 2
$$

[^locked]: definition

\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`
`;
    const extensions = createEditorExtensions(undefined, openDiagram, false);
    const manager = new MarkdownManager({ extensions });
    const editor = new Editor({ extensions, content: parseTrackedMarkdown(markdown, manager), editable: false });
    editors.push(editor);
    const before = editor.getJSON();
    render(<EditorContent editor={editor} />);

    const protectedSource = screen.getByRole("textbox", { name: "Frontmatter 源码" }) as HTMLTextAreaElement;
    expect(protectedSource.readOnly).toBe(true);
    fireEvent.click(await screen.findByRole("group", { name: "Markdown 图片" }));
    fireEvent.click(await screen.findByRole("group", { name: "块公式" }));
    const diagram = await screen.findByRole("group", { name: "Mermaid 图表" });
    await waitFor(() => expect(diagram.querySelector("svg")).toBeTruthy());
    fireEvent.click(diagram);
    expect(screen.queryByRole("textbox", { name: "图片 Markdown 源码" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "块公式 Markdown 源码" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "脚注引用源码" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Mermaid 图表源码" })).toBeNull();

    fireEvent.click(diagram, { metaKey: true });
    expect(openDiagram).toHaveBeenCalledOnce();
    expect(editor.getJSON()).toEqual(before);
  });
});
