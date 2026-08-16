import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { AlertTriangle, LoaderCircle } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent
} from "react";

import { decodeProtectedRaw } from "./sourceDocument";
import { diagramMarkdownParts, updateDiagramMarkdown } from "./mermaidMarkdown";
import { renderDiagramSvg } from "./mermaidRenderer";
import type { DiagramViewerContent } from "./DiagramViewer";

export type { DiagramViewerContent } from "./DiagramViewer";

type MermaidBlockOptions = {
  onOpenDiagram?: (content: DiagramViewerContent) => void;
};

export const MermaidBlock = Node.create<MermaidBlockOptions>({
  name: "mermaidBlock",
  group: "block",
  atom: true,
  isolating: true,
  selectable: true,

  addOptions() {
    return { onOpenDiagram: undefined };
  },

  addAttributes() {
    return { markdown: { default: "", rendered: false } };
  },

  markdownTokenizer: {
    name: "mermaidBlock",
    level: "block",
    start: (source) => source.indexOf(":::nolia-mermaid "),
    tokenize(source) {
      const match = source.match(/^:::nolia-mermaid ([A-Za-z0-9+/]*={0,2}) :::(?:\n|$)/);
      if (!match) return undefined;
      return { type: "mermaidBlock", raw: match[0], encodedMarkdown: match[1] };
    }
  },

  parseMarkdown(token, helpers) {
    return helpers.createNode("mermaidBlock", {
      markdown: decodeProtectedRaw(String(token.encodedMarkdown ?? ""))
    });
  },

  parseHTML() {
    return [{ tag: "div[data-type='mermaid-block']" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "mermaid-block" })];
  },

  renderMarkdown(node) {
    return String(node.attrs?.markdown ?? "");
  },

  addNodeView() {
    const onOpenDiagram = this.options.onOpenDiagram;
    return ReactNodeViewRenderer((props) => (
      <MermaidBlockView {...props} onOpenDiagram={onOpenDiagram} />
    ));
  }
});

function MermaidBlockView({
  node,
  editor,
  getPos,
  updateAttributes,
  selected,
  onOpenDiagram
}: NodeViewProps & { onOpenDiagram?: (content: DiagramViewerContent) => void }) {
  const markdown = String(node.attrs.markdown ?? "");
  const source = diagramMarkdownParts(markdown);
  const [editing, setEditing] = useState(false);
  const [svg, setSvg] = useState<string>();
  const [error, setError] = useState<string>();
  const [rendering, setRendering] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let active = true;
    setRendering(true);
    setError(undefined);
    void renderDiagramSvg(markdown)
      .then((value) => {
        if (!active) return;
        setSvg(value);
        setError(undefined);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setSvg(undefined);
        setError(readableMermaidError(reason));
      })
      .finally(() => {
        if (active) setRendering(false);
      });
    return () => { active = false; };
  }, [markdown]);

  const selectNode = () => {
    const position = typeof getPos === "function" ? getPos() : undefined;
    if (typeof position === "number") editor.commands.setNodeSelection(position);
  };

  const enterEditing = () => {
    if (!editor.isEditable) return;
    selectNode();
    setEditing(true);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true });
    });
  };

  const openViewer = () => {
    if (!svg) return;
    if (editor.isEditable) selectNode();
    onOpenDiagram?.({
      svg,
      markdown,
      initialScale: 1.25,
      onEdit: enterEditing
    });
  };

  return (
    <NodeViewWrapper
      className={`mermaid-block${selected ? " is-selected" : ""}${editing ? " is-editing" : ""}`}
      data-type="mermaid-block"
      contentEditable={false}
      tabIndex={0}
      role="group"
      aria-label="Mermaid 图表"
      aria-keyshortcuts="Enter Control+Click Meta+Click"
      onMouseDown={(event: MouseEvent<HTMLDivElement>) => {
        if (event.target instanceof Element && event.target.closest(".mermaid-block-editor")) return;
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event: MouseEvent<HTMLDivElement>) => {
        if (event.target instanceof Element && event.target.closest(".mermaid-block-editor")) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.metaKey || event.ctrlKey) openViewer();
        else if (editor.isEditable) enterEditing();
      }}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.target instanceof Element && event.target.closest(".mermaid-block-editor")) return;
        if (event.key === "Enter" && editor.isEditable) {
          event.preventDefault();
          event.stopPropagation();
          enterEditing();
        } else if (event.key === "Escape") {
          event.preventDefault();
          setEditing(false);
          editor.commands.focus();
        }
      }}
      onBlur={(event: FocusEvent<HTMLDivElement>) => {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof globalThis.Node && event.currentTarget.contains(nextTarget)) return;
        setEditing(false);
      }}
    >
      {editing ? (
        <div className="mermaid-block-editor">
          <input
            className="mermaid-block-language"
            aria-label="图表语言"
            value={source.language}
            spellCheck={false}
            onChange={(event) => updateAttributes({
              markdown: updateDiagramMarkdown(markdown, event.currentTarget.value, source.body)
            })}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") {
                event.preventDefault();
                setEditing(false);
                editor.commands.focus();
              }
            }}
          />
          <textarea
            ref={textareaRef}
            className="mermaid-block-source"
            aria-label="Mermaid 图表源码"
            value={source.body}
            rows={Math.min(20, Math.max(5, source.body.split(/\r?\n/).length + 1))}
            spellCheck={false}
            onChange={(event) => updateAttributes({
              markdown: updateDiagramMarkdown(markdown, source.language, event.currentTarget.value)
            })}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") {
                event.preventDefault();
                setEditing(false);
                editor.commands.focus();
              }
            }}
          />
        </div>
      ) : null}
      <div className="mermaid-block-preview" aria-live="polite">
        {rendering && !svg ? (
          <div className="mermaid-block-state"><LoaderCircle className="is-spinning" size={18} aria-hidden="true" /></div>
        ) : error ? (
          <div className="mermaid-block-error" role="status">
            <AlertTriangle size={17} aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : (
          <div className="mermaid-block-svg" dangerouslySetInnerHTML={{ __html: svg ?? "" }} />
        )}
      </div>
    </NodeViewWrapper>
  );
}

function readableMermaidError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "Mermaid 图表无法渲染");
  return message.replace(/^Error:\s*/i, "").split("\n", 1)[0].slice(0, 240);
}
