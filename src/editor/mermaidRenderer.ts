import DOMPurify from "dompurify";
import type { Mermaid } from "mermaid";

import { diagramKindFromMarkdown, diagramMarkdownParts, mermaidSourceFromMarkdown } from "./mermaidMarkdown";

let modulePromise: Promise<Mermaid> | undefined;
let configuredTheme: "default" | "dark" | undefined;
let renderSequence = 0;
let renderQueue: Promise<void> = Promise.resolve();

type SequenceDiagram = {
  drawSVG: (container: HTMLElement, options: { theme: "simple" }) => void;
};

type SequenceDiagramApi = {
  parse: (source: string) => SequenceDiagram;
};

type FlowchartApi = {
  parse: (source: string) => {
    drawSVG: (container: HTMLElement, options: Record<string, string | number>) => void;
  };
};

let sequenceModulePromise: Promise<SequenceDiagramApi> | undefined;
let flowchartModulePromise: Promise<FlowchartApi> | undefined;

const DARK_THEME_VARIABLES = {
  background: "#1c1e20",
  primaryColor: "#2a2d30",
  primaryTextColor: "#eceff1",
  primaryBorderColor: "#63a9ea",
  secondaryColor: "#303438",
  secondaryTextColor: "#eceff1",
  secondaryBorderColor: "#a8adb3",
  tertiaryColor: "#24272a",
  tertiaryTextColor: "#eceff1",
  tertiaryBorderColor: "#7f858b",
  textColor: "#eceff1",
  lineColor: "#b9c0c7",
  arrowheadColor: "#b9c0c7",
  mainBkg: "#2a2d30",
  nodeBorder: "#63a9ea",
  clusterBkg: "#24272a",
  clusterBorder: "#7f858b",
  titleColor: "#eceff1",
  edgeLabelBackground: "#24272a",
  actorBkg: "#2a2d30",
  actorBorder: "#63a9ea",
  actorTextColor: "#eceff1",
  actorLineColor: "#b9c0c7",
  signalColor: "#c9d0d6",
  signalTextColor: "#eceff1",
  labelBoxBkgColor: "#24272a",
  labelBoxBorderColor: "#7f858b",
  labelTextColor: "#eceff1",
  loopTextColor: "#eceff1",
  noteBorderColor: "#d6a04d",
  noteBkgColor: "#382f20",
  noteTextColor: "#eceff1",
  activationBorderColor: "#63a9ea",
  activationBkgColor: "#223d55",
  sequenceNumberColor: "#1c1e20"
};

const LEGACY_SEQUENCE_DARK_COLORS = {
  fill: "#2a2d30",
  line: "#b9c0c7",
  text: "#eceff1"
};

function loadMermaid(): Promise<Mermaid> {
  modulePromise ??= import("mermaid").then((module) => module.default);
  return modulePromise;
}

function currentTheme(): "default" | "dark" {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "default";
}

// Mermaid owns module-level parser state. Serializing work also makes theme changes deterministic.
export function renderMermaidSvg(source: string, idPrefix = "nolia-lite-mermaid"): Promise<string> {
  const job = renderQueue.then(async () => {
    const normalizedSource = source.trim();
    if (!normalizedSource) throw new Error("图表源码为空");

    const mermaid = await loadMermaid();
    const theme = currentTheme();
    if (configuredTheme !== theme) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        theme,
        themeVariables: theme === "dark" ? DARK_THEME_VARIABLES : undefined,
        htmlLabels: false,
        flowchart: { htmlLabels: false }
      });
      configuredTheme = theme;
    }

    const id = `${idPrefix}-${++renderSequence}`;
    return (await mermaid.render(id, normalizedSource)).svg;
  });
  renderQueue = job.then(() => undefined, () => undefined);
  return job;
}

async function loadSequenceDiagram(): Promise<SequenceDiagramApi> {
  sequenceModulePromise ??= Promise.all([import("underscore"), import("raphael")]).then(async ([underscore, raphael]) => {
    const globals = globalThis as typeof globalThis & { _: unknown; Raphael: unknown };
    globals._ = underscore.default;
    globals.Raphael = raphael.default;
    const module = await import("@rokt33r/js-sequence-diagrams/dist/sequence-diagram-raphael.js");
    return (module as unknown as { default?: SequenceDiagramApi; Diagram?: SequenceDiagramApi }).default
      ?? (module as unknown as { Diagram: SequenceDiagramApi }).Diagram;
  });
  return sequenceModulePromise;
}

async function renderSequenceSvg(source: string): Promise<string> {
  const api = await loadSequenceDiagram();
  const container = document.createElement("div");
  api.parse(source.trim()).drawSVG(container, { theme: "simple" });
  const svg = container.querySelector("svg");
  if (!svg) throw new Error("时序图未生成 SVG");
  if (currentTheme() === "dark") applyLegacySequenceDarkTheme(svg);
  return svg.outerHTML;
}

function applyLegacySequenceDarkTheme(svg: SVGSVGElement): void {
  svg.querySelectorAll("text").forEach((element) => {
    element.setAttribute("fill", LEGACY_SEQUENCE_DARK_COLORS.text);
  });
  svg.querySelectorAll("rect").forEach((element) => {
    element.setAttribute("fill", LEGACY_SEQUENCE_DARK_COLORS.fill);
    element.setAttribute("stroke", LEGACY_SEQUENCE_DARK_COLORS.line);
  });
  svg.querySelectorAll("line, polyline").forEach((element) => {
    element.setAttribute("stroke", LEGACY_SEQUENCE_DARK_COLORS.line);
  });
  svg.querySelectorAll("path, polygon").forEach((element) => {
    if (element.getAttribute("stroke") !== "none") {
      element.setAttribute("stroke", LEGACY_SEQUENCE_DARK_COLORS.line);
    }
    if (element.getAttribute("fill") !== "none") {
      element.setAttribute("fill", LEGACY_SEQUENCE_DARK_COLORS.line);
    }
  });
}

async function renderFlowchartSvg(source: string): Promise<string> {
  flowchartModulePromise ??= import("flowchart.js").then((module) =>
    (module as unknown as FlowchartApi & { default?: FlowchartApi }).default
      ?? (module as unknown as FlowchartApi)
  );
  const flowchart = await flowchartModulePromise;
  const container = document.createElement("div");
  const dark = currentTheme() === "dark";
  flowchart.parse(source.trim()).drawSVG(container, {
    "font-color": dark ? "#e7e7e7" : "#252525",
    "line-color": dark ? "#aaaaaa" : "#555555",
    "element-color": dark ? "#aaaaaa" : "#555555",
    fill: dark ? "#242424" : "#ffffff"
  });
  const svg = container.querySelector("svg");
  if (!svg) throw new Error("流程图未生成 SVG");
  return svg.outerHTML;
}

export async function renderDiagramSvg(markdown: string): Promise<string> {
  const kind = diagramKindFromMarkdown(markdown);
  const source = diagramMarkdownParts(markdown).body;
  if (!source.trim()) throw new Error("图表源码为空");
  const svg = kind === "sequence"
    ? await renderSequenceSvg(source)
    : kind === "flow"
      ? await renderFlowchartSvg(source)
      : await renderMermaidSvg(mermaidSourceFromMarkdown(markdown));
  return DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
}
