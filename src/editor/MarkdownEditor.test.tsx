// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { EditorContent } from "@tiptap/react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { MarkdownEditor, type MarkdownEditorHandle } from "./MarkdownEditor";
import {
  applyMarkdownSyntaxSource,
  clearMarkdownSyntaxEditor,
  MarkdownSyntaxEditor,
  openMarkdownSyntaxEditorAtPosition,
  _testing as syntaxTesting
} from "./MarkdownSyntaxEditor";
import { createEditorExtensions } from "./extensions";
import { parseTrackedMarkdown } from "./sourceDocument";

vi.mock("./mermaidRenderer", () => ({
  renderMermaidSvg: vi.fn(async () => '<svg viewBox="0 0 100 80"></svg>')
}));

beforeAll(() => {
  window.requestAnimationFrame = (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  };
  window.cancelAnimationFrame = () => undefined;
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as DOMRectList;
  }
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
  }
  if (!("getBoundingClientRect" in Text.prototype)) {
    Object.defineProperty(Text.prototype, "getBoundingClientRect", { value: () => new DOMRect(0, 0, 0, 0) });
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function sourceText(source: HTMLElement): string {
  return source.textContent ?? "";
}

function replaceSource(source: HTMLElement, markdown: string): void {
  source.textContent = markdown;
  fireEvent.input(source, { inputType: "insertText", data: markdown });
  const range = document.createRange();
  range.selectNodeContents(source);
  range.collapse(false);
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe("MarkdownEditor interactions", () => {
  it("finds repeated text in both directions and wraps around", async () => {
    const ref = createRef<MarkdownEditorHandle>();
    render(<MarkdownEditor ref={ref} value="alpha beta alpha" preferredEol="lf" editable onChange={() => undefined} />);
    await screen.findByLabelText("Markdown 文档");
    const first = ref.current!.find("alpha", "next");
    const second = ref.current!.find("alpha", "next");
    const previous = ref.current!.find("alpha", "previous");
    expect(first.total).toBe(2);
    expect(second.total).toBe(2);
    expect(previous.total).toBe(2);
    expect(new Set([first.current, second.current])).toEqual(new Set([1, 2]));
  });

  it("edits an existing link as local Markdown and navigates only on modified click", async () => {
    const onChange = vi.fn();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { container } = render(
      <MarkdownEditor value="[旧文本](https://example.com)" preferredEol="lf" editable onChange={onChange} />
    );
    const anchor = await waitFor(() => {
      const value = container.querySelector("a");
      if (!value) throw new Error("link not rendered");
      return value;
    });
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => anchor
    });
    fireEvent.mouseDown(anchor, { metaKey: true });
    fireEvent.mouseUp(anchor, { metaKey: true });
    fireEvent.click(anchor, { metaKey: true });
    expect(open).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer");

    fireEvent.mouseDown(anchor);
    const source = await screen.findByRole("textbox", { name: "链接 Markdown 源码" });
    expect(open).toHaveBeenCalledTimes(1);
    expect(sourceText(source)).toBe("[旧文本](https://example.com)");
    expect(source.closest("a")).toBeNull();
    expect(screen.queryByRole("textbox", { name: "链接文本" })).toBeNull();
    replaceSource(source, "[新文本](./new.md)");
    fireEvent.keyDown(source, { key: "Enter" });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.at(-1)?.[0]).toContain("[新文本](./new.md)");
  });

  it("delegates modified relative-link clicks to the document session", async () => {
    const onOpenLink = vi.fn();
    const { container } = render(
      <MarkdownEditor
        value="[下一篇](./next.md#details)"
        filePath="/tmp/current.md"
        preferredEol="lf"
        editable
        onChange={() => undefined}
        onOpenLink={onOpenLink}
      />
    );
    const anchor = await waitFor(() => {
      const value = container.querySelector("a");
      if (!value) throw new Error("link not rendered");
      return value;
    });
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => anchor });
    fireEvent.mouseDown(anchor, { ctrlKey: true });
    fireEvent.mouseUp(anchor, { ctrlKey: true });
    fireEvent.click(anchor, { ctrlKey: true });
    expect(onOpenLink).toHaveBeenCalledWith("./next.md#details");
  });

  it("cancels or rejects existing-link source edits without changing the document", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <MarkdownEditor value="[保留文本](./old.md)" preferredEol="lf" editable onChange={onChange} />
    );
    const openSource = async () => {
      const anchor = await waitFor(() => {
        const value = container.querySelector("a");
        if (!value) throw new Error("link not rendered");
        return value;
      });
      Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => anchor });
      fireEvent.mouseDown(anchor);
      return screen.findByRole("textbox", { name: "链接 Markdown 源码" });
    };

    const cancelled = await openSource();
    replaceSource(cancelled, "[不会保存](./cancelled.md)");
    fireEvent.keyDown(cancelled, { key: "Escape" });
    await waitFor(() => expect(container.querySelector("a")?.textContent).toBe("保留文本"));
    expect(container.querySelector("a")?.getAttribute("href")).toBe("./old.md");
    expect(onChange).not.toHaveBeenCalled();

    const invalid = await openSource();
    replaceSource(invalid, "不是合法的链接 Markdown");
    fireEvent.keyDown(invalid, { key: "Enter" });
    await waitFor(() => expect(invalid.getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getByRole("textbox", { name: "链接 Markdown 源码" })).toBe(invalid);
    expect(container.querySelector("a")?.textContent).toBe("保留文本");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("./old.md");
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(invalid, { key: "Escape" });
  });

  it("preserves nested inline Markdown while editing an existing link", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <MarkdownEditor value="[**粗体**](./old.md)" preferredEol="lf" editable onChange={onChange} />
    );
    const anchor = await waitFor(() => {
      const value = container.querySelector("a");
      if (!value) throw new Error("link not rendered");
      return value;
    });
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => anchor });
    fireEvent.mouseDown(anchor);
    const source = await screen.findByRole("textbox", { name: "链接 Markdown 源码" });
    expect(sourceText(source)).toBe("[**粗体**](./old.md)");
    expect(source.querySelector(".is-bold")?.textContent).toBe("粗体");
    expect(source.querySelector(".is-link-destination")?.textContent).toBe("./old.md");
    replaceSource(source, "[**新粗体**](./new.md)");
    fireEvent.keyDown(source, { key: "Enter" });

    await waitFor(() => expect(container.querySelector("a strong")?.textContent).toBe("新粗体"));
    expect(onChange.mock.calls.at(-1)?.[0]).toContain("[**新粗体**](./new.md)");
  });

  it("keeps the Nolia two-field dialog for command-based link insertion", async () => {
    const ref = createRef<MarkdownEditorHandle>();
    render(
      <MarkdownEditor ref={ref} value="待添加链接" preferredEol="lf" editable onChange={() => undefined} />
    );
    await screen.findByLabelText("Markdown 文档");
    act(() => ref.current!.editLink());

    expect(await screen.findByRole("dialog", { name: "插入链接" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "链接文本" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "链接地址" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "取消" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "确定" })).toBeTruthy();
  });

  it("blocks every programmatic formatting and insertion command in readonly mode", async () => {
    const ref = createRef<MarkdownEditorHandle>();
    const onChange = vi.fn();
    const { container } = render(
      <MarkdownEditor ref={ref} value="readonly" preferredEol="lf" editable={false} onChange={onChange} />
    );
    await screen.findByLabelText("Markdown 文档");
    onChange.mockClear();
    act(() => {
      ref.current!.toggleBold();
      ref.current!.toggleItalic();
      ref.current!.editLink();
      ref.current!.insertTable();
      ref.current!.insertMath();
      ref.current!.insertMermaid();
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(container.querySelector("table")).toBeNull();
    expect(screen.queryByRole("group", { name: "块公式" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Mermaid 图表" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "链接地址" })).toBeNull();
  });

  it("edits a rendered heading as local Markdown and changes its level", async () => {
    let editor: Editor;
    const extensions = [
      ...createEditorExtensions(),
      MarkdownSyntaxEditor.configure({
        onSubmit: (source, markdown) => {
          clearMarkdownSyntaxEditor(editor.view);
          applyMarkdownSyntaxSource(editor, source, markdown);
        },
        onCancel: () => clearMarkdownSyntaxEditor(editor.view)
      })
    ];
    const manager = new MarkdownManager({ extensions });
    editor = new Editor({ extensions, content: parseTrackedMarkdown("## 可编辑标题", manager) });
    const { container } = render(<EditorContent editor={editor} />);
    const heading = await waitFor(() => {
      const value = container.querySelector("h2");
      if (!value) throw new Error("heading not rendered");
      return value;
    });
    act(() => {
      expect(openMarkdownSyntaxEditorAtPosition(editor, 1, heading)).toBe(true);
    });
    expect(syntaxTesting.activeSource(editor.state)).toMatchObject({
      kind: "heading",
      decorateFrom: 1,
      widgetAt: 1
    });

    const source = await screen.findByRole("textbox", { name: "标题 Markdown 源码" });
    expect(sourceText(source)).toBe("## 可编辑标题");
    replaceSource(source, "#### 已修改标题");
    fireEvent.keyDown(source, { key: "Enter" });

    await waitFor(() => expect(container.querySelector("h4")?.textContent).toBe("已修改标题"));
    expect(editor.markdown?.serialize(editor.getJSON())).toContain("#### 已修改标题");
    expect(screen.queryByRole("textbox", { name: "标题 Markdown 源码" })).toBeNull();
    editor.destroy();
  });

  it("opens heading Markdown from a normal pointer press", async () => {
    const { container } = render(
      <MarkdownEditor value={"## 点击标题\n\n正文"} preferredEol="lf" editable onChange={() => undefined} />
    );
    const heading = await waitFor(() => {
      const value = container.querySelector("h2");
      if (!value) throw new Error("heading not rendered");
      return value;
    });
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => heading });
    fireEvent.mouseDown(heading, { button: 0, clientX: 1, clientY: 1 });
    fireEvent.mouseUp(heading, { button: 0, clientX: 1, clientY: 1 });
    fireEvent.click(heading, { button: 0, clientX: 1, clientY: 1 });
    const source = await screen.findByRole("textbox", { name: "标题 Markdown 源码" });
    expect(sourceText(source)).toBe("## 点击标题");
    fireEvent.keyDown(source, { key: "Escape" });
  });

  it("jumps to headings by text or Markdown slug", async () => {
    const ref = createRef<MarkdownEditorHandle>();
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    const { container } = render(
      <MarkdownEditor ref={ref} value={"# 开始\n\n## Detail Section\n\n## Detail Section"} preferredEol="lf" editable onChange={() => undefined} />
    );
    await waitFor(() => expect(container.querySelectorAll("h2")).toHaveLength(2));
    let jumped = false;
    act(() => { jumped = ref.current!.jumpToHeading("detail-section-1"); });
    expect(jumped).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(scrollIntoView.mock.contexts[0]).toBe(container.querySelectorAll("h2")[1]);
  });

  it("edits a blockquote marker in place and can turn it into a paragraph", async () => {
    let editor: Editor;
    const extensions = [
      ...createEditorExtensions(),
      MarkdownSyntaxEditor.configure({
        onSubmit: (source, markdown) => {
          clearMarkdownSyntaxEditor(editor.view);
          applyMarkdownSyntaxSource(editor, source, markdown);
        },
        onCancel: () => clearMarkdownSyntaxEditor(editor.view)
      })
    ];
    const manager = new MarkdownManager({ extensions });
    editor = new Editor({ extensions, content: parseTrackedMarkdown("> 引用内容", manager) });
    const { container } = render(<EditorContent editor={editor} />);
    const blockquote = await waitFor(() => {
      const value = container.querySelector("blockquote");
      if (!value) throw new Error("blockquote not rendered");
      return value;
    });

    act(() => expect(openMarkdownSyntaxEditorAtPosition(editor, 2, blockquote)).toBe(true));
    const source = await screen.findByRole("textbox", { name: "引用 Markdown 源码" });
    expect(sourceText(source)).toBe("> 引用内容");
    replaceSource(source, "普通段落");
    fireEvent.keyDown(source, { key: "Enter" });

    await waitFor(() => expect(container.querySelector("blockquote")).toBeNull());
    expect(container.querySelector("p")?.textContent).toBe("普通段落");
    editor.destroy();
  });

  it("edits one list item marker and converts the list using Nolia semantics", async () => {
    let editor: Editor;
    const extensions = [
      ...createEditorExtensions(),
      MarkdownSyntaxEditor.configure({
        onSubmit: (source, markdown) => {
          clearMarkdownSyntaxEditor(editor.view);
          applyMarkdownSyntaxSource(editor, source, markdown);
        },
        onCancel: () => clearMarkdownSyntaxEditor(editor.view)
      })
    ];
    const manager = new MarkdownManager({ extensions });
    editor = new Editor({ extensions, content: parseTrackedMarkdown("- 第一项\n- 第二项", manager) });
    const { container } = render(<EditorContent editor={editor} />);
    const secondItem = await waitFor(() => {
      const value = container.querySelectorAll("li")[1];
      if (!value) throw new Error("second list item not rendered");
      return value;
    });

    act(() => expect(openMarkdownSyntaxEditorAtPosition(editor, 5, secondItem)).toBe(true));
    const source = await screen.findByRole("textbox", { name: "列表项 Markdown 源码" });
    expect(sourceText(source)).toBe("- 第二项");
    replaceSource(source, "- [x] 已完成");
    fireEvent.keyDown(source, { key: "Enter" });

    await waitFor(() => expect(editor.state.doc.firstChild?.type.name).toBe("taskList"));
    expect(editor.state.doc.firstChild?.child(0).attrs.checked).toBe(false);
    expect(editor.state.doc.firstChild?.child(1).attrs.checked).toBe(true);
    expect(editor.markdown?.serialize(editor.getJSON())).toContain("- [x] 已完成");
    editor.destroy();
  });

  it("keeps task checkboxes as direct toggle controls", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => window.setTimeout(() => callback(0), 0));
    const onChange = vi.fn();
    const { container } = render(
      <MarkdownEditor value="- [ ] 待办事项" preferredEol="lf" editable onChange={onChange} />
    );
    const checkbox = await waitFor(() => {
      const value = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
      if (!value) throw new Error("task checkbox not rendered");
      return value;
    });
    fireEvent.click(checkbox);
    expect(screen.queryByRole("textbox", { name: "列表项 Markdown 源码" })).toBeNull();
    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain("- [x] 待办事项"));
  });

  it("edits inline wrapper characters without switching the whole document to source", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <MarkdownEditor value="前文 **局部格式** 后文" preferredEol="lf" editable onChange={onChange} />
    );
    const strong = await waitFor(() => {
      const value = container.querySelector("strong");
      if (!value) throw new Error("bold text not rendered");
      return value;
    });
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => strong });
    fireEvent.mouseDown(strong, { clientX: 1, clientY: 1 });
    fireEvent.mouseUp(strong, { clientX: 1, clientY: 1 });
    fireEvent.click(strong, { clientX: 1, clientY: 1 });

    const source = await screen.findByRole("textbox", { name: "粗体 Markdown 源码" });
    expect(sourceText(source)).toBe("**局部格式**");
    expect(source.closest("strong")).toBeNull();
    expect(container.querySelectorAll(".markdown-inline-editor")).toHaveLength(1);
    expect(container.querySelector(".markdown-inline-token.is-bold")?.textContent).toBe("局部格式");
    expect(container.querySelectorAll(".markdown-inline-token.is-delimiter")).toHaveLength(2);
    expect(container.textContent).toContain("前文");
    expect(container.textContent).toContain("后文");
    replaceSource(source, "*局部格式*");
    fireEvent.keyDown(source, { key: "Enter" });

    await waitFor(() => expect(container.querySelector("em")?.textContent).toBe("局部格式"));
    expect(container.querySelector("strong")).toBeNull();
    expect(onChange.mock.calls.at(-1)?.[0]).toContain("*局部格式*");
  });

  it("keeps nested inline syntax visually structured while exposing the complete source", () => {
    const markdown = "**外层 [*链接文字*](https://example.com/path) 和 `代码`**";
    const tokens = syntaxTesting.inlineSyntaxTokens(markdown, "bold");

    expect(tokens.map((token) => token.text).join("")).toBe(markdown);
    expect(tokens.find((token) => token.text === "外层 ")?.classes).toContain("is-bold");
    expect(tokens.find((token) => token.text === "链接文字")?.classes).toEqual(
      expect.arrayContaining(["is-bold", "is-italic", "is-link-label"])
    );
    expect(tokens.find((token) => token.text === "https://example.com/path")?.classes).toContain(
      "is-link-destination"
    );
    expect(tokens.find((token) => token.text === "代码")?.classes).toEqual(
      expect.arrayContaining(["is-bold", "is-code"])
    );
    expect(tokens.filter((token) => token.classes.includes("is-delimiter")).map((token) => token.text)).toEqual(
      ["**", "[", "*", "*", "](", ")", "`", "`", "**"]
    );
  });

  it("does not submit an inline syntax session while an IME composition is active", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <MarkdownEditor value="*输入中*" preferredEol="lf" editable onChange={onChange} />
    );
    const italic = await waitFor(() => {
      const value = container.querySelector("em");
      if (!value) throw new Error("italic text not rendered");
      return value;
    });
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => italic });
    fireEvent.mouseDown(italic, { clientX: 1, clientY: 1 });
    const source = await screen.findByRole("textbox", { name: "斜体 Markdown 源码" });

    fireEvent.compositionStart(source);
    source.textContent = "正在输入";
    fireEvent.input(source, { inputType: "insertCompositionText", data: "正在输入", isComposing: true });
    fireEvent.keyDown(source, { key: "Enter", isComposing: true });
    expect(screen.getByRole("textbox", { name: "斜体 Markdown 源码" })).toBe(source);
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.compositionEnd(source);
    fireEvent.keyDown(source, { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "斜体 Markdown 源码" })).toBeNull());
    expect(onChange.mock.calls.at(-1)?.[0]).toContain("正在输入");
  });

  it("pastes plain single-line Markdown and commits edited syntax on blur", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <MarkdownEditor value="**原内容**" preferredEol="lf" editable onChange={onChange} />
    );
    const strong = await waitFor(() => {
      const value = container.querySelector("strong");
      if (!value) throw new Error("bold text not rendered");
      return value;
    });
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => strong });
    fireEvent.mouseDown(strong, { clientX: 1, clientY: 1 });
    const source = await screen.findByRole("textbox", { name: "粗体 Markdown 源码" });

    replaceSource(source, "*");
    fireEvent.paste(source, {
      clipboardData: { getData: (type: string) => type === "text/plain" ? "粘贴\n内容*" : "" }
    });
    expect(sourceText(source)).toBe("*粘贴 内容*");
    expect(source.querySelector(".is-italic")?.textContent).toBe("粘贴 内容");

    fireEvent.blur(source, { relatedTarget: document.body });
    await waitFor(() => expect(container.querySelector("em")?.textContent).toBe("粘贴 内容"));
    expect(onChange.mock.calls.at(-1)?.[0]).toContain("*粘贴 内容*");
  });

  it("cancels local Markdown edits with Escape", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <MarkdownEditor value="~~保留删除线~~" preferredEol="lf" editable onChange={onChange} />
    );
    const strike = await waitFor(() => {
      const value = container.querySelector("s");
      if (!value) throw new Error("strike text not rendered");
      return value;
    });
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => strike });
    fireEvent.mouseDown(strike, { clientX: 1, clientY: 1 });
    fireEvent.mouseUp(strike, { clientX: 1, clientY: 1 });
    fireEvent.click(strike, { clientX: 1, clientY: 1 });

    const source = await screen.findByRole("textbox", { name: "删除线 Markdown 源码" });
    replaceSource(source, "普通文字");
    fireEvent.keyDown(source, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("textbox", { name: "删除线 Markdown 源码" })).toBeNull());
    expect(container.querySelector("s")?.textContent).toBe("保留删除线");
    expect(onChange).not.toHaveBeenCalled();
  });
});
