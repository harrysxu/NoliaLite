import type { Mermaid } from "mermaid";

let modulePromise: Promise<Mermaid> | undefined;
let configuredTheme: "default" | "dark" | undefined;
let renderSequence = 0;
let renderQueue: Promise<void> = Promise.resolve();

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
