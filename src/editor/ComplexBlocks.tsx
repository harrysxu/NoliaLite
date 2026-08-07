import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import DOMPurify from "dompurify";
import katex from "katex";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import "katex/dist/katex.min.css";

import { decodeProtectedRaw } from "./sourceDocument";

type ComplexKind = "math" | "htmlPreview" | "footnote";

function complexBlock(kind: ComplexKind) {
  const nodeName = kind === "math" ? "mathBlock" : kind === "htmlPreview" ? "htmlBlock" : "footnoteBlock";
  const marker = `:::nolia-${kind} `;
  return Node.create({
    name: nodeName,
    group: "block",
    atom: true,
    isolating: true,
    selectable: true,

    addAttributes() {
      return { markdown: { default: "", rendered: false } };
    },

    markdownTokenizer: {
      name: nodeName,
      level: "block",
      start: (source) => source.indexOf(marker),
      tokenize(source) {
        const escapedKind = kind.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const match = source.match(new RegExp(`^:::nolia-${escapedKind} ([A-Za-z0-9+/]*={0,2}) :::(?:\\n|$)`));
        if (!match) return undefined;
        return { type: nodeName, raw: match[0], encodedMarkdown: match[1] };
      }
    },

    parseMarkdown(token, helpers) {
      return helpers.createNode(nodeName, { markdown: decodeProtectedRaw(String(token.encodedMarkdown ?? "")) });
    },

    parseHTML() {
      return [{ tag: `div[data-type='${nodeName}']` }];
    },

    renderHTML({ HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, { "data-type": nodeName })];
    },

    renderMarkdown(node) {
      return String(node.attrs?.markdown ?? "");
    },

    addNodeView() {
      return ReactNodeViewRenderer((props) => <ComplexBlockView {...props} kind={kind} />);
    }
  });
}

export const MathBlock = complexBlock("math");
export const SafeHtmlBlock = complexBlock("htmlPreview");
export const FootnoteBlock = complexBlock("footnote");

function ComplexBlockView({
  node,
  editor,
  getPos,
  updateAttributes,
  selected,
  kind
}: NodeViewProps & { kind: ComplexKind }) {
  const markdown = String(node.attrs.markdown ?? "");
  const [editing, setEditing] = useState(false);
  const rendered = renderComplexBlock(kind, markdown);
  const selectAndEdit = () => {
    if (!editor.isEditable) return;
    const position = typeof getPos === "function" ? getPos() : undefined;
    if (typeof position === "number") editor.commands.setNodeSelection(position);
    setEditing(true);
  };
  const label = kind === "math" ? "块公式" : kind === "htmlPreview" ? "HTML 块" : "脚注定义";

  return (
    <NodeViewWrapper
      className={`complex-markdown-block is-${kind}${selected ? " is-selected" : ""}${editing ? " is-editing" : ""}`}
      data-type={kind}
      data-footnote-label={kind === "footnote" ? rendered.label : undefined}
      contentEditable={false}
      tabIndex={0}
      role="group"
      aria-label={label}
      onClick={(event: React.MouseEvent<HTMLDivElement>) => {
        if (event.target instanceof HTMLTextAreaElement) return;
        event.preventDefault();
        if (editor.isEditable) selectAndEdit();
      }}
      onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.target instanceof HTMLTextAreaElement) return;
        if (event.key === "Enter" && editor.isEditable) {
          event.preventDefault();
          selectAndEdit();
        } else if (event.key === "Escape") {
          setEditing(false);
          editor.commands.focus();
        }
      }}
      onBlur={(event: React.FocusEvent<HTMLDivElement>) => {
        if (event.relatedTarget instanceof globalThis.Node && event.currentTarget.contains(event.relatedTarget)) return;
        if (!rendered.error) setEditing(false);
      }}
    >
      {editing ? (
        <textarea
          autoFocus
          aria-label={`${label} Markdown 源码`}
          value={markdown}
          rows={Math.min(16, Math.max(4, markdown.split(/\r?\n/).length + 1))}
          spellCheck={false}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => updateAttributes({ markdown: event.currentTarget.value })}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              event.preventDefault();
              setEditing(false);
              editor.commands.focus();
            } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !rendered.error) {
              event.preventDefault();
              setEditing(false);
              editor.commands.focus();
            }
          }}
        />
      ) : null}
      <div className="complex-markdown-preview">
        {rendered.error ? (
          <div className="complex-markdown-error" role="status"><AlertTriangle size={16} aria-hidden="true" /><span>{rendered.error}</span></div>
        ) : kind === "footnote" ? (
          <div className="footnote-definition"><sup>{rendered.label}</sup><span>{rendered.text}</span></div>
        ) : (
          <div dangerouslySetInnerHTML={{ __html: rendered.html }} />
        )}
      </div>
    </NodeViewWrapper>
  );
}

function renderComplexBlock(kind: ComplexKind, markdown: string): { html: string; error?: string; label?: string; text?: string } {
  if (kind === "math") {
    const latex = latexFromBlockMarkdown(markdown);
    if (!latex) return { html: "", error: "请输入有效的块公式 Markdown" };
    try {
      return { html: katex.renderToString(latex, { displayMode: true, throwOnError: true, strict: "warn", trust: false }) };
    } catch (error) {
      return { html: "", error: readableError(error) };
    }
  }
  if (kind === "htmlPreview") {
    return {
      html: DOMPurify.sanitize(markdown, {
        FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "button", "video", "audio", "source", "link", "meta", "img"],
        FORBID_ATTR: ["style", "src", "srcset", "formaction"]
      })
    };
  }
  const definition = markdown.trim().match(/^\[\^([^\]\n]+)]:\s*([\s\S]*)$/);
  return definition
    ? { html: "", label: definition[1], text: definition[2].replace(/\n\s+/g, " ").trim() }
    : { html: "", error: "请输入有效的脚注定义" };
}

function latexFromBlockMarkdown(markdown: string): string | undefined {
  const match = markdown.trim().match(/^\$\$\s*\n?([\s\S]*?)\n?\s*\$\$$/);
  const latex = match?.[1]?.trim();
  return latex || undefined;
}

function readableError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/^KaTeX parse error:\s*/i, "").slice(0, 220);
}

export const InlineMath = Node.create({
  name: "inlineMath",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      markdown: { default: "$x$", rendered: false },
      latex: { default: "x", rendered: false }
    };
  },

  markdownTokenizer: {
    name: "inlineMath",
    level: "inline",
    start(source) {
      for (let index = source.indexOf("$"); index >= 0; index = source.indexOf("$", index + 1)) {
        if (source[index - 1] !== "\\" && source[index + 1] !== "$") return index;
      }
      return -1;
    },
    tokenize(source) {
      const match = source.match(/^\$(?!\$|\s)((?:\\.|[^$\n\\])*?[^\s$])\$/);
      if (!match) return undefined;
      return { type: "inlineMath", raw: match[0], markdown: match[0], latex: match[1] };
    }
  },

  parseMarkdown(token, helpers) {
    return helpers.createNode("inlineMath", { markdown: token.markdown ?? token.raw, latex: token.latex ?? "" });
  },

  renderMarkdown(node) {
    return String(node.attrs?.markdown ?? `$${node.attrs?.latex ?? ""}$`);
  },

  parseHTML() {
    return [{ tag: "span[data-type='inline-math']" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-type": "inline-math" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(InlineMathView);
  }
});

export const FootnoteReference = Node.create({
  name: "footnoteReference",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      markdown: { default: "[^note]", rendered: false },
      label: { default: "note", rendered: false }
    };
  },

  markdownTokenizer: {
    name: "footnoteReference",
    level: "inline",
    start: (source) => source.indexOf("[^") ,
    tokenize(source) {
      const match = source.match(/^\[\^([^\]\n]+)]/);
      if (!match) return undefined;
      return { type: "footnoteReference", raw: match[0], markdown: match[0], label: match[1] };
    }
  },

  parseMarkdown(token, helpers) {
    return helpers.createNode("footnoteReference", { markdown: token.markdown ?? token.raw, label: token.label ?? "note" });
  },

  renderMarkdown(node) {
    return String(node.attrs?.markdown ?? `[^${node.attrs?.label ?? "note"}]`);
  },

  parseHTML() {
    return [{ tag: "sup[data-type='footnote-reference']" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["sup", mergeAttributes(HTMLAttributes, { "data-type": "footnote-reference" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FootnoteReferenceView);
  }
});

function FootnoteReferenceView({ node, editor, getPos, selected }: NodeViewProps) {
  const [editing, setEditing] = useState(false);
  const label = String(node.attrs.label ?? "");
  const select = () => {
    const position = typeof getPos === "function" ? getPos() : undefined;
    if (typeof position === "number") editor.commands.setNodeSelection(position);
  };
  const jumpToDefinition = () => {
    const escaped = CSS.escape(label);
    editor.view.dom.querySelector<HTMLElement>(`[data-footnote-label="${escaped}"]`)?.scrollIntoView({ block: "center" });
  };
  return (
    <NodeViewWrapper
      as="sup"
      className={`footnote-reference${selected ? " is-selected" : ""}${editing ? " is-editing" : ""}`}
      data-type="footnote-reference"
      contentEditable={false}
      tabIndex={0}
      aria-label={`脚注 ${label}`}
      onClick={(event: React.MouseEvent<HTMLElement>) => {
        event.preventDefault();
        select();
        if (event.metaKey || event.ctrlKey) jumpToDefinition();
        else if (editor.isEditable) setEditing(true);
      }}
      onBlur={(event: React.FocusEvent<HTMLElement>) => {
        if (event.relatedTarget instanceof globalThis.Node && event.currentTarget.contains(event.relatedTarget)) return;
        setEditing(false);
      }}
    >
      {editing ? (
        <input
          autoFocus
          aria-label="脚注引用源码"
          value={String(node.attrs.markdown ?? "")}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => {
            const markdown = event.currentTarget.value;
            const nextLabel = markdown.match(/^\[\^([^\]\n]+)]$/)?.[1];
            const position = typeof getPos === "function" ? getPos() : undefined;
            if (typeof position !== "number") return;
            const previousLabel = String(node.attrs.label ?? "");
            let transaction = editor.state.tr.setNodeMarkup(position, undefined, {
              ...node.attrs,
              markdown,
              ...(nextLabel ? { label: nextLabel } : {})
            });
            if (nextLabel && previousLabel && nextLabel !== previousLabel) {
              transaction.doc.descendants((definition, definitionPosition) => {
                if (definition.type.name !== "footnoteBlock") return;
                const current = String(definition.attrs.markdown ?? "");
                const renamed = renameFootnoteDefinition(current, previousLabel, nextLabel);
                if (renamed === current) return;
                transaction = transaction.setNodeMarkup(definitionPosition, undefined, {
                  ...definition.attrs,
                  markdown: renamed
                });
              });
            }
            editor.view.dispatch(transaction);
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape" || event.key === "Enter") {
              event.preventDefault();
              setEditing(false);
              editor.commands.focus();
            }
          }}
        />
      ) : <span>{label}</span>}
    </NodeViewWrapper>
  );
}

function renameFootnoteDefinition(markdown: string, previousLabel: string, nextLabel: string): string {
  const matcher = new RegExp(`(^|\\n)([ \\t]*)\\[\\^${escapeRegExp(previousLabel)}]:`, "g");
  return markdown.replace(matcher, (_match, prefix: string, indent: string) => `${prefix}${indent}[^${nextLabel}]:`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function InlineMathView({ node, editor, getPos, updateAttributes, selected }: NodeViewProps) {
  const markdown = String(node.attrs.markdown ?? "");
  const [editing, setEditing] = useState(false);
  const [sourceError, setSourceError] = useState(false);
  let html = "";
  let renderError = false;
  try {
    html = katex.renderToString(String(node.attrs.latex ?? ""), { displayMode: false, throwOnError: true, strict: "warn", trust: false });
  } catch {
    renderError = true;
  }
  const enter = () => {
    if (!editor.isEditable) return;
    const position = typeof getPos === "function" ? getPos() : undefined;
    if (typeof position === "number") editor.commands.setNodeSelection(position);
    setSourceError(!latexFromInlineMarkdown(markdown));
    setEditing(true);
  };
  return (
    <NodeViewWrapper
      as="span"
      className={`inline-math${selected ? " is-selected" : ""}${editing ? " is-editing" : ""}${sourceError || renderError ? " has-source-error" : ""}`}
      data-type="inline-math"
      contentEditable={false}
      tabIndex={0}
      onClick={(event: React.MouseEvent<HTMLSpanElement>) => {
        if (event.target instanceof HTMLInputElement) return;
        event.preventDefault();
        if (editor.isEditable) enter();
      }}
      onKeyDown={(event: React.KeyboardEvent<HTMLSpanElement>) => {
        if (event.target instanceof HTMLInputElement) return;
        if (event.key === "Enter" && editor.isEditable) enter();
      }}
      onBlur={(event: React.FocusEvent<HTMLSpanElement>) => {
        if (event.relatedTarget instanceof globalThis.Node && event.currentTarget.contains(event.relatedTarget)) return;
        if (!sourceError) setEditing(false);
      }}
    >
      {editing ? (
        <input
          autoFocus
          aria-label="行内公式源码"
          value={markdown}
          spellCheck={false}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => {
            const value = event.currentTarget.value;
            const latex = latexFromInlineMarkdown(value);
            setSourceError(!latex);
            updateAttributes({ markdown: value, ...(latex ? { latex } : {}) });
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              event.preventDefault();
              setSourceError(false);
              setEditing(false);
              editor.commands.focus();
            } else if (event.key === "Enter" && !sourceError) {
              event.preventDefault();
              setEditing(false);
              editor.commands.focus();
            }
          }}
        />
      ) : <span dangerouslySetInnerHTML={{ __html: html }} />}
    </NodeViewWrapper>
  );
}

function latexFromInlineMarkdown(markdown: string): string | undefined {
  const match = markdown.trim().match(/^\$([^$\n]+)\$$/);
  return match?.[1]?.trim() || undefined;
}
