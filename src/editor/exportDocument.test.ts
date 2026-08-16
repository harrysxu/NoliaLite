// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { createExportHtml, snapshotEditorHtml } from "./exportDocument";

describe("document export", () => {
  it("creates a standalone UTF-8 HTML document and escapes the title", () => {
    const html = createExportHtml('A < B & "C"', "<h1>正文</h1>");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<meta charset=\"utf-8\">");
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("<title>A &lt; B &amp; &quot;C&quot;</title>");
    expect(html).toContain("<article class=\"nolia-export\"><h1>正文</h1></article>");
  });

  it("removes editor-only controls while preserving rendered diagrams and protected source", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="mermaid-block is-selected"><textarea>source</textarea><div class="mermaid-block-svg"><svg><text>Flow</text></svg></div></div>
      <div class="protected-source"><div class="protected-source-label">Frontmatter</div><textarea>---\ntitle: Test\n---</textarea></div>
      <p contenteditable="true" tabindex="0" aria-label="paragraph">Text</p>
      <p><strong>Rendered bold</strong></p>
      <a href="javascript:alert(1)" onclick="alert(2)">unsafe link</a>
      <a href="vbscript:alert(3)">unsafe legacy link</a>
    `;

    const html = snapshotEditorHtml(root);
    expect(html).not.toContain("textarea");
    expect(html).not.toContain("is-selected");
    expect(html).not.toContain("contenteditable");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("vbscript:");
    expect(html).not.toContain("onclick");
    expect(html).toContain("<svg><text>Flow</text></svg>");
    expect(html).toContain("Rendered bold");
    expect(html).toContain("title: Test");
  });
});
