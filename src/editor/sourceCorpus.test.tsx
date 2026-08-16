import { MarkdownManager } from "@tiptap/markdown";
import { describe, expect, it } from "vitest";

import { createEditorExtensions } from "./extensions";
import { parseTrackedMarkdown, prepareSourceDocument, serializeTrackedMarkdown } from "./sourceDocument";

const corpus = [
  "---",
  "title: 保真语料",
  "tags: [alpha, beta]",
  "---",
  "",
  "# 标题 😀",
  "",
  "段落包含 **粗体**、*斜体*、~~删除线~~、`code`、[相对链接](../guide.md) 和 $x^2$。",
  "",
  "> 引用中的中文与 e\u0301 组合字符",
  "",
  "- 无序列表",
  "  - 嵌套项目",
  "",
  "1. 有序列表",
  "2. 第二项",
  "",
  "- [x] 完成",
  "- [ ] 待办",
  "",
  "````markdown",
  "围栏中保留 ``` 与反引号",
  "````",
  "",
  "| 名称 | 空值 | 右对齐 |",
  "|:---|---|---:|",
  "| A\\|B | | 42 |",
  "",
  "![中文图片](../assets/%E7%A4%BA%E6%84%8F%20%E5%9B%BE.png \"标题\")",
  "",
  "$$",
  "\\sum_{i=1}^{n} i",
  "$$",
  "",
  "<section><strong>安全 HTML</strong></section>",
  "",
  "[^note]: 脚注定义",
  "",
  "```sequenceDiagram",
  "sequenceDiagram",
  "  Alice->>Bob: Hello",
  "```",
  "",
  "[[受保护的 Wiki Link]]",
  "",
  "---"
].join("\r\n");

describe("Markdown acceptance corpus", () => {
  it("keeps angle-bracket placeholders inside fenced code blocks", () => {
    const markdown = "```text\nwss://{workspace}<model_name>\nAuthorization: Bearer <DASHSCOPE_API_KEY>\n```";
    const manager = new MarkdownManager({ extensions: createEditorExtensions() });
    const prepared = prepareSourceDocument(markdown);
    expect(prepared.units).toHaveLength(1);
    expect(prepared.units[0].kind).toBe("editable");
    const parsed = parseTrackedMarkdown(markdown, manager);
    expect(parsed.content?.[0]?.type).toBe("codeBlock");
    expect(serializeTrackedMarkdown(parsed, manager, "lf")).toBe(markdown);
  });

  it("round-trips all MVP families with CRLF and no trailing newline", () => {
    const manager = new MarkdownManager({ extensions: createEditorExtensions() });
    const parsed = parseTrackedMarkdown(corpus, manager);
    expect(serializeTrackedMarkdown(parsed, manager, "crlf")).toBe(corpus);
  });

  it("accounts for every source byte before editor parsing", () => {
    const prepared = prepareSourceDocument(corpus);
    expect(prepared.units.map((unit) => unit.raw).join("")).toBe(corpus);
    expect(prepared.units.some((unit) => unit.kind === "frontmatter")).toBe(true);
    expect(prepared.units.some((unit) => unit.kind === "mermaid")).toBe(true);
    expect(prepared.units.some((unit) => unit.kind === "math")).toBe(true);
    expect(prepared.units.some((unit) => unit.kind === "htmlPreview")).toBe(true);
    expect(prepared.units.some((unit) => unit.kind === "footnote")).toBe(true);
    expect(prepared.units.some((unit) => unit.kind === "unsupported")).toBe(true);
  });

  it("opens and composes a 2 MB, 10,000-line document within the engineering budget", { timeout: 15_000 }, () => {
    const line = `- 性能语料 ${"x".repeat(188)}\n`;
    const large = line.repeat(10_000).slice(0, 2 * 1024 * 1024);
    const manager = new MarkdownManager({ extensions: createEditorExtensions() });
    const started = performance.now();
    const parsed = parseTrackedMarkdown(large, manager);
    const composed = serializeTrackedMarkdown(parsed, manager, "lf");
    const elapsed = performance.now() - started;
    expect(composed).toBe(large);
    expect(elapsed).toBeLessThan(5_000);
  });
});
