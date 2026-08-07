// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { EditorContent } from "@tiptap/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createEditorExtensions } from "./extensions";
import { parseTrackedMarkdown } from "./sourceDocument";

vi.mock("./mermaidRenderer", () => ({
  renderMermaidSvg: vi.fn(async () => '<svg viewBox="0 0 120 80"><text>Flow</text></svg>')
}));

const editors: Editor[] = [];

afterEach(() => {
  cleanup();
  editors.splice(0).forEach((editor) => editor.destroy());
});

const showcase = `# 展示标题

普通段落包含 **粗体**、*斜体*、~~删除线~~、\`行内代码\`、[链接](./target.md)、$a^2+b^2=c^2$ 和脚注[^display]。

> 克制的引用内容

- 无序项目
- 第二项

1. 有序项目
2. 第二项

- [x] 已完成
- [ ] 未完成

\`\`\`javascript
const answer = true;
\`\`\`

| 名称 | 数值 |
|:---|---:|
| Alpha | 42 |

![本地示意图](./images/example.png "示意")

$$
E = mc^2
$$

<section><strong>安全 HTML</strong></section>

[^display]: 脚注正文

\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`
`;

describe("Markdown display matrix", () => {
  it("renders every supported presentation family in one document", async () => {
    const extensions = createEditorExtensions();
    const manager = new MarkdownManager({ extensions });
    const editor = new Editor({ extensions, content: parseTrackedMarkdown(showcase, manager) });
    editors.push(editor);
    const { container } = render(<EditorContent editor={editor} />);

    expect(screen.getByRole("heading", { level: 1, name: "展示标题" })).toBeTruthy();
    expect(container.querySelector("strong")?.textContent).toContain("粗体");
    expect(container.querySelector("em")?.textContent).toBe("斜体");
    expect(container.querySelector("s")?.textContent).toBe("删除线");
    expect(container.querySelector("blockquote")?.textContent).toContain("克制的引用内容");
    expect(container.querySelectorAll("ol > li").length).toBe(2);
    expect(container.querySelectorAll('input[type="checkbox"]').length).toBe(2);
    expect((container.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
    expect(container.querySelector("pre code")?.className).toContain("language-javascript");
    expect(container.querySelector("pre .hljs-keyword")?.textContent).toBe("const");
    expect(container.querySelector("table")?.textContent).toContain("Alpha");
    expect((await screen.findByRole("group", { name: "Markdown 图片" })).textContent).toContain("本地示意图");
    expect(container.querySelector(".inline-math .katex")).toBeTruthy();
    expect((await screen.findByRole("group", { name: "块公式" })).querySelector(".katex-display")).toBeTruthy();
    expect(screen.getByRole("group", { name: "HTML 块" }).textContent).toContain("安全 HTML");
    expect(screen.getByRole("group", { name: "脚注定义" }).textContent).toContain("脚注正文");
    await waitFor(() => expect(screen.getByRole("group", { name: "Mermaid 图表" }).querySelector("svg")).toBeTruthy());
  });

  it("never places executable HTML in the preview DOM", () => {
    const source = '<section onclick="alert(1)">unsafe</section>\n<script>alert(2)</script>\n';
    const extensions = createEditorExtensions();
    const manager = new MarkdownManager({ extensions });
    const editor = new Editor({ extensions, content: parseTrackedMarkdown(source, manager) });
    editors.push(editor);
    const { container } = render(<EditorContent editor={editor} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("[onclick]")).toBeNull();
    expect(screen.getAllByText(/原始 HTML/).length).toBeGreaterThan(0);
  });
});
