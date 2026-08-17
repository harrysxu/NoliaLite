// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { renderDiagramSvg } from "./mermaidRenderer";

beforeAll(() => {
  if (!SVGSVGElement.prototype.createSVGMatrix) {
    Object.defineProperty(SVGSVGElement.prototype, "createSVGMatrix", {
      value: () => ({ e: 0, f: 0 })
    });
  }
  Object.defineProperty(SVGElement.prototype, "getBBox", {
    configurable: true,
    value: () => ({ x: 0, y: 0, width: 40, height: 20 })
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function useDarkMode(): void {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
}

describe("diagram renderer", () => {
  it("renders flow fences with flowchart.js", async () => {
    const svg = await renderDiagramSvg("```flow\nst=>start: Start\ne=>end: End\nst->e\n```");
    expect(svg).toContain("<svg");
  });

  it("renders sequence fences with js-sequence-diagrams", async () => {
    const svg = await renderDiagramSvg("```sequence\nAlice->Bob: Hello\n```");
    expect(svg).toContain("<svg");
  });

  it("uses visible lines and text for flow fences in dark mode", async () => {
    useDarkMode();
    const svg = await renderDiagramSvg("```flow\nst=>start: Start\ne=>end: End\nst->e\n```");
    expect(svg).toContain("#aaaaaa");
    expect(svg).toContain("#e7e7e7");
    expect(svg).toContain("#242424");
  });

  it("uses visible lines and text for Mermaid sequence diagrams in dark mode", { timeout: 15_000 }, async () => {
    useDarkMode();
    const svg = await renderDiagramSvg("```mermaid\nsequenceDiagram\n  Alice->>Bob: Hello\n```");
    expect(svg).toContain("#b9c0c7");
    expect(svg).toContain("#eceff1");
    expect(svg).toContain("#2a2d30");
  });

  it("recolors legacy sequence fences in dark mode", async () => {
    useDarkMode();
    const svg = await renderDiagramSvg("```sequence\nAlice->Bob: Hello\n```");
    expect(svg).toContain("#b9c0c7");
    expect(svg).toContain("#eceff1");
    expect(svg).toContain("#2a2d30");
  });
});
