import { describe, expect, it } from "vitest";

import {
  diagramKindFromMarkdown,
  diagramMarkdownParts,
  isMermaidFence,
  mermaidSourceFromMarkdown,
  updateDiagramMarkdown
} from "./mermaidMarkdown";

describe("Mermaid Markdown", () => {
  it("recognizes standard and Nolia-compatible diagram fence names", () => {
    expect(isMermaidFence("mermaid")).toBe(true);
    expect(isMermaidFence("sequenceDiagram title=Login")).toBe(true);
    expect(isMermaidFence("flowchart-elk")).toBe(true);
    expect(isMermaidFence("sequence")).toBe(true);
    expect(isMermaidFence("flow")).toBe(true);
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

  it("keeps standalone sequence and flow syntaxes separate from Mermaid", () => {
    expect(diagramKindFromMarkdown("```sequence\nAlice->Bob: Hello\n```")).toBe("sequence");
    expect(diagramKindFromMarkdown("```flow\nst=>start: Start\n```")).toBe("flow");
    expect(diagramKindFromMarkdown("```sequenceDiagram\nAlice->>Bob: Hello\n```")).toBe("mermaid");
  });

  it("edits the language and body while preserving the fence style and line ending", () => {
    const markdown = "~~~~mermaid\r\ngraph TD\r\nA-->B\r\n~~~~";
    expect(diagramMarkdownParts(markdown)).toEqual({
      language: "mermaid",
      body: "graph TD\r\nA-->B",
      fence: "~~~~",
      eol: "\r\n"
    });
    expect(updateDiagramMarkdown(markdown, "flow", "st=>start: Start")).toBe(
      "~~~~flow\r\nst=>start: Start\r\n~~~~"
    );
  });
});
