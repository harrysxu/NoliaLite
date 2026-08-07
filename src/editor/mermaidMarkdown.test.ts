import { describe, expect, it } from "vitest";

import { isMermaidFence, mermaidSourceFromMarkdown } from "./mermaidMarkdown";

describe("Mermaid Markdown", () => {
  it("recognizes standard and Nolia-compatible diagram fence names", () => {
    expect(isMermaidFence("mermaid")).toBe(true);
    expect(isMermaidFence("sequenceDiagram title=Login")).toBe(true);
    expect(isMermaidFence("flowchart-elk")).toBe(true);
    expect(isMermaidFence("typescript")).toBe(false);
  });

  it("extracts standard Mermaid bodies from backtick and tilde fences", () => {
    expect(mermaidSourceFromMarkdown("```mermaid\ngraph TD\nA-->B\n```\n")).toBe("graph TD\nA-->B");
    expect(mermaidSourceFromMarkdown("~~~mermaid\r\nsequenceDiagram\r\nA->>B: Hi\r\n~~~")).toBe("sequenceDiagram\r\nA->>B: Hi");
  });

  it("adds the diagram directive for Nolia-compatible shorthand fences", () => {
    expect(mermaidSourceFromMarkdown("```sequenceDiagram\nA->>B: Hi\n```")).toBe("sequenceDiagram\nA->>B: Hi");
    expect(mermaidSourceFromMarkdown("```flowchart\nLR\nA-->B\n```")).toBe("flowchart\nLR\nA-->B");
  });
});
