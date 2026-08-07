import type { Editor, JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { TextSelection } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";

import type { PreferredEol } from "../bridge/contracts";
import { CodeLanguageControl } from "./CodeLanguageControl";
import { DiagramViewer, type DiagramViewerContent } from "./DiagramViewer";
import { createEditorExtensions } from "./extensions";
import {
  applyLinkMarkdownSource,
  applyMarkdownSyntaxSource,
  clearMarkdownSyntaxEditor,
  isMarkdownSyntaxEditorActive,
  MarkdownSyntaxEditor,
  openLinkMarkdownEditorAtPosition,
  openMarkdownSyntaxEditorAtPosition
} from "./MarkdownSyntaxEditor";
import { SelectionToolbar } from "./SelectionToolbar";
import { parseTrackedMarkdown, serializeTrackedMarkdown } from "./sourceDocument";
import { TableInsertDialog, TableToolbar } from "./TableToolbar";
import { snapshotEditorHtml } from "./exportDocument";

export type FindResult = { current: number; total: number };

export type MarkdownEditorHandle = {
  focus: () => void;
  toggleBold: () => void;
  toggleItalic: () => void;
  editLink: () => void;
  undo: () => void;
  redo: () => void;
  insertTable: () => void;
  insertMermaid: () => void;
  insertMath: () => void;
  getExportHtml: () => string;
  find: (query: string, direction?: "next" | "previous") => FindResult;
  jumpToHeading: (reference: string) => boolean;
};

type Props = {
  value: string;
  filePath?: string;
  preferredEol: PreferredEol;
  editable: boolean;
  autofocus?: boolean;
  onChange: (markdown: string) => void;
  onOpenLink?: (href: string) => void;
};

type Match = { from: number; to: number };
type LinkEditorState = { left: number; top: number; href: string; text: string; from: number; to: number };

function textMatches(editor: Editor, query: string): Match[] {
  if (!query) return [];
  const needle = query.toLocaleLowerCase();
  const matches: Match[] = [];
  editor.state.doc.descendants((node, position) => {
    if (!node.isText || !node.text) return;
    const haystack = node.text.toLocaleLowerCase();
    let index = haystack.indexOf(needle);
    while (index >= 0) {
      matches.push({ from: position + index, to: position + index + query.length });
      index = haystack.indexOf(needle, index + Math.max(query.length, 1));
    }
  });
  return matches;
}

function selectMatch(editor: Editor, query: string, direction: "next" | "previous"): FindResult {
  const matches = textMatches(editor, query);
  if (!matches.length) return { current: 0, total: 0 };
  const cursor = editor.state.selection.from;
  let index: number;
  if (direction === "previous") {
    index = -1;
    for (let candidate = matches.length - 1; candidate >= 0; candidate -= 1) {
      if (matches[candidate].from < cursor) {
        index = candidate;
        break;
      }
    }
    if (index < 0) index = matches.length - 1;
  } else {
    index = matches.findIndex((match) => match.from > cursor);
    if (index < 0) index = 0;
  }
  const match = matches[index];
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, match.from, match.to)).scrollIntoView()
  );
  return { current: index + 1, total: matches.length };
}

function normalizeHeadingReference(value: string): string {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Keep the literal fragment when it is not valid percent-encoding.
  }
  return decoded.trim().toLocaleLowerCase().replace(/^#/, "");
}

function slugifyHeading(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function jumpToHeading(editor: Editor, reference: string): boolean {
  const normalized = normalizeHeadingReference(reference);
  if (!normalized) return false;
  let headingPosition: number | undefined;
  const slugOccurrences = new Map<string, number>();
  editor.state.doc.descendants((node, position) => {
    if (node.type.name !== "heading") return undefined;
    const text = normalizeHeadingReference(node.textContent);
    const baseSlug = slugifyHeading(node.textContent);
    const occurrence = slugOccurrences.get(baseSlug) ?? 0;
    slugOccurrences.set(baseSlug, occurrence + 1);
    const uniqueSlug = occurrence ? `${baseSlug}-${occurrence}` : baseSlug;
    if (headingPosition !== undefined || (text !== normalized && uniqueSlug !== normalized)) return false;
    headingPosition = position;
    return false;
  });
  if (headingPosition === undefined) return false;
  const element = editor.view.nodeDOM(headingPosition);
  if (element instanceof HTMLElement) element.scrollIntoView({ block: "center" });
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, headingPosition + 1)).scrollIntoView());
  editor.view.focus();
  return true;
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, Props>(function MarkdownEditor(
  { value, filePath, preferredEol, editable, autofocus, onChange, onOpenLink },
  ref
) {
  const [diagramViewer, setDiagramViewer] = useState<DiagramViewerContent>();
  const [tableInsertOpen, setTableInsertOpen] = useState(false);
  const editorInstanceRef = useRef<Editor | null>(null);
  const extensions = useMemo(
    () => [
      ...createEditorExtensions(filePath, setDiagramViewer, editable),
      MarkdownSyntaxEditor.configure({
        onSubmit: (source, markdown) => {
          const currentEditor = editorInstanceRef.current;
          if (!currentEditor) return false;
          const applied = source.kind === "link"
            ? applyLinkMarkdownSource(currentEditor, source, markdown)
            : applyMarkdownSyntaxSource(currentEditor, source, markdown);
          if (applied) clearMarkdownSyntaxEditor(currentEditor.view);
          return applied;
        },
        onCancel: () => {
          const currentEditor = editorInstanceRef.current;
          if (!currentEditor) return;
          clearMarkdownSyntaxEditor(currentEditor.view);
          currentEditor.view.focus();
        }
      })
    ],
    [editable, filePath]
  );
  const initialValueRef = useRef(value);
  const initialContent = useMemo<JSONContent>(() => {
    const manager = new MarkdownManager({ extensions });
    return parseTrackedMarkdown(initialValueRef.current, manager);
  }, [extensions]);
  const [toolbarPosition, setToolbarPosition] = useState<{ left: number; top: number }>();
  const [linkEditor, setLinkEditor] = useState<LinkEditorState>();
  const linkInputRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions,
    content: initialContent,
    editable,
    autofocus: autofocus ?? false,
    // Tiptap's eager editor can be destroyed before React finishes a concurrent
    // commit, leaving EditorContent with an instance that has no mounted view.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "nolia-editor",
        "aria-label": "Markdown 文档",
        spellcheck: "true"
      },
      handleClick: (view, position, event) => {
        const eventTarget = event.target instanceof Element ? event.target : undefined;
        const hitTarget = typeof document.elementFromPoint === "function"
          ? document.elementFromPoint(event.clientX, event.clientY)
          : undefined;
        const target = hitTarget instanceof Element && view.dom.contains(hitTarget) ? hitTarget : eventTarget;
        if (isMarkdownSyntaxEditorActive(view) && !event.metaKey && !event.ctrlKey) return true;
        const anchor = target?.closest<HTMLAnchorElement>("a[href]");
        const href = anchor?.getAttribute("href");
        if (anchor && href) {
          event.preventDefault();
          if (event.metaKey || event.ctrlKey) {
            clearMarkdownSyntaxEditor(view);
            if (onOpenLink) onOpenLink(href);
            else window.open(href, "_blank", "noopener,noreferrer");
            return true;
          }
          if (!view.editable) return true;
          setLinkEditor(undefined);
          const currentEditor = editorInstanceRef.current;
          return currentEditor ? openLinkMarkdownEditorAtPosition(currentEditor, position, anchor) : true;
        }
        if (target?.closest("ul[data-type='taskList'] li > label")) return false;
        if (isMarkdownSyntaxEditorActive(view)) return true;
        const currentEditor = editorInstanceRef.current;
        if (currentEditor && openMarkdownSyntaxEditorAtPosition(currentEditor, position, target, event)) {
          event.preventDefault();
          return true;
        }
        clearMarkdownSyntaxEditor(view);
        return false;
      }
    },
    onUpdate: ({ editor: currentEditor }) => {
      if (!currentEditor.markdown) return;
      onChange(serializeTrackedMarkdown(currentEditor.getJSON(), currentEditor.markdown, preferredEol));
    },
    onSelectionUpdate: ({ editor: currentEditor }) => {
      const { from, to } = currentEditor.state.selection;
      if (from === to || !currentEditor.isEditable || isMarkdownSyntaxEditorActive(currentEditor.view)) {
        setToolbarPosition(undefined);
        return;
      }
      requestAnimationFrame(() => {
        const start = currentEditor.view.coordsAtPos(from);
        const end = currentEditor.view.coordsAtPos(to);
        setToolbarPosition({
          left: Math.max(12, (start.left + end.right) / 2),
          top: Math.max(52, Math.min(start.top, end.top) - 10)
        });
      });
    },
    onBlur: ({ event }) => {
      const target = event.relatedTarget;
      if (!(target instanceof Element) || !target.closest(".selection-toolbar")) {
        setToolbarPosition(undefined);
      }
    }
  });

  editorInstanceRef.current = editor;

  useEffect(() => {
    if (!editor) return;
    const openLocalMarkdown = (event: MouseEvent) => {
      const eventTarget = event.target instanceof Element ? event.target : undefined;
      const hitTarget = typeof document.elementFromPoint === "function"
        ? document.elementFromPoint(event.clientX, event.clientY)
        : undefined;
      const target = hitTarget instanceof Element && editor.view.dom.contains(hitTarget) ? hitTarget : eventTarget;
      if (isMarkdownSyntaxEditorActive(editor.view) && !target?.closest(".markdown-inline-session")) return;
      const anchor = target?.closest<HTMLAnchorElement>("a[href]");
      if (event.button === 0 && anchor && !event.metaKey && !event.ctrlKey) {
        const pointerPosition = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
          ?? editor.state.selection.from;
        setLinkEditor(undefined);
        if (openLinkMarkdownEditorAtPosition(editor, pointerPosition, anchor)) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      if (
        event.button !== 0
        || !target
        || target.closest("a[href], .markdown-inline-session")
        || target.closest("ul[data-type='taskList'] li > label")
        || !target.closest("h1, h2, h3, h4, h5, h6, blockquote, li, strong, b, em, i, s, del, code:not(pre code)")
      ) return;
      const pointerPosition = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
        ?? editor.state.selection.from;
      if (!openMarkdownSyntaxEditorAtPosition(editor, pointerPosition, target, event)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    editor.view.dom.addEventListener("mousedown", openLocalMarkdown, true);
    return () => editor.view.dom.removeEventListener("mousedown", openLocalMarkdown, true);
  }, [editor]);

  useEffect(() => {
    if (linkEditor) linkInputRef.current?.focus();
  }, [linkEditor]);

  const openLinkEditor = () => {
    if (!editor?.isEditable) return;
    clearMarkdownSyntaxEditor(editor.view);
    if (editor.isActive("link")) editor.commands.extendMarkRange("link");
    const { from, to } = editor.state.selection;
    const start = editor.view.coordsAtPos(from);
    const end = editor.view.coordsAtPos(to);
    setLinkEditor({
      left: Math.max(12, Math.min(window.innerWidth - 532, (start.left + end.right) / 2 - 260)),
      top: Math.max(12, Math.min(window.innerHeight - 190, Math.max(52, Math.max(start.bottom, end.bottom) + 8))),
      href: String(editor.getAttributes("link").href ?? ""),
      text: editor.state.doc.textBetween(from, to, ""),
      from,
      to
    });
  };

  const applyLink = () => {
    if (!editor || !linkEditor) return;
    const href = linkEditor.href.trim();
    const text = linkEditor.text || href;
    const from = Math.min(linkEditor.from, editor.state.doc.content.size);
    const to = Math.min(linkEditor.to, editor.state.doc.content.size);
    if (!text && from === to) {
      setLinkEditor(undefined);
      editor.commands.focus();
      return;
    }
    const marks = href ? [editor.schema.marks.link.create({ href })] : [];
    const transaction = editor.state.tr.replaceWith(from, to, editor.schema.text(text, marks));
    transaction.setSelection(TextSelection.create(transaction.doc, from + text.length));
    editor.view.dispatch(transaction.scrollIntoView());
    editor.view.focus();
    setLinkEditor(undefined);
  };

  useImperativeHandle(ref, () => ({
    focus: () => editor?.commands.focus(),
    toggleBold: () => { if (editor?.isEditable) editor.chain().focus().toggleBold().run(); },
    toggleItalic: () => { if (editor?.isEditable) editor.chain().focus().toggleItalic().run(); },
    editLink: openLinkEditor,
    undo: () => { editor?.commands.undo(); },
    redo: () => { editor?.commands.redo(); },
    insertTable: () => {
      if (editor?.isEditable) setTableInsertOpen(true);
    },
    insertMermaid: () => {
      if (!editor?.isEditable) return;
      editor.chain().focus().insertContent({
        type: "mermaidBlock",
        attrs: { markdown: "```mermaid\nflowchart LR\n  A --> B\n```" }
      }).run();
    },
    insertMath: () => {
      if (!editor?.isEditable) return;
      editor.chain().focus().insertContent({
        type: "mathBlock",
        attrs: { markdown: "$$\nE = mc^2\n$$" }
      }).run();
    },
    getExportHtml: () => editor ? snapshotEditorHtml(editor.view.dom) : "",
    find: (query, direction = "next") => editor ? selectMatch(editor, query, direction) : { current: 0, total: 0 },
    jumpToHeading: (reference) => editor ? jumpToHeading(editor, reference) : false
  }), [editor]);

  if (!editor) return <div className="editor-loading" aria-label="正在载入文档" />;

  return (
    <div className="editor-host">
      <EditorContent editor={editor} />
      <SelectionToolbar editor={editor} position={toolbarPosition} onEditLink={openLinkEditor} />
      <TableToolbar editor={editor} />
      <CodeLanguageControl editor={editor} />
      <TableInsertDialog
        open={tableInsertOpen}
        onClose={() => {
          setTableInsertOpen(false);
          editor.commands.focus();
        }}
        onInsert={(rows, columns) => {
          editor.chain().focus().insertTable({ rows, cols: columns, withHeaderRow: true }).run();
          setTableInsertOpen(false);
        }}
      />
      {diagramViewer ? (
        <DiagramViewer content={diagramViewer} onClose={() => setDiagramViewer(undefined)} />
      ) : null}
      {linkEditor ? (
        <form
          className="link-editor-popover"
          role="dialog"
          aria-label="插入链接"
          style={{ left: linkEditor.left, top: linkEditor.top }}
          onSubmit={(event) => {
            event.preventDefault();
            applyLink();
          }}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            setLinkEditor(undefined);
            editor.commands.focus();
          }}
        >
          <label>
            <span>文本</span>
            <input
              ref={linkInputRef}
              aria-label="链接文本"
              placeholder="文本描述"
              value={linkEditor.text}
              onChange={(event) => setLinkEditor({ ...linkEditor, text: event.currentTarget.value })}
            />
          </label>
          <label>
            <span>链接</span>
            <input
              aria-label="链接地址"
              placeholder="添加链接地址"
              value={linkEditor.href}
              onChange={(event) => setLinkEditor({ ...linkEditor, href: event.currentTarget.value })}
            />
          </label>
          <div className="link-editor-actions">
            <button type="button" onClick={() => {
              setLinkEditor(undefined);
              editor.commands.focus();
            }}>取消</button>
            <button type="submit" className="is-primary">确定</button>
          </div>
        </form>
      ) : null}
    </div>
  );
});
