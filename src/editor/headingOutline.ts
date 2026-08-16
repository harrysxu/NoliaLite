import { marked } from "marked";

export type DocumentHeading = {
  id: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  reference: string;
};

export function normalizeHeadingReference(value: string): string {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Keep malformed fragments literal so existing links remain addressable.
  }
  return decoded.trim().toLocaleLowerCase().replace(/^#/, "");
}

export function slugifyHeading(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export function extractDocumentHeadings(markdown: string): DocumentHeading[] {
  const occurrences = new Map<string, number>();
  const headings: DocumentHeading[] = [];
  for (const token of marked.lexer(markdown)) {
    if (token.type !== "heading") continue;
    const text = plainHeadingText(token.text);
    if (!text) continue;
    const baseSlug = slugifyHeading(text);
    const occurrence = occurrences.get(baseSlug) ?? 0;
    occurrences.set(baseSlug, occurrence + 1);
    headings.push({
      id: `heading-${headings.length}`,
      level: token.depth,
      text,
      reference: baseSlug ? (occurrence ? `${baseSlug}-${occurrence}` : baseSlug) : text
    });
  }
  return headings;
}

function plainHeadingText(value: string): string {
  return value
    .replace(/!\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\\([\\`*_[\]{}()#+.!~-])/g, "$1")
    .replace(/[*_~`]/g, "")
    .trim();
}
