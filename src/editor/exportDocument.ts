const EXPORT_STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #222; }
body { font: 16px/1.68 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; }
.nolia-export { width: min(880px, calc(100% - 64px)); margin: 56px auto 80px; }
.nolia-export p { margin: 0 0 1em; }
.nolia-export h1, .nolia-export h2, .nolia-export h3, .nolia-export h4, .nolia-export h5, .nolia-export h6 { color: #171717; font-weight: 680; }
.nolia-export h1 { margin: 36px 0 16px; font-size: 32px; line-height: 1.25; }
.nolia-export h2 { margin: 32px 0 13px; font-size: 25px; line-height: 1.3; }
.nolia-export h3 { margin: 26px 0 10px; font-size: 21px; line-height: 1.35; }
.nolia-export h4 { margin: 22px 0 8px; font-size: 18px; line-height: 1.4; }
.nolia-export h5 { margin: 20px 0 7px; font-size: 16px; line-height: 1.45; }
.nolia-export h6 { margin: 18px 0 7px; color: #666; font-size: 14px; line-height: 1.5; }
.nolia-export strong { font-weight: 700; }
.nolia-export a { color: #1769aa; text-decoration: underline; text-decoration-color: rgba(23,105,170,.4); text-underline-offset: 2px; }
.nolia-export code { padding: 2px 5px; border-radius: 4px; background: #f1f2f3; font: .9em/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.nolia-export pre { overflow: auto; margin: 18px 0; padding: 14px 16px; border: 1px solid #e1e3e5; border-radius: 6px; background: #f6f7f8; }
.nolia-export pre code { padding: 0; background: transparent; }
.nolia-export blockquote { margin: 18px 0; padding: 2px 0 2px 16px; border-left: 3px solid #b8c1ca; color: #5f6872; }
.nolia-export ul, .nolia-export ol { margin: 0 0 1em; padding-left: 1.5em; }
.nolia-export li { margin: 4px 0; }
.nolia-export hr { margin: 30px 0; border: 0; border-top: 1px solid #d9dcdf; }
.nolia-export img { display: block; max-width: 100%; height: auto; margin: 16px 0; }
.nolia-export .tableWrapper { width: 100%; overflow-x: auto; margin: 18px 0; }
.nolia-export table { border-collapse: collapse; width: 100%; min-width: 360px; table-layout: auto; }
.nolia-export th, .nolia-export td { overflow-wrap: anywhere; }
.nolia-export th, .nolia-export td { padding: 6px 9px; border: 1px solid #d9dcdf; text-align: left; vertical-align: top; }
.nolia-export th { background: #f3f4f5; font-weight: 650; }
.nolia-export .mermaid-block, .nolia-export .complex-markdown-block { margin: 22px 0; break-inside: avoid; }
.nolia-export .mermaid-block-preview, .nolia-export .complex-markdown-preview { overflow-x: auto; }
.nolia-export .mermaid-block-svg svg { display: block; max-width: 100%; height: auto; margin: 0 auto; }
.nolia-export .mermaid-block-state, .nolia-export .mermaid-block-error, .nolia-export .complex-markdown-error { padding: 16px; border: 1px dashed #c9cdd1; color: #68717a; }
.nolia-export .markdown-image-placeholder { display: block; padding: 28px 16px; border: 1px dashed #c9cdd1; color: #68717a; text-align: center; }
.nolia-export .protected-source-label { margin-bottom: 6px; color: #68717a; font-size: 13px; }
.nolia-export .protected-source pre { margin-top: 0; }
.nolia-export .katex-display { display: block; margin: 1em 0; text-align: center; }
.nolia-export .katex > .katex-html { display: none; }
.nolia-export .katex > .katex-mathml { position: static; display: inline-block; width: auto; height: auto; overflow: visible; clip: auto; white-space: normal; }
@media print {
  @page { size: A4; margin: 18mm 16mm; }
  .nolia-export { width: auto; margin: 0; }
  .nolia-export h1, .nolia-export h2, .nolia-export h3, .nolia-export h4, .nolia-export h5, .nolia-export h6 { break-after: avoid; }
}
`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function createExportHtml(title: string, body: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="generator" content="Nolia Lite">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
  <title>${escapeHtml(title)}</title>
  <style>${EXPORT_STYLE}</style>
</head>
<body><article class="nolia-export">${body}</article></body>
</html>`;
}

export function snapshotEditorHtml(root: HTMLElement): string {
  const protectedSources = Array.from(
    root.querySelectorAll<HTMLTextAreaElement>(".protected-source textarea"),
    (node) => node.value
  );
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".protected-source").forEach((node, index) => {
    const source = protectedSources[index] ?? "";
    const pre = document.createElement("pre");
    pre.textContent = source;
    node.replaceChildren(pre);
  });
  clone.querySelectorAll("textarea, .selection-toolbar, .table-toolbar, .code-language-control").forEach((node) => node.remove());
  clone.querySelectorAll(".is-selected, .is-editing, .selectedCell").forEach((node) => {
    node.classList.remove("is-selected", "is-editing", "selectedCell");
  });
  clone.removeAttribute("contenteditable");
  clone.querySelectorAll("[contenteditable], [tabindex], [aria-label], [role]").forEach((node) => {
    node.removeAttribute("contenteditable");
    node.removeAttribute("tabindex");
    node.removeAttribute("aria-label");
    node.removeAttribute("role");
  });
  clone.querySelectorAll("*").forEach((node) => {
    for (const attribute of Array.from(node.attributes)) {
      if (/^on/i.test(attribute.name)) node.removeAttribute(attribute.name);
    }
    const href = node.getAttribute("href");
    if (href && /^\s*(?:javascript|data|vbscript):/i.test(href)) node.removeAttribute("href");
  });
  return clone.innerHTML;
}
