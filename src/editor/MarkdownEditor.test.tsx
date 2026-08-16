// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { createRef } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createEditorExtensions } from "./extensions";
import { codeBlockTextAtSelection, MarkdownEditor, type MarkdownEditorHandle } from "./MarkdownEditor";

vi.mock("./mermaidRenderer", () => ({
  renderMermaidSvg: vi.fn(async () => "<svg viewBox=\"0 0 100 80\"></svg>")
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
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MarkdownEditor interactions", () => {
  it("keeps rendered blocks editable in place when clicked", async () => {
    const { container } = render(
      <MarkdownEditor value={"## 标题\n\n**粗体**\n\n> 引用"} preferredEol="lf" editable onChange={() => undefined} />
    );
    const heading = await screen.findByText("标题");
    fireEvent.focus(screen.getByLabelText("Markdown 文档"));
    fireEvent.click(heading);
    expect(container.querySelector("h2")).toBeTruthy();
    expect(container.querySelector("h2")?.classList.contains("is-active-block-syntax")).toBe(true);
    expect(screen.queryByRole("textbox", { name: /Markdown 源码/ })).toBeNull();
  });

  it("toggles a single full-document source editor with Cmd+/ semantics", async () => {
    const ref = createRef<MarkdownEditorHandle>();
    const onChange = vi.fn();
    render(<MarkdownEditor ref={ref} value={"# 标题\n\n正文"} preferredEol="lf" editable onChange={onChange} />);
    await screen.findByLabelText("Markdown 文档");

    act(() => ref.current!.toggleSource());
    const source = await screen.findByRole("textbox", { name: "Markdown 源码" });
    expect((source as HTMLTextAreaElement).value).toBe("# 标题\n\n正文");
    fireEvent.change(source, { target: { value: "# 已修改\n\n正文" } });
    expect(onChange).toHaveBeenLastCalledWith("# 已修改\n\n正文");
    fireEvent.keyDown(source, { key: "/", metaKey: true });
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Markdown 源码" })).toBeNull());
    expect(await screen.findByText("已修改")).toBeTruthy();
  });

  it("keeps source-mode find, code copy, and export on the current source", async () => {
    const ref = createRef<MarkdownEditorHandle>();
    const onError = vi.fn();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(
      <MarkdownEditor
        ref={ref}
        value={"# Old\n\n```js\nold();\n```"}
        preferredEol="lf"
        editable
        onChange={() => undefined}
        onError={onError}
      />
    );
    await screen.findByLabelText("Markdown 文档");

    act(() => ref.current!.toggleSource());
    const source = await screen.findByRole("textbox", { name: "Markdown 源码" });
    fireEvent.change(source, { target: { value: "# Current\n\n```ts\ncurrent();\n```" } });

    expect(ref.current!.getExportHtml()).toContain("<h1>Current</h1>");
    expect(ref.current!.getExportHtml()).toContain("current");
    expect(ref.current!.getExportHtml()).not.toContain("old();");
    expect(ref.current!.find("current();")).toEqual({ current: 1, total: 1 });
    await act(async () => { await ref.current!.copyCode(); });
    expect(writeText).toHaveBeenCalledWith("current();");

    act(() => ref.current!.toggleBold());
    expect(onError).toHaveBeenCalledWith("请先退出源码模式再使用格式命令。");
  });

  it("navigates links on a normal click and marks modified clicks as new-window", async () => {
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
      const value = container.querySelector<HTMLAnchorElement>("a[href]");
      if (!value) throw new Error("link not rendered");
      return value;
    });
    fireEvent.click(anchor);
    expect(onOpenLink).toHaveBeenLastCalledWith("./next.md#details", { newWindow: false });
    fireEvent.click(anchor, { metaKey: true });
    expect(onOpenLink).toHaveBeenLastCalledWith("./next.md#details", { newWindow: true });
  });

  it("copies the current code block with the keyboard command", async () => {
    const ref = createRef<MarkdownEditorHandle>();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<MarkdownEditor ref={ref} value={"```js\nconst answer = 42;\n```"} preferredEol="lf" editable onChange={() => undefined} />);
    await waitFor(() => expect(document.querySelector("pre")?.textContent).toBe("const answer = 42;"));
    const pre = document.querySelector("pre");
    expect(pre).toBeTruthy();
    fireEvent.click(pre!);
    await act(async () => { await ref.current!.copyCode(); });
    expect(writeText).toHaveBeenCalledWith("const answer = 42;");
  });

  it("finds across inline mark boundaries and keeps matches visibly decorated", async () => {
    const ref = createRef<MarkdownEditorHandle>();
    const { container } = render(
      <MarkdownEditor
        ref={ref}
        value="alpha **bold** omega"
        preferredEol="lf"
        editable
        onChange={() => undefined}
      />
    );
    await screen.findByLabelText("Markdown 文档");

    expect(ref.current!.find("alpha bold omega")).toEqual({ current: 1, total: 1 });
    expect(container.querySelectorAll(".find-match").length).toBeGreaterThan(0);
    expect(container.querySelector(".find-match.is-current")).toBeTruthy();

    ref.current!.find("");
    expect(container.querySelector(".find-match")).toBeNull();
  });

  it("finds a top-level code block selected as a node", () => {
    const editor = new Editor({
      extensions: createEditorExtensions(),
      content: {
        type: "doc",
        content: [{ type: "codeBlock", attrs: { language: "js" }, content: [{ type: "text", text: "const selected = true;" }] }]
      }
    });
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)));

    expect(codeBlockTextAtSelection(editor)).toBe("const selected = true;");
    editor.destroy();
  });

  it("rejects unsafe links entered through the link editor", async () => {
    const ref = createRef<MarkdownEditorHandle>();
    const onError = vi.fn();
    render(
      <MarkdownEditor
        ref={ref}
        value="正文"
        preferredEol="lf"
        editable
        onChange={() => undefined}
        onError={onError}
      />
    );
    await screen.findByLabelText("Markdown 文档");
    act(() => ref.current!.editLink());
    const address = await screen.findByRole("textbox", { name: "链接地址" });
    fireEvent.change(address, { target: { value: "javascript:alert(1)" } });
    fireEvent.click(screen.getByRole("button", { name: "确定" }));

    expect(onError).toHaveBeenCalledWith("链接地址不受支持。");
    expect(screen.getByRole("dialog", { name: "插入链接" })).toBeTruthy();
  });
});
