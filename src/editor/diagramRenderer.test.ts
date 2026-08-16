// @vitest-environment jsdom

import { beforeAll, describe, expect, it } from "vitest";

import { renderDiagramSvg } from "./mermaidRenderer";

beforeAll(() => {
  if (!SVGSVGElement.prototype.createSVGMatrix) {
    Object.defineProperty(SVGSVGElement.prototype, "createSVGMatrix", {
      value: () => ({ e: 0, f: 0 })
    });
  }
});

describe("diagram renderer", () => {
  it("renders flow fences with flowchart.js", async () => {
    const svg = await renderDiagramSvg("```flow\nst=>start: Start\ne=>end: End\nst->e\n```");
    expect(svg).toContain("<svg");
  });

  it("renders sequence fences with js-sequence-diagrams", async () => {
    const svg = await renderDiagramSvg("```sequence\nAlice->Bob: Hello\n```");
    expect(svg).toContain("<svg");
  });
});
