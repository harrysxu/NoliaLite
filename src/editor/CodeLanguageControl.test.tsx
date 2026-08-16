// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { TextSelection } from "@tiptap/pm/state";
import { EditorContent } from "@tiptap/react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { CodeLanguageControl, normalizeCodeBlockLanguage } from "./CodeLanguageControl";
import { createEditorExtensions } from "./extensions";
import { parseTrackedMarkdown } from "./sourceDocument";

vi.mock("./mermaidRenderer", () => ({
  renderDiagramSvg: vi.fn(async () => '<svg viewBox="0 0 100 80"></svg>')
}));

const editors: Editor[] = [];

beforeAll(() => {
  window.requestAnimationFrame = (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  };
  window.cancelAnimationFrame = () => undefined;
});

afterEach(() => {
  cleanup();
  editors.splice(0).forEach((editor) => editor.destroy());
});

function renderCodeBlock(editable = true, language = "javascript") {
  const extensions = createEditorExtensions(undefined, undefined, editable);
  const manager = new MarkdownManager({ extensions });
  const content = parseTrackedMarkdown(`\`\`\`${language}\nconst value = 1;\n\`\`\`\n`, manager);
  const editor = new Editor({ extensions, content, editable });
  editors.push(editor);
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)));
  render(<><EditorContent editor={editor} /><CodeLanguageControl editor={editor} /></>);
  return editor;
}

describe("code language control", () => {
  it("updates the selected code fence language", async () => {
    const editor = renderCodeBlock();
    fireEvent.change(await screen.findByRole("combobox", { name: "代码语言" }), {
      target: { value: "typescript" }
    });
    expect(editor.state.doc.firstChild?.attrs.language).toBe("typescript");
  });

  it("converts a code block to a Mermaid block without losing source text", async () => {
    const editor = renderCodeBlock();
    fireEvent.change(await screen.findByRole("combobox", { name: "代码语言" }), {
      target: { value: "mermaid" }
    });
    expect(editor.state.doc.firstChild?.type.name).toBe("mermaidBlock");
    expect(editor.state.doc.firstChild?.attrs.markdown).toContain("const value = 1;");
  });

  it("normalizes the same language aliases as Nolia", async () => {
    renderCodeBlock(true, "js");
    expect((await screen.findByRole("combobox", { name: "代码语言" }) as HTMLSelectElement).value).toBe("javascript");
    expect(normalizeCodeBlockLanguage("TS")).toBe("typescript");
    expect(normalizeCodeBlockLanguage("zsh")).toBe("bash");
    expect(normalizeCodeBlockLanguage("yml")).toBe("yaml");
    expect(normalizeCodeBlockLanguage("scss")).toBe("css");
  });

  it("copies the complete code block without Markdown fences", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    renderCodeBlock();
    fireEvent.click(await screen.findByRole("button", { name: "复制代码" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("const value = 1;"));
    expect(screen.getByRole("button", { name: "已复制" })).toBeTruthy();
  });

  it("does not expose a language mutation control in readonly mode", () => {
    renderCodeBlock(false);
    expect(screen.queryByRole("combobox", { name: "代码语言" })).toBeNull();
    expect(screen.getByRole("button", { name: "复制代码" })).toBeTruthy();
  });
});
