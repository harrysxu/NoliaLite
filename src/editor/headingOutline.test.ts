import { describe, expect, it } from "vitest";

import { extractDocumentHeadings, normalizeHeadingReference, slugifyHeading } from "./headingOutline";

describe("document heading outline", () => {
  it("extracts headings without treating fenced code as navigation items", () => {
    const headings = extractDocumentHeadings("# First\n\n```md\n## Not a heading\n```\n\n## Second\n## Second");
    expect(headings.map(({ level, text, reference }) => ({ level, text, reference }))).toEqual([
      { level: 1, text: "First", reference: "first" },
      { level: 2, text: "Second", reference: "second" },
      { level: 2, text: "Second", reference: "second-1" }
    ]);
  });

  it("uses the same reference normalization as in-document anchors", () => {
    expect(slugifyHeading("中文 Heading 2")).toBe("中文-heading-2");
    expect(normalizeHeadingReference("#中文-heading-2")).toBe("中文-heading-2");
  });
});
