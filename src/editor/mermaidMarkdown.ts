const mermaidFenceDirectives = new Map<string, string>([
  ["architecture", "architecture-beta"],
  ["architecture-beta", "architecture-beta"],
  ["block", "block"],
  ["block-beta", "block"],
  ["c4component", "C4Component"],
  ["c4container", "C4Container"],
  ["c4context", "C4Context"],
  ["c4deployment", "C4Deployment"],
  ["c4dynamic", "C4Dynamic"],
  ["classdiagram", "classDiagram"],
  ["classdiagram-v2", "classDiagram-v2"],
  ["erdiagram", "erDiagram"],
  ["eventmodeling", "eventmodeling"],
  ["flowchart", "flowchart"],
  ["flowchart-elk", "flowchart-elk"],
  ["flowchart-v2", "flowchart"],
  ["gantt", "gantt"],
  ["gitgraph", "gitGraph"],
  ["graph", "graph"],
  ["info", "info"],
  ["ishikawa", "ishikawa"],
  ["ishikawa-beta", "ishikawa-beta"],
  ["journey", "journey"],
  ["kanban", "kanban"],
  ["mermaid", ""],
  ["mindmap", "mindmap"],
  ["packet", "packet"],
  ["packet-beta", "packet-beta"],
  ["pie", "pie"],
  ["quadrantchart", "quadrantChart"],
  ["radar-beta", "radar-beta"],
  ["requirement", "requirementDiagram"],
  ["requirementdiagram", "requirementDiagram"],
  ["sankey", "sankey"],
  ["sankey-beta", "sankey-beta"],
  ["sequencediagram", "sequenceDiagram"],
  ["statediagram", "stateDiagram"],
  ["statediagram-v2", "stateDiagram-v2"],
  ["timeline", "timeline"],
  ["treeview-beta", "treeView-beta"],
  ["treemap", "treemap"],
  ["treemap-beta", "treemap-beta"],
  ["venn-beta", "venn-beta"],
  ["wardley-beta", "wardley-beta"],
  ["xychart", "xychart"],
  ["xychart-beta", "xychart-beta"]
]);

export type DiagramKind = "mermaid" | "sequence" | "flow";

export type DiagramMarkdownParts = {
  language: string;
  body: string;
  fence: string;
  eol: "\n" | "\r\n";
};

const standaloneDiagramLanguages = new Set<DiagramKind>(["sequence", "flow"]);

function mermaidFenceDirective(info: string | undefined): string | undefined {
  const language = info?.trim().split(/\s+/, 1)[0].toLowerCase();
  return language ? mermaidFenceDirectives.get(language) : undefined;
}

export function isMermaidFence(info: string | undefined): boolean {
  const language = info?.trim().split(/\s+/, 1)[0].toLowerCase();
  return Boolean(language && (standaloneDiagramLanguages.has(language as DiagramKind) || mermaidFenceDirectives.has(language)));
}

export function diagramMarkdownParts(markdown: string): DiagramMarkdownParts {
  const opening = markdown.match(/^ {0,3}(`{3,}|~{3,})\s*([^\r\n]*)\r?\n?/);
  if (!opening) {
    return { language: "mermaid", body: markdown.trim(), fence: "```", eol: "\n" };
  }

  const fence = opening[1];
  const escapedFence = fence[0] === "`" ? "`" : "~";
  const closing = new RegExp(`(?:\\r?\\n)? {0,3}${escapedFence}{${fence.length},}[ \\t]*(?:\\r?\\n)?$`);
  const body = markdown.slice(opening[0].length).replace(closing, "").trimEnd();
  return {
    language: opening[2].trim(),
    body,
    fence,
    eol: markdown.includes("\r\n") ? "\r\n" : "\n"
  };
}

export function updateDiagramMarkdown(markdown: string, language: string, body: string): string {
  const parts = diagramMarkdownParts(markdown);
  const info = language.trim();
  const normalizedBody = body.replace(/[\r\n]+$/, "");
  return `${parts.fence}${info}${parts.eol}${normalizedBody}${parts.eol}${parts.fence}`;
}

export function diagramKindFromMarkdown(markdown: string): DiagramKind {
  const language = diagramMarkdownParts(markdown).language.toLowerCase().split(/\s+/, 1)[0];
  return standaloneDiagramLanguages.has(language as DiagramKind) ? language as DiagramKind : "mermaid";
}

export function mermaidSourceFromMarkdown(markdown: string): string {
  const parts = diagramMarkdownParts(markdown);
  const directive = mermaidFenceDirective(parts.language);
  const body = parts.body;
  if (!directive || new RegExp(`^${escapeRegExp(directive)}\\b`).test(body.trimStart())) return body;
  return `${directive}\n${body}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
