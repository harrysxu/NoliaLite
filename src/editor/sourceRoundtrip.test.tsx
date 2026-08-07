// @vitest-environment jsdom

import { MarkdownManager } from "@tiptap/markdown";
import { describe, expect, it } from "vitest";

import { createEditorExtensions } from "./extensions";
import { parseTrackedMarkdown, serializeTrackedMarkdown } from "./sourceDocument";

function manager() {
  return new MarkdownManager({ extensions: createEditorExtensions() });
}

describe("source-preserving Markdown pipeline", () => {
  it("round-trips untouched CRLF, frontmatter, HTML and supported blocks exactly", () => {
    const source = [
      "---",
      "title: Demo # keep comment",
      "---",
      "",
      "# Heading",
      "",
      "Paragraph with **bold**.",
      "",
      "<details><summary>Raw</summary>value</details>",
      ""
    ].join("\r\n");
    const markdown = manager();
    const parsed = parseTrackedMarkdown(source, markdown);
    expect(serializeTrackedMarkdown(parsed, markdown, "crlf")).toBe(source);
  });

  it("reuses untouched blocks when one heading changes", () => {
    const source = "# Original\n\nParagraph   with spacing.\n\n[[Unsupported]]\n";
    const markdown = manager();
    const parsed = parseTrackedMarkdown(source, markdown);
    const heading = parsed.content?.[0];
    if (!heading?.content?.[0]) throw new Error("Heading was not parsed");
    heading.content[0] = { ...heading.content[0], text: "Changed" };
    const result = serializeTrackedMarkdown(parsed, markdown, "lf");
    expect(result).toContain("# Changed");
    expect(result).toContain("Paragraph   with spacing.\n\n");
    expect(result).toContain("[[Unsupported]]\n");
  });

  it("round-trips untouched Mermaid source exactly", () => {
    const source = "~~~mermaid\r\nflowchart LR\r\n  A --> B\r\n~~~\r\n\r\nParagraph\r\n";
    const markdown = manager();
    const parsed = parseTrackedMarkdown(source, markdown);
    expect(parsed.content?.[0]?.type).toBe("mermaidBlock");
    expect(serializeTrackedMarkdown(parsed, markdown, "crlf")).toBe(source);
  });

  it("serializes edited Mermaid Markdown instead of generated SVG", () => {
    const source = "```mermaid\ngraph TD\n  A --> B\n```\n";
    const markdown = manager();
    const parsed = parseTrackedMarkdown(source, markdown);
    const diagram = parsed.content?.[0];
    if (!diagram?.attrs) throw new Error("Mermaid block was not parsed");
    diagram.attrs.markdown = "```mermaid\ngraph TD\n  A --> C\n```";
    expect(serializeTrackedMarkdown(parsed, markdown, "lf")).toBe("```mermaid\ngraph TD\n  A --> C\n```\n");
  });

  it("round-trips formulas, footnotes and safe HTML exactly", () => {
    const source = [
      "Paragraph with $E = mc^2$ and a footnote[^note].",
      "",
      "$$",
      "\\int_0^1 x^2 \\, dx",
      "$$",
      "",
      "[^note]: Exact definition.",
      "",
      "<details><summary>More</summary>Safe HTML</details>",
      ""
    ].join("\n");
    const markdown = manager();
    const parsed = parseTrackedMarkdown(source, markdown);
    expect(parsed.content?.map((node) => node.type)).toEqual(["paragraph", "mathBlock", "footnoteBlock", "htmlBlock"]);
    expect(parsed.content?.[0]?.content?.some((node) => node.type === "inlineMath")).toBe(true);
    expect(parsed.content?.[0]?.content?.some((node) => node.type === "footnoteReference")).toBe(true);
    expect(serializeTrackedMarkdown(parsed, markdown, "lf")).toBe(source);
  });

  it("keeps invalid executable HTML on the protected source path", () => {
    const source = "<script>alert('no')</script>\n";
    const markdown = manager();
    const parsed = parseTrackedMarkdown(source, markdown);
    expect(parsed.content?.[0]?.type).toBe("protectedBlock");
    expect(serializeTrackedMarkdown(parsed, markdown, "lf")).toBe(source);
  });
});
