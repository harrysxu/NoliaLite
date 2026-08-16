import type { JSONContent } from "@tiptap/core";
import type { MarkdownManager } from "@tiptap/markdown";
import { marked, type Token } from "marked";

import type { PreferredEol } from "../bridge/contracts";
import { isMermaidFence } from "./mermaidMarkdown";

export const TRACKING_ATTRIBUTES = ["sourceRaw", "sourceCanonical", "sourceIndex"] as const;

export type ProtectedKind = "frontmatter" | "html" | "unsupported";

type SourceUnit = {
  raw: string;
  kind: "editable" | "mermaid" | "math" | "htmlPreview" | "footnote" | ProtectedKind;
  markdown?: string;
};

type PreparedDocument = {
  markdown: string;
  units: SourceUnit[];
};

const frontmatterPattern = /^---(?:\r?\n)[\s\S]*?(?:\r?\n)---[ \t]*(?=\r?\n|$)/;
const unsafeInlinePattern = /\[\[[^\]]+]]|\$\$|\\\(|\\\)|\\\[|\\\]|(^|\n)\s*:::/m;
const referenceLinkPattern = /\[[^\]\n]+]\[[^\]\n]*]/;
const htmlPattern = /<\/?[A-Za-z][^>]*>/;

function isProtectedToken(token: Token): ProtectedKind | undefined {
  if (token.type === "html" || htmlPattern.test(token.raw)) return "html";
  if (token.type === "def" || unsafeInlinePattern.test(token.raw) || referenceLinkPattern.test(token.raw)) {
    return "unsupported";
  }
  return undefined;
}

function isSafeHtmlPreview(raw: string): boolean {
  if (/<\/?(?:script|style|iframe|object|embed|form|input|button|video|audio|source|link|meta|img)\b/i.test(raw)) return false;
  if (/\s(?:on[a-z]+|style|src|srcset|formaction)\s*=/i.test(raw)) return false;
  return true;
}

function sourceUnits(markdown: string): SourceUnit[] {
  const units: SourceUnit[] = [];
  let remaining = markdown;
  const frontmatter = remaining.match(frontmatterPattern)?.[0];
  if (frontmatter) {
    units.push({ raw: frontmatter, kind: "frontmatter" });
    remaining = remaining.slice(frontmatter.length);
  }

  const normalized = remaining.replace(/\r\n/g, "\n");
  const normalizedToOriginal: number[] = [0];
  let originalOffset = 0;
  for (let normalizedOffset = 0; normalizedOffset < normalized.length; normalizedOffset += 1) {
    if (remaining[originalOffset] === "\r" && remaining[originalOffset + 1] === "\n") originalOffset += 2;
    else originalOffset += 1;
    normalizedToOriginal.push(originalOffset);
  }

  let cursor = 0;
  for (const token of marked.lexer(normalized)) {
    const start = normalizedToOriginal[cursor] ?? originalOffset;
    cursor += token.raw.length;
    const end = normalizedToOriginal[cursor] ?? originalOffset;
    const exactRaw = remaining.slice(start, end);
    if (token.type === "space") {
      if (units.length) units[units.length - 1].raw += exactRaw;
      else if (exactRaw) units.push({ raw: exactRaw, kind: "editable" });
      continue;
    }
    if (token.type === "code" && isMermaidFence(token.lang)) {
      units.push({ raw: exactRaw, kind: "mermaid", markdown: exactRaw });
    } else if (/^ {0,3}\$\$(?:\r?\n|[^$])/m.test(exactRaw.trimStart()) && /\$\$[ \t]*(?:\r?\n)?$/.test(exactRaw.trimEnd())) {
      units.push({ raw: exactRaw, kind: "math", markdown: exactRaw });
    } else if (/^ {0,3}\[\^[^\]\n]+]:/.test(exactRaw)) {
      units.push({ raw: exactRaw, kind: "footnote", markdown: exactRaw });
    } else if (token.type === "html" && isSafeHtmlPreview(exactRaw)) {
      units.push({ raw: exactRaw, kind: "htmlPreview", markdown: exactRaw });
    } else {
      units.push({ raw: exactRaw, kind: isProtectedToken(token) ?? "editable" });
    }
  }

  if (!units.length && markdown) units.push({ raw: markdown, kind: "editable" });
  return units;
}

function base64Encode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function protectedPlaceholder(unit: SourceUnit): string {
  return `:::nolia-protected ${unit.kind} ${base64Encode(unit.raw)} :::\n`;
}

function mermaidPlaceholder(unit: SourceUnit): string {
  return `:::nolia-mermaid ${base64Encode(unit.markdown ?? unit.raw)} :::\n`;
}

function complexBlockPlaceholder(unit: SourceUnit): string {
  return `:::nolia-${unit.kind} ${base64Encode(unit.markdown ?? unit.raw)} :::\n`;
}

export function prepareSourceDocument(markdown: string): PreparedDocument {
  const units = sourceUnits(markdown);
  return {
    units,
    markdown: units
      .map((unit) => {
        if (unit.kind === "editable") return unit.raw;
        if (unit.kind === "mermaid") return mermaidPlaceholder(unit);
        if (unit.kind === "math" || unit.kind === "htmlPreview" || unit.kind === "footnote") return complexBlockPlaceholder(unit);
        return protectedPlaceholder(unit);
      })
      .join("")
  };
}

function stripTrackingAttributes(node: JSONContent): JSONContent {
  const attrs = node.attrs ? { ...node.attrs } : undefined;
  if (attrs) {
    for (const key of TRACKING_ATTRIBUTES) delete attrs[key];
  }
  const clean: JSONContent = { ...node };
  if (attrs && Object.keys(attrs).length) clean.attrs = attrs;
  else delete clean.attrs;
  if (node.content) clean.content = node.content.map(stripTrackingAttributes);
  return clean;
}

function canonicalNode(node: JSONContent): string {
  return JSON.stringify(stripTrackingAttributes(node));
}

export function parseTrackedMarkdown(markdown: string, manager: MarkdownManager): JSONContent {
  const prepared = prepareSourceDocument(markdown);
  const parsed = manager.parse(prepared.markdown);
  const nodes = parsed.content ?? [];
  if (nodes.length !== prepared.units.length) return parsed;

  parsed.content = nodes.map((node, index) => {
    const attrs = {
      ...(node.attrs ?? {}),
      sourceRaw: prepared.units[index].raw,
      sourceCanonical: canonicalNode(node),
      sourceIndex: index
    };
    return { ...node, attrs };
  });
  return parsed;
}

function preferredLineEnding(eol: PreferredEol): string {
  return eol === "crlf" ? "\r\n" : "\n";
}

function normalizeGeneratedMarkdown(value: string, eol: PreferredEol): string {
  const lineEnding = preferredLineEnding(eol);
  return value.replace(/\r\n?/g, "\n").replace(/\n/g, lineEnding).trimEnd();
}

function sourceSeparator(raw: string, eol: PreferredEol, isLast: boolean): string {
  const match = raw.match(/((?:[ \t]*\r?\n){2,})$/);
  if (match) return match[1];
  if (isLast) return /\r?\n$/.test(raw) ? preferredLineEnding(eol) : "";
  return preferredLineEnding(eol).repeat(2);
}

export function serializeTrackedMarkdown(
  doc: JSONContent,
  manager: MarkdownManager,
  eol: PreferredEol
): string {
  const nodes = doc.content ?? [];
  return nodes
    .map((node, index) => {
      const raw = typeof node.attrs?.sourceRaw === "string" ? node.attrs.sourceRaw : undefined;
      const canonical = typeof node.attrs?.sourceCanonical === "string" ? node.attrs.sourceCanonical : undefined;
      const sourceIndex = typeof node.attrs?.sourceIndex === "number" ? node.attrs.sourceIndex : undefined;
      const unchanged = raw !== undefined
        && canonical === canonicalNode(node)
        && sourceIndex === index;
      if (unchanged) return raw;

      const clean = stripTrackingAttributes(node);
      const rendered = manager.serialize({ type: "doc", content: [clean] });
      return `${normalizeGeneratedMarkdown(rendered, eol)}${sourceSeparator(raw ?? "", eol, index === nodes.length - 1)}`;
    })
    .join("");
}

export function decodeProtectedRaw(value: string): string {
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return value;
  }
}

export const _testing = { sourceUnits, isProtectedToken, stripTrackingAttributes };
