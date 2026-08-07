import { describe, expect, it } from "vitest";

import { _testing, prepareSourceDocument } from "./sourceDocument";

describe("source document preparation", () => {
  it("keeps frontmatter as an exact protected source unit", () => {
    const markdown = "---\r\ntitle: Demo\r\n---\r\n\r\n# Heading\r\n";
    const prepared = prepareSourceDocument(markdown);
    expect(prepared.units[0]).toEqual({
      raw: "---\r\ntitle: Demo\r\n---\r\n\r\n",
      kind: "frontmatter"
    });
    expect(prepared.units[1].kind).toBe("editable");
  });

  it("protects raw HTML and unsupported inline syntax", () => {
    const units = _testing.sourceUnits("<script>alert(1)</script>\n\n[[Wiki]]\n\nPlain\n");
    expect(units.map((unit) => unit.kind)).toEqual(["html", "unsupported", "editable"]);
    expect(units.map((unit) => unit.raw).join("")).toBe("<script>alert(1)</script>\n\n[[Wiki]]\n\nPlain\n");
  });

  it("previews only static HTML and protects executable HTML", () => {
    const units = _testing.sourceUnits("<details><summary>More</summary>Text</details>\n\n<iframe src=\"https://example.com\"></iframe>\n");
    expect(units.map((unit) => unit.kind)).toEqual(["htmlPreview", "html"]);
  });

  it("does not classify supported GFM content as protected", () => {
    const units = _testing.sourceUnits("# Title\n\n- [ ] Task\n\n| A | B |\n|---|---|\n| 1 | 2 |\n");
    expect(units.every((unit) => unit.kind === "editable")).toBe(true);
  });

  it("extracts Mermaid fences as renderable source units", () => {
    const source = "```mermaid\r\nsequenceDiagram\r\n  A->>B: hello\r\n```\r\n\r\nAfter\r\n";
    const units = _testing.sourceUnits(source);
    expect(units[0]).toMatchObject({
      kind: "mermaid",
      markdown: "```mermaid\r\nsequenceDiagram\r\n  A->>B: hello\r\n```"
    });
    expect(units.map((unit) => unit.raw).join("")).toBe(source);
  });
});
