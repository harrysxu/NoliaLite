// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { EditorContent } from "@tiptap/react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createEditorExtensions } from "./extensions";
import { parseTrackedMarkdown } from "./sourceDocument";

const editors: Editor[] = [];

afterEach(() => {
  cleanup();
  editors.splice(0).forEach((editor) => editor.destroy());
});

function renderMarkdown(markdown: string) {
  const extensions = createEditorExtensions();
  const manager = new MarkdownManager({ extensions });
  const editor = new Editor({ extensions, content: parseTrackedMarkdown(markdown, manager) });
  editors.push(editor);
  render(<EditorContent editor={editor} />);
  return editor;
}

describe("protected source and image interactions", () => {
  it("updates Frontmatter through its exact protected source editor", () => {
    const editor = renderMarkdown("---\ntitle: Original\n---\n\nBody\n");
    const source = screen.getByRole("textbox", { name: "Frontmatter 源码" });
    fireEvent.change(source, { target: { value: "---\ntitle: Updated\n---\n" } });
    expect(editor.state.doc.firstChild?.type.name).toBe("protectedBlock");
    expect(editor.state.doc.firstChild?.attrs.raw).toBe("---\ntitle: Updated\n---\n");
  });

  it("parses valid local image Markdown and preserves invalid source for correction", async () => {
    const editor = renderMarkdown('![Old](./old.png "Old title")\n');
    const image = await screen.findByRole("group", { name: "Markdown 图片" });
    fireEvent.click(image);
    const source = screen.getByRole("textbox", { name: "图片 Markdown 源码" });
    fireEvent.change(source, { target: { value: '![New](./new.png "New title")' } });
    await waitFor(() => expect(editor.state.doc.firstChild?.attrs.src).toBe("./new.png"));
    expect(editor.state.doc.firstChild?.attrs.alt).toBe("New");
    expect(editor.state.doc.firstChild?.attrs.title).toBe("New title");

    fireEvent.change(source, { target: { value: "![incomplete](" } });
    expect(editor.state.doc.firstChild?.attrs.markdown).toBe("![incomplete](");
    expect(image.classList.contains("has-source-error")).toBe(true);
    expect(editor.state.doc.firstChild?.attrs.src).toBe("./new.png");
  });
});
