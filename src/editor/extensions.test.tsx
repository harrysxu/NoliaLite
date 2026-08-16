// @vitest-environment jsdom

import { Editor, type JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createEditorExtensions, isAllowedLink } from "./extensions";

const imageBridge = vi.hoisted(() => ({
  storeDocumentImage: vi.fn(async () => "assets/cover.png")
}));

vi.mock("../bridge/tauriClient", () => ({
  readLocalImage: vi.fn(async () => undefined),
  storeDocumentImage: imageBridge.storeDocumentImage
}));

beforeEach(() => {
  imageBridge.storeDocumentImage.mockClear();
});

describe("Markdown editor extensions", () => {
  it("allows document-local links and rejects paths the backend cannot resolve", () => {
    expect(isAllowedLink("./next.md#section")).toBe(true);
    expect(isAllowedLink("next.md#section")).toBe(true);
    expect(isAllowedLink("#section")).toBe(true);
    expect(isAllowedLink("../outside.md")).toBe(true);
    expect(isAllowedLink("/absolute.md")).toBe(true);
  });

  it.each([
    ["# ", "heading"],
    ["> ", "blockquote"],
    ["- ", "bulletList"],
    ["1. ", "orderedList"],
    ["``` ", "codeBlock"]
  ])("converts %s into a %s block while typing", (input, expectedType) => {
    const editor = new Editor({ extensions: createEditorExtensions(), content: "" });
    const position = editor.state.selection.from;
    let handled = false;
    editor.view.someProp("handleTextInput", (handler) => {
      handled = handler(
        editor.view,
        position,
        position,
        input,
        () => editor.state.tr.insertText(input, position, position)
      ) || handled;
      return handled;
    });
    expect(handled).toBe(true);
    expect(editor.state.doc.firstChild?.type.name).toBe(expectedType);
    editor.destroy();
  });

  it("converts a complete task marker into a task list", () => {
    const editor = new Editor({ extensions: createEditorExtensions(), content: "" });
    const position = editor.state.selection.from;
    let handled = false;
    editor.view.someProp("handleTextInput", (handler) => {
      handled = handler(
        editor.view,
        position,
        position,
        "- [ ] ",
        () => editor.state.tr.insertText("- [ ] ", position, position)
      ) || handled;
      return handled;
    });
    const document = editor.state.doc.toJSON() as JSONContent;
    expect(handled).toBe(true);
    expect(document.content?.[0]?.type).toBe("taskList");
    expect(document.content?.[0]?.content?.[0]?.attrs?.checked).toBe(false);
    editor.destroy();
  });

  it("preserves the checked state from a task marker", () => {
    const editor = new Editor({ extensions: createEditorExtensions(), content: "" });
    const position = editor.state.selection.from;
    editor.view.someProp("handleTextInput", (handler) =>
      handler(
        editor.view,
        position,
        position,
        "- [x] ",
        () => editor.state.tr.insertText("- [x] ", position, position)
      )
    );
    const document = editor.state.doc.toJSON() as JSONContent;
    expect(document.content?.[0]?.content?.[0]?.attrs?.checked).toBe(true);
    editor.destroy();
  });

  it("inserts Markdown-only clipboard text as document structure", () => {
    const editor = new Editor({ extensions: createEditorExtensions(), content: "" });
    const event = pasteEvent("# 粘贴标题\n\n- 第一项\n- 第二项", "");
    expect(runPaste(editor, event)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(editor.state.doc.child(0).type.name).toBe("heading");
    expect(editor.state.doc.child(1).type.name).toBe("bulletList");
    editor.destroy();
  });

  it("keeps external rich text on the plain-text safety path", () => {
    const editor = new Editor({ extensions: createEditorExtensions(), content: "" });
    const event = pasteEvent("# 外部文本", "<h1>外部文本</h1>");
    expect(runPaste(editor, event)).toBe(true);
    expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
    expect(editor.state.doc.textContent).toBe("# 外部文本");
    editor.destroy();
  });

  it("does not fall back to HTML insertion when rich clipboard text is empty", () => {
    const editor = new Editor({ extensions: createEditorExtensions(), content: "" });
    const event = pasteEvent("", "<img src=x onerror=alert(1)>");
    expect(runPaste(editor, event)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(editor.state.doc.textContent).toBe("");
    editor.destroy();
  });

  it("copies Markdown and restores Lite clipboard content structurally", () => {
    const source = new Editor({ extensions: createEditorExtensions(), content: "<p><strong>粗体</strong></p>" });
    source.view.dispatch(source.state.tr.setSelection(TextSelection.create(source.state.doc, 1, 3)));
    const values = new Map<string, string>();
    const copyEvent = {
      clipboardData: { setData: (type: string, value: string) => values.set(type, value) },
      preventDefault: vi.fn()
    } as unknown as ClipboardEvent;
    let copied = false;
    source.view.someProp("handleDOMEvents", (handlers) => {
      copied = handlers.copy?.(source.view, copyEvent) || copied;
      return copied;
    });
    expect(copied).toBe(true);
    expect(values.get("text/plain")).toBe("**粗体**");
    expect(values.get("text/html")).toContain("data-nolia-lite-clipboard");

    const target = new Editor({ extensions: createEditorExtensions(), content: "" });
    expect(runPaste(target, pasteEvent(values.get("text/plain") ?? "", values.get("text/html") ?? ""))).toBe(true);
    expect(target.state.doc.firstChild?.firstChild?.marks[0]?.type.name).toBe("bold");
    source.destroy();
    target.destroy();
  });

  it("stores pasted image bytes and inserts a relative Markdown image", async () => {
    const editor = new Editor({ extensions: createEditorExtensions("/tmp/note.md"), content: "" });
    const file = {
      name: "cover.png",
      type: "image/png",
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer
    } as File;
    const event = {
      clipboardData: { files: [file], getData: () => "" },
      preventDefault: vi.fn()
    } as unknown as ClipboardEvent;

    expect(runPaste(editor, event)).toBe(true);
    await vi.waitFor(() => expect(imageBridge.storeDocumentImage).toHaveBeenCalledWith(
      "/tmp/note.md",
      "cover.png",
      Uint8Array.from([1, 2, 3])
    ));
    await vi.waitFor(() => {
      let imageSource = "";
      editor.state.doc.descendants((node) => {
        if (node.type.name === "image") imageSource = String(node.attrs.src);
      });
      expect(imageSource).toBe("assets/cover.png");
    });
    editor.destroy();
  });

  it("does not store pasted image bytes in a read-only document", () => {
    const editor = new Editor({
      extensions: createEditorExtensions("/tmp/note.md", undefined, false),
      content: "",
      editable: false
    });
    const file = {
      name: "cover.png",
      type: "image/png",
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer
    } as File;
    const event = {
      clipboardData: { files: [file], getData: () => "" },
      preventDefault: vi.fn()
    } as unknown as ClipboardEvent;

    expect(runPaste(editor, event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(imageBridge.storeDocumentImage).not.toHaveBeenCalled();
    editor.destroy();
  });

  it("does not handle Markdown text paste in a read-only document", () => {
    const editor = new Editor({
      extensions: createEditorExtensions(undefined, undefined, false),
      content: "<p>原文</p>",
      editable: false
    });
    const event = pasteEvent("# 不应插入", "");

    expect(runPaste(editor, event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(editor.state.doc.textContent).toBe("原文");
    editor.destroy();
  });
});

function pasteEvent(text: string, html: string) {
  return {
    clipboardData: {
      getData: (type: string) => type === "text/plain" ? text : type === "text/html" ? html : ""
    },
    preventDefault: vi.fn()
  } as unknown as ClipboardEvent & { preventDefault: ReturnType<typeof vi.fn> };
}

function runPaste(editor: Editor, event: ClipboardEvent): boolean {
  let handled = false;
  editor.view.someProp("handlePaste", (handler) => {
    handled = handler(editor.view, event, null as never) || handled;
    return handled;
  });
  return handled;
}
