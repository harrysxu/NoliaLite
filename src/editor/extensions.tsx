import { Extension, mergeAttributes, Node, wrappingInputRule, type Editor } from "@tiptap/core";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { Markdown } from "@tiptap/markdown";
import { DOMSerializer, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection, Plugin } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Code2, FileCode2, ImageOff, Shield } from "lucide-react";
import { common, createLowlight } from "lowlight";
import { useEffect, useState } from "react";

import { readLocalImage, storeDocumentImage } from "../bridge/tauriClient";
import { MermaidBlock, type DiagramViewerContent } from "./MermaidBlock";
import { FootnoteBlock, FootnoteReference, InlineMath, MathBlock, SafeHtmlBlock } from "./ComplexBlocks";
import { decodeProtectedRaw, parseTrackedMarkdown, TRACKING_ATTRIBUTES, type ProtectedKind } from "./sourceDocument";
import { SyntaxVisibility } from "./SyntaxVisibility";

const lowlight = createLowlight(common);

const trackedNodeTypes = [
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "taskList",
  "codeBlock",
  "horizontalRule",
  "table",
  "image",
  "mermaidBlock",
  "mathBlock",
  "htmlBlock",
  "footnoteBlock",
  "protectedBlock"
];

const SourceTracking = Extension.create({
  name: "sourceTracking",
  addGlobalAttributes() {
    return [
      {
        types: trackedNodeTypes,
        attributes: Object.fromEntries(
          TRACKING_ATTRIBUTES.map((attribute) => [attribute, { default: null, rendered: false }])
        )
      }
    ];
  }
});

function protectedLabel(kind: ProtectedKind): string {
  if (kind === "frontmatter") return "Frontmatter";
  if (kind === "html") return "原始 HTML";
  return "未支持的 Markdown";
}

function ProtectedBlockView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const kind = (node.attrs.kind || "unsupported") as ProtectedKind;
  const Icon = kind === "frontmatter" ? FileCode2 : kind === "html" ? Shield : Code2;
  return (
    <NodeViewWrapper
      className={`protected-source${selected ? " is-selected" : ""}`}
      data-kind={kind}
      contentEditable={false}
    >
      <div className="protected-source-label">
        <Icon size={14} aria-hidden="true" />
        <span>{protectedLabel(kind)}</span>
      </div>
      <textarea
        aria-label={`${protectedLabel(kind)} 源码`}
        value={String(node.attrs.raw ?? "")}
        readOnly={!editor.isEditable}
        onChange={(event) => updateAttributes({ raw: event.currentTarget.value })}
        spellCheck={false}
      />
    </NodeViewWrapper>
  );
}

const ProtectedBlock = Node.create({
  name: "protectedBlock",
  group: "block",
  atom: true,
  isolating: true,
  selectable: true,

  addAttributes() {
    return {
      kind: { default: "unsupported", rendered: false },
      raw: { default: "", rendered: false }
    };
  },

  parseHTML() {
    return [
      {
        tag: "nolia-protected",
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false;
          return {
            kind: element.dataset.kind ?? "unsupported",
            raw: decodeProtectedRaw(element.dataset.raw ?? "")
          };
        }
      }
    ];
  },

  parseMarkdown(token, helpers) {
    return helpers.createNode("protectedBlock", {
      kind: token.kind ?? "unsupported",
      raw: decodeProtectedRaw(String(token.encodedRaw ?? ""))
    });
  },

  markdownTokenizer: {
    name: "protectedBlock",
    level: "block",
    start: (source) => source.indexOf(":::nolia-protected "),
    tokenize(source) {
      const match = source.match(
        /^:::nolia-protected (frontmatter|html|unsupported) ([A-Za-z0-9+/]*={0,2}) :::(?:\n|$)/
      );
      if (!match) return undefined;
      return {
        type: "protectedBlock",
        raw: match[0],
        kind: match[1],
        encodedRaw: match[2]
      };
    }
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "nolia-protected",
      mergeAttributes(HTMLAttributes, {
        "data-kind": node.attrs.kind,
        "data-protected": "true"
      })
    ];
  },

  renderMarkdown(node) {
    return String(node.attrs?.raw ?? "");
  },

  addNodeView() {
    return ReactNodeViewRenderer(ProtectedBlockView, {
      stopEvent: ({ event }) => event.target instanceof HTMLTextAreaElement
    });
  }
});

function localRelativeSource(source: string): string | undefined {
  const withoutSuffix = source.split(/[?#]/, 1)[0];
  if (!withoutSuffix || /^(?:[a-z][a-z\d+.-]*:|\/|\\)/i.test(withoutSuffix)) return undefined;
  try {
    return decodeURIComponent(withoutSuffix);
  } catch {
    return undefined;
  }
}

function ImageNodeView({
  node,
  selected,
  documentPath,
  editor,
  getPos,
  updateAttributes
}: NodeViewProps & { documentPath?: string }) {
  const source = String(node.attrs.src ?? "");
  const alt = String(node.attrs.alt ?? "");
  const markdown = String(node.attrs.markdown ?? imageMarkdownFromAttrs(node.attrs));
  const [resolvedSource, setResolvedSource] = useState<string>();
  const [loadingSource, setLoadingSource] = useState(false);
  const [editing, setEditing] = useState(false);
  const [sourceError, setSourceError] = useState(false);

  useEffect(() => {
    const relative = localRelativeSource(source);
    if (!documentPath || !relative) {
      setResolvedSource(undefined);
      setLoadingSource(false);
      return;
    }
    let active = true;
    setResolvedSource(undefined);
    setLoadingSource(true);
    void readLocalImage(documentPath, relative)
      .then((value) => {
        if (active) setResolvedSource(value);
      })
      .catch(() => {
        if (active) setResolvedSource(undefined);
      })
      .finally(() => {
        if (active) setLoadingSource(false);
      });
    return () => { active = false; };
  }, [documentPath, source]);

  return (
    <NodeViewWrapper
      className={`markdown-image-node${selected ? " is-selected" : ""}${editing ? " is-editing" : ""}${sourceError ? " has-source-error" : ""}`}
      contentEditable={false}
      title={source}
      tabIndex={0}
      role="group"
      aria-label="Markdown 图片"
      data-export-pending={loadingSource ? "true" : undefined}
      onClick={(event: React.MouseEvent<HTMLDivElement>) => {
        if (event.target instanceof HTMLTextAreaElement) return;
        event.preventDefault();
        const position = typeof getPos === "function" ? getPos() : undefined;
        if (typeof position === "number") editor.commands.setNodeSelection(position);
        if (editor.isEditable) setEditing(true);
      }}
      onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.target instanceof HTMLTextAreaElement) return;
        if (event.key === "Enter" && editor.isEditable) {
          event.preventDefault();
          setEditing(true);
        } else if (event.key === "Escape") {
          setEditing(false);
          editor.commands.focus();
        }
      }}
      onBlur={(event: React.FocusEvent<HTMLDivElement>) => {
        if (event.relatedTarget instanceof globalThis.Node && event.currentTarget.contains(event.relatedTarget)) return;
        if (!sourceError) setEditing(false);
      }}
    >
      {editing ? (
        <textarea
          className="markdown-image-source"
          aria-label="图片 Markdown 源码"
          value={markdown}
          rows={2}
          spellCheck={false}
          autoFocus
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => {
            const nextMarkdown = event.currentTarget.value;
            const parsed = parseImageMarkdown(nextMarkdown);
            setSourceError(!parsed);
            updateAttributes(parsed ? {
              markdown: nextMarkdown,
              src: parsed.src,
              alt: parsed.alt,
              title: parsed.title || null
            } : { markdown: nextMarkdown });
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              event.preventDefault();
              setSourceError(false);
              setEditing(false);
              editor.commands.focus();
            } else if (event.key === "Enter" && !event.shiftKey && !sourceError) {
              event.preventDefault();
              setEditing(false);
              editor.commands.focus();
            }
          }}
        />
      ) : null}
      {resolvedSource ? (
        <span className="markdown-image"><img src={resolvedSource} alt={alt} draggable={false} /></span>
      ) : (
        <span className="markdown-image-placeholder">
          <ImageOff size={22} aria-hidden="true" />
          <span>{alt || source || "图片"}</span>
          {alt && source ? <small>{source}</small> : null}
        </span>
      )}
    </NodeViewWrapper>
  );
}

type ImageMarkdownParts = { alt: string; src: string; title: string };

function imageMarkdownFromAttrs(attrs: Record<string, unknown>): string {
  const alt = String(attrs.alt ?? "").replace(/\\/g, "\\\\").replace(/]/g, "\\]");
  const src = String(attrs.src ?? "").trim();
  const title = String(attrs.title ?? "");
  return title ? `![${alt}](${src} "${title.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}")` : `![${alt}](${src})`;
}

function parseImageMarkdown(markdown: string): ImageMarkdownParts | undefined {
  const match = markdown.trim().match(/^!\[((?:\\.|[^\]\n])*)]\(([^\n]*)\)$/);
  if (!match) return undefined;
  let body = match[2].trim();
  if (!body) return undefined;
  let title = "";
  const titleMatch = body.match(/\s+(?:"((?:\\"|[^"])*)"|'((?:\\'|[^'])*)')\s*$/);
  if (titleMatch && typeof titleMatch.index === "number") {
    title = (titleMatch[1] ?? titleMatch[2] ?? "").replace(/\\([\\"'])/g, "$1");
    body = body.slice(0, titleMatch.index).trim();
  }
  if (body.startsWith("<") && body.endsWith(">")) body = body.slice(1, -1).trim();
  if (!body || /^(?:javascript|data|vbscript):/i.test(body)) return undefined;
  return {
    alt: match[1].replace(/\\]/g, "]").replace(/\\\\/g, "\\"),
    src: body,
    title
  };
}

function safeImage(documentPath?: string) {
  return Image.extend({
    addAttributes() {
      return {
        ...(this.parent?.() ?? {}),
        markdown: { default: null, rendered: false }
      };
    },
    renderHTML({ node, HTMLAttributes }) {
      return [
        "span",
        mergeAttributes(HTMLAttributes, {
          "data-markdown-image": "true",
          "data-src": node.attrs.src,
          src: null
        })
      ];
    },
    addNodeView() {
      return ReactNodeViewRenderer((props) => (
        <ImageNodeView {...props} documentPath={documentPath} />
      ));
    },
    renderMarkdown(node) {
      return String(node.attrs?.markdown ?? imageMarkdownFromAttrs(node.attrs ?? {}));
    }
  }).configure({
    allowBase64: false,
    resize: false
  });
}

function imageFileExtension(file: File): string {
  const fromName = file.name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  const supported = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg"]);
  if (fromName && supported.has(fromName)) return fromName === "jpeg" ? "jpg" : fromName;
  const subtype = file.type.split("/", 2)[1]?.toLowerCase();
  const fromType = subtype === "svg+xml" ? "svg" : subtype === "jpeg" ? "jpg" : subtype;
  return fromType && supported.has(fromType) ? fromType : "png";
}

async function storeDroppedImages(editor: Editor, documentPath: string, files: File[], position?: number): Promise<void> {
  const content: Array<{ type: string; attrs: Record<string, string> }> = [];
  for (const file of files) {
    const extension = imageFileExtension(file);
    const originalName = file.name.trim();
    const hasImageExtension = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(originalName);
    const baseName = originalName.replace(/\.[^.]+$/, "") || `pasted-image-${Date.now()}`;
    const fileName = hasImageExtension ? originalName : `${baseName}.${extension}`;
    const source = await storeDocumentImage(documentPath, fileName, new Uint8Array(await file.arrayBuffer()));
    const alt = fileName.replace(/\.[^.]+$/, "").replace(/([\\\]])/g, "\\$1");
    content.push({
      type: "image",
      attrs: { src: source, alt, markdown: `![${alt}](${source})` }
    });
  }
  if (!content.length) return;
  const chain = editor.chain().focus();
  if (typeof position === "number") chain.insertContentAt(position, content).run();
  else chain.insertContent(content).run();
}

function imagePasteAndDrop(documentPath?: string, onError?: (message: string) => void) {
  return Extension.create({
    name: "imagePasteAndDrop",
    addProseMirrorPlugins() {
      const editor = this.editor;
      return [
        new Plugin({
          props: {
            handlePaste(_view, event) {
              if (!documentPath || !editor.isEditable) return false;
              const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
              if (!files.length) return false;
              event.preventDefault();
              void storeDroppedImages(editor, documentPath, files).catch((error) => {
                onError?.(`插入图片失败：${error instanceof Error ? error.message : String(error)}`);
              });
              return true;
            },
            handleDrop(view, event) {
              if (!documentPath || !editor.isEditable) return false;
              const files = Array.from(event.dataTransfer?.files ?? []).filter((file) => file.type.startsWith("image/"));
              if (!files.length) return false;
              event.preventDefault();
              const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
              void storeDroppedImages(editor, documentPath, files, position).catch((error) => {
                onError?.(`插入图片失败：${error instanceof Error ? error.message : String(error)}`);
              });
              return true;
            }
          }
        })
      ];
    }
  });
}

const PlainTextPaste = Extension.create({
  name: "plainTextPaste",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        props: {
          handlePaste(view, event) {
            if (!editor.isEditable) return false;
            const clipboard = event.clipboardData;
            if (!clipboard) return false;
            const text = clipboard.getData("text/plain");
            const html = clipboard.getData("text/html");
            const internalMarkdown = markdownFromInternalClipboard(html);
            if (internalMarkdown) {
              event.preventDefault();
              return insertMarkdownAtSelection(editor, view, internalMarkdown);
            }
            if (html) {
              event.preventDefault();
              if (text) view.dispatch(view.state.tr.insertText(text).scrollIntoView());
              return true;
            }
            if (!text || !looksLikeMarkdownPlainText(text)) return false;
            event.preventDefault();
            return insertMarkdownAtSelection(editor, view, text);
          }
        }
      })
    ];
  }
});

const MarkdownNodeCopy = Extension.create({
  name: "markdownNodeCopy",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            copy(view, event) {
              const selection = view.state.selection;
              if (selection.empty) return false;
              const clipboard = event.clipboardData;
              if (!clipboard) return false;
              const markdown = markdownForSelection(editor, selection instanceof NodeSelection ? selection.node : undefined);
              if (!markdown) return false;
              const slice = selection.content();
              const wrapper = document.createElement("div");
              wrapper.dataset.noliaLiteClipboard = "true";
              wrapper.dataset.markdown = markdown;
              wrapper.append(DOMSerializer.fromSchema(view.state.schema).serializeFragment(slice.content));
              clipboard.setData("text/plain", markdown);
              clipboard.setData("text/html", wrapper.outerHTML);
              event.preventDefault();
              return true;
            }
          }
        }
      })
    ];
  }
});

function markdownForSelection(editor: Editor, selectedNode?: ProseMirrorNode): string | undefined {
  const manager = editor.markdown;
  if (!manager) return undefined;
  try {
    if (selectedNode) {
      const node = selectedNode.isInline
        ? editor.schema.nodes.paragraph.create(null, selectedNode)
        : selectedNode;
      return manager.serialize({ type: "doc", content: [node.toJSON()] }).trimEnd();
    }
    const { selection } = editor.state;
    const slice = selection.content();
    const content: ProseMirrorNode[] = [];
    slice.content.forEach((node) => content.push(node));
    if (!content.length) return undefined;
    if (selection.$from.sameParent(selection.$to) && selection.$from.parent.isTextblock) {
      const parent = selection.$from.parent.type.create(selection.$from.parent.attrs, slice.content);
      return manager.serialize({ type: "doc", content: [parent.toJSON()] }).trimEnd();
    }
    return manager.serialize({ type: "doc", content: content.map((node) => node.toJSON()) }).trimEnd();
  } catch {
    return undefined;
  }
}

function markdownFromInternalClipboard(html: string): string | undefined {
  if (!html || !/\bdata-nolia-lite-clipboard=/i.test(html)) return undefined;
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content.querySelector<HTMLElement>("[data-nolia-lite-clipboard='true'][data-markdown]")?.dataset.markdown;
}

function insertMarkdownAtSelection(editor: Editor, view: EditorView, markdown: string): boolean {
  const manager = editor.markdown;
  if (!manager) return false;
  try {
    const parsed = editor.schema.nodeFromJSON(parseTrackedMarkdown(markdown, manager));
    const slice = parsed.slice(0, parsed.content.size);
    view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
    return true;
  } catch {
    view.dispatch(view.state.tr.insertText(markdown).scrollIntoView());
    return true;
  }
}

function looksLikeMarkdownPlainText(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  return [
    /^#{1,6}\s+\S/m,
    /^[-+*]\s+\[[ xX]\]\s+\S/m,
    /^[-+*]\s+\S/m,
    /^\d+[.)]\s+\S/m,
    /^>\s?/m,
    /^(```|~~~)/m,
    /^\|.+\|\s*$/m,
    /^[-*_]{3,}\s*$/m,
    /^!\[[^\]]*]\([^)]+\)/m,
    /\[[^\]]+]\([^)]+\)/,
    /\*\*[^*\n]+?\*\*|__[^_\n]+?__|~~[^~\n]+?~~|`[^`\n]+?`/,
    /(^|\n)\$\$\s*(\n|$)/,
    /\$[^$\n]+?\$/
  ].some((pattern) => pattern.test(text));
}

const MarkdownTaskItem = TaskItem.extend({
  addInputRules() {
    return [
      wrappingInputRule({
        find: /^\s*-\s+\[([ xX])]\s$/,
        type: this.type,
        getAttributes: (match) => ({ checked: match[1].toLowerCase() === "x" })
      })
    ];
  }
}).configure({ nested: true });

export function isAllowedLink(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^(javascript|data|vbscript):/i.test(trimmed)) return false;
  if (/^(?:\/|\\|\.\.\/)/.test(trimmed)) return false;
  return /^(https?:|mailto:|tel:|ftp:|file:|#|\.\/)/i.test(trimmed) || !/^[a-z][a-z\d+.-]*:/i.test(trimmed);
}

export function createEditorExtensions(
  documentPath?: string,
  onOpenDiagram?: (content: DiagramViewerContent) => void,
  editable = true,
  onError?: (message: string) => void
) {
  return [
    StarterKit.configure({
      link: false,
      underline: false,
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      codeBlock: false,
      trailingNode: editable ? { node: "paragraph" } : false
    }),
    CodeBlockLowlight.configure({ lowlight, enableTabIndentation: true, tabSize: 2 }),
    Link.configure({
      openOnClick: false,
      enableClickSelection: true,
      autolink: false,
      linkOnPaste: false,
      markdownLinks: true,
      isAllowedUri: (url) => isAllowedLink(url),
      HTMLAttributes: { rel: "noopener noreferrer" }
    }),
    TaskList,
    MarkdownTaskItem,
    TableKit.configure({
      table: { resizable: false, renderWrapper: true, allowTableNodeSelection: true }
    }),
    safeImage(documentPath),
    imagePasteAndDrop(documentPath, onError),
    Placeholder.configure({ placeholder: "" }),
    MermaidBlock.configure({ onOpenDiagram }),
    MathBlock,
    InlineMath,
    FootnoteReference,
    SafeHtmlBlock,
    FootnoteBlock,
    ProtectedBlock,
    SourceTracking,
    SyntaxVisibility.configure({ enabled: editable }),
    PlainTextPaste,
    MarkdownNodeCopy,
    Markdown.configure({ indentation: { style: "space", size: 2 } })
  ];
}
