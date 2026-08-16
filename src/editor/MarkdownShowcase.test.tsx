// @vitest-environment jsdom
/// <reference types="node" />

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Editor } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { EditorContent } from "@tiptap/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createEditorExtensions } from "./extensions";
import { parseTrackedMarkdown, serializeTrackedMarkdown } from "./sourceDocument";

vi.mock("./mermaidRenderer", () => ({
  renderDiagramSvg: vi.fn(async () => '<svg viewBox="0 0 160 90"><text>Diagram</text></svg>')
}));

const editors: Editor[] = [];
const showcasePath = resolve(process.cwd(), "docs/MARKDOWN_ELEMENT_SHOWCASE.md");

afterEach(() => {
  cleanup();
  editors.splice(0).forEach((editor) => editor.destroy());
});

describe("Markdown element showcase", () => {
  it("round-trips the page-level acceptance document byte for byte", () => {
    const source = readFileSync(showcasePath, "utf8");
    const extensions = createEditorExtensions(showcasePath);
    const manager = new MarkdownManager({ extensions });
    const parsed = parseTrackedMarkdown(source, manager);
    expect(serializeTrackedMarkdown(parsed, manager, "lf")).toBe(source);
  });

  it("renders every display family used for product acceptance", async () => {
    const source = readFileSync(showcasePath, "utf8");
    const extensions = createEditorExtensions(showcasePath);
    const manager = new MarkdownManager({ extensions });
    const editor = new Editor({ extensions, content: parseTrackedMarkdown(source, manager) });
    editors.push(editor);
    const { container } = render(<EditorContent editor={editor} />);

    expect(container.querySelectorAll("h1, h2, h3, h4, h5, h6").length).toBeGreaterThanOrEqual(20);
    expect(container.querySelectorAll("table")).toHaveLength(3);
    expect(container.querySelectorAll("table:nth-of-type(n) th").length).toBeGreaterThanOrEqual(10);
    expect(container.querySelectorAll("pre code").length).toBeGreaterThanOrEqual(3);
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(3);
    expect(container.querySelector("blockquote blockquote")?.textContent).toContain("嵌套引用");
    expect(container.querySelector("strong")?.textContent).toBeTruthy();
    expect(container.querySelector("em")?.textContent).toBeTruthy();
    expect(container.querySelector("s")?.textContent).toBeTruthy();
    expect(container.querySelector("script")).toBeNull();
    expect(await screen.findAllByRole("group", { name: "Markdown 图片" })).toHaveLength(3);
    expect(screen.getByRole("group", { name: "块公式" })).toBeTruthy();
    expect(screen.getAllByRole("group", { name: "脚注定义" })).toHaveLength(2);
    await waitFor(() => expect(screen.getAllByRole("group", { name: "Mermaid 图表" })).toHaveLength(2));
  });
});
