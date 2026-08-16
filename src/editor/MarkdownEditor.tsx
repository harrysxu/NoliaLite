import { Extension, type Editor, type JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { NodeSelection, Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { EditorContent, useEditor } from "@tiptap/react";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";

import type { PreferredEol } from "../bridge/contracts";
import { importDocumentImage, pickImageFiles } from "../bridge/tauriClient";
import { CodeLanguageControl, copyText } from "./CodeLanguageControl";
import { DiagramViewer, type DiagramViewerContent } from "./DiagramViewer";
import { createEditorExtensions, isAllowedLink } from "./extensions";
import { SelectionToolbar } from "./SelectionToolbar";
import { parseTrackedMarkdown, serializeTrackedMarkdown } from "./sourceDocument";
import { SourceEditor, type SourceEditorHandle } from "./SourceEditor";
import { TableInsertDialog, TableToolbar } from "./TableToolbar";
import { snapshotEditorHtml } from "./exportDocument";

export type FindResult = { current: number; total: number };

export type MarkdownEditorHandle = {
  focus: () => void;
  toggleSource: () => void;
  toggleBold: () => void;
  toggleItalic: () => void;
  toggleStrike: () => void;
  toggleCode: () => void;
  setParagraph: () => void;
  toggleHeading: (level: 1 | 2 | 3 | 4 | 5 | 6) => void;
  toggleBlockquote: () => void;
  toggleBulletList: () => void;
  toggleOrderedList: () => void;
  toggleTaskList: () => void;
  toggleCodeBlock: () => void;
  insertHorizontalRule: () => void;
  insertImage: () => Promise<number>;
  insertImageFiles: (paths: string[]) => Promise<number>;
  copyCode: () => Promise<boolean>;
  editLink: () => void;
  undo: () => void;
  redo: () => void;
  insertTable: () => void;
  insertMermaid: () => void;
  insertMath: () => void;
  prepareExport: () => Promise<void>;
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
  onOpenLink?: (href: string, options: { newWindow: boolean }) => void;
  onError?: (message: string) => void;
};

type Match = { from: number; to: number };
type LinkEditorState = { left: number; top: number; href: string; text: string; from: number; to: number };

type FindHighlightState = { query: string; matches: Match[]; current: number };
const findHighlightKey = new PluginKey<FindHighlightState>("findHighlights");

const FindHighlights = Extension.create({
  name: "findHighlights",
  addProseMirrorPlugins() {
    return [new Plugin<FindHighlightState>({
      key: findHighlightKey,
      state: {
        init: () => ({ query: "", matches: [], current: -1 }),
        apply: (transaction, previous) => {
          const update = transaction.getMeta(findHighlightKey) as FindHighlightState | undefined;
          if (update) return update;
          if (!transaction.docChanged || !previous.query) return previous;
          const matches = textMatches(transaction.doc, previous.query);
          return { ...previous, matches, current: Math.min(previous.current, matches.length - 1) };
        }
      },
      props: {
        decorations: (state) => {
          const highlights = findHighlightKey.getState(state);
          if (!highlights?.matches.length) return DecorationSet.empty;
          return DecorationSet.create(state.doc, highlights.matches.map((match, index) =>
            Decoration.inline(match.from, match.to, {
              class: index === highlights.current ? "find-match is-current" : "find-match"
            })
          ));
        }
      }
    })];
  }
});

export function codeBlockTextAtSelection(editor: Editor): string | undefined {
  const { selection } = editor.state;
  if (selection instanceof NodeSelection && selection.node.type.name === "codeBlock") {
    return selection.node.textContent;
  }
  const { $from } = selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === "codeBlock") return node.textContent;
  }
  return undefined;
}

function textMatches(documentNode: Editor["state"]["doc"], query: string): Match[] {
  if (!query) return [];
  const needle = query.toLocaleLowerCase();
  const matches: Match[] = [];
  documentNode.descendants((node, position) => {
    if (!node.isTextblock) return;
    const text = node.textBetween(0, node.content.size, "\n", "\n");
    const haystack = text.toLocaleLowerCase();
    let index = haystack.indexOf(needle);
    while (index >= 0) {
      matches.push({ from: position + 1 + index, to: position + 1 + index + query.length });
      index = haystack.indexOf(needle, index + Math.max(query.length, 1));
    }
    return false;
  });
  return matches;
}

function selectMatch(editor: Editor, query: string, direction: "next" | "previous"): FindResult {
  const matches = textMatches(editor.state.doc, query);
  if (!matches.length) {
    const transaction = editor.state.tr.setMeta(findHighlightKey, { query, matches: [], current: -1 });
    if (!query && !editor.state.selection.empty) {
      transaction.setSelection(TextSelection.create(editor.state.doc, editor.state.selection.to));
    }
    editor.view.dispatch(transaction);
    return { current: 0, total: 0 };
  }
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
    editor.state.tr
      .setSelection(TextSelection.create(editor.state.doc, match.from, match.to))
      .setMeta(findHighlightKey, { query, matches, current: index })
      .scrollIntoView()
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

async function waitForExportAssets(root: HTMLElement): Promise<void> {
  await document.fonts?.ready;
  const deadline = Date.now() + 5_000;
  while (root.querySelector(".mermaid-block-state, [data-export-pending='true']")) {
    if (Date.now() >= deadline) throw new Error("图表或图片仍在渲染，请稍后重试。");
    await new Promise((resolve) => window.setTimeout(resolve, 25));
  }
  const images = Array.from(root.querySelectorAll<HTMLImageElement>("img"));
  await Promise.all(images.map(async (image) => {
    if (image.complete) return;
    await new Promise<void>((resolve) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => resolve(), { once: true });
    });
  }));
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, Props>(function MarkdownEditor(
  { value, filePath, preferredEol, editable, autofocus, onChange, onOpenLink, onError },
  ref
) {
  const [sourceMode, setSourceMode] = useState(false);
  const [sourceValue, setSourceValue] = useState(value);
  const [diagramViewer, setDiagramViewer] = useState<DiagramViewerContent>();
  const [tableInsertOpen, setTableInsertOpen] = useState(false);
  const sourceEditorRef = useRef<SourceEditorHandle>(null);
  const extensions = useMemo(
    () => [...createEditorExtensions(filePath, setDiagramViewer, editable, onError), FindHighlights],
    [editable, filePath, onError]
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
      handleDOMEvents: {
        click: (view, event) => {
          const mouseEvent = event as MouseEvent;
          const eventTarget = mouseEvent.target instanceof Element ? mouseEvent.target : undefined;
          const hitTarget = typeof document.elementFromPoint === "function"
            ? document.elementFromPoint(mouseEvent.clientX, mouseEvent.clientY)
            : undefined;
          const target = hitTarget instanceof Element && view.dom.contains(hitTarget) ? hitTarget : eventTarget;
          const anchor = target?.closest<HTMLAnchorElement>("a[href]");
          const href = anchor?.getAttribute("href");
          if (!anchor || !href) return false;
          mouseEvent.preventDefault();
          onOpenLink?.(href, { newWindow: mouseEvent.metaKey || mouseEvent.ctrlKey });
          return true;
        }
      }
    },
    onUpdate: ({ editor: currentEditor }) => {
      if (!currentEditor.markdown) return;
      onChange(serializeTrackedMarkdown(currentEditor.getJSON(), currentEditor.markdown, preferredEol));
    },
    onSelectionUpdate: ({ editor: currentEditor }) => {
      const { from, to } = currentEditor.state.selection;
      if (from === to || !currentEditor.isEditable || !currentEditor.isFocused) {
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

  useEffect(() => {
    if (linkEditor) linkInputRef.current?.focus();
  }, [linkEditor]);

  const openLinkEditor = () => {
    if (!editor?.isEditable) return;
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
    if (href && !isAllowedLink(href)) {
      onError?.("链接地址不受支持。");
      return;
    }
    const marks = href ? [editor.schema.marks.link.create({ href })] : [];
    const transaction = editor.state.tr.replaceWith(from, to, editor.schema.text(text, marks));
    transaction.setSelection(TextSelection.create(transaction.doc, from + text.length));
    editor.view.dispatch(transaction.scrollIntoView());
    editor.view.focus();
    setLinkEditor(undefined);
  };

  const exitSourceMode = () => {
    if (editor?.markdown) {
      editor.commands.setContent(parseTrackedMarkdown(sourceValue, editor.markdown), { emitUpdate: false });
    }
    setSourceMode(false);
    requestAnimationFrame(() => editor?.commands.focus());
  };

  const changeSource = (next: string) => {
    setSourceValue(next);
    if (editor?.markdown) {
      editor.commands.setContent(parseTrackedMarkdown(next, editor.markdown), { emitUpdate: false });
    }
    onChange(next);
  };

  const insertImagePaths = async (paths: string[]): Promise<number> => {
    if (!editor?.isEditable || !filePath || !paths.length) return 0;
    const content = [];
    for (const path of paths) {
      const source = await importDocumentImage(filePath, path);
      const fileName = path.split(/[\\/]/).pop() || "图片";
      const alt = fileName.replace(/\.[^.]+$/, "").replace(/([\\\]])/g, "\\$1");
      content.push({
        type: "image",
        attrs: { src: source, alt, markdown: `![${alt}](${source})` }
      });
    }
    if (sourceMode) {
      const markdown = content.map((node) => node.attrs.markdown).join("\n\n");
      sourceEditorRef.current?.insertText(markdown);
    } else {
      editor.chain().focus().insertContent(content).run();
    }
    return content.length;
  };

  useImperativeHandle(ref, () => ({
    focus: () => sourceMode ? sourceEditorRef.current?.focus() : editor?.commands.focus(),
    toggleSource: () => {
      if (sourceMode) {
        exitSourceMode();
        return;
      }
      const current = editor ? serializeTrackedMarkdown(editor.getJSON(), editor.markdown!, preferredEol) : value;
      setSourceValue(current);
      setSourceMode(true);
    },
    toggleBold: () => { if (sourceMode) onError?.("请先退出源码模式再使用格式命令。"); else if (editor?.isEditable) editor.chain().focus().toggleBold().run(); },
    toggleItalic: () => { if (sourceMode) onError?.("请先退出源码模式再使用格式命令。"); else if (editor?.isEditable) editor.chain().focus().toggleItalic().run(); },
    toggleStrike: () => { if (sourceMode) onError?.("请先退出源码模式再使用格式命令。"); else if (editor?.isEditable) editor.chain().focus().toggleStrike().run(); },
    toggleCode: () => { if (sourceMode) onError?.("请先退出源码模式再使用格式命令。"); else if (editor?.isEditable) editor.chain().focus().toggleCode().run(); },
    setParagraph: () => { if (sourceMode) onError?.("请先退出源码模式再使用格式命令。"); else if (editor?.isEditable) editor.chain().focus().setParagraph().run(); },
    toggleHeading: (level) => { if (sourceMode) onError?.("请先退出源码模式再使用格式命令。"); else if (editor?.isEditable) editor.chain().focus().toggleHeading({ level }).run(); },
    toggleBlockquote: () => { if (sourceMode) onError?.("请先退出源码模式再使用格式命令。"); else if (editor?.isEditable) editor.chain().focus().toggleBlockquote().run(); },
    toggleBulletList: () => { if (sourceMode) onError?.("请先退出源码模式再使用格式命令。"); else if (editor?.isEditable) editor.chain().focus().toggleBulletList().run(); },
    toggleOrderedList: () => { if (sourceMode) onError?.("请先退出源码模式再使用格式命令。"); else if (editor?.isEditable) editor.chain().focus().toggleOrderedList().run(); },
    toggleTaskList: () => { if (sourceMode) onError?.("请先退出源码模式再使用格式命令。"); else if (editor?.isEditable) editor.chain().focus().toggleTaskList().run(); },
    toggleCodeBlock: () => { if (sourceMode) onError?.("请先退出源码模式再使用格式命令。"); else if (editor?.isEditable) editor.chain().focus().toggleCodeBlock().run(); },
    insertHorizontalRule: () => { if (sourceMode) onError?.("请先退出源码模式再使用格式命令。"); else if (editor?.isEditable) editor.chain().focus().setHorizontalRule().run(); },
    insertImage: async () => insertImagePaths(await pickImageFiles()),
    insertImageFiles: insertImagePaths,
    copyCode: async () => {
      if (sourceMode) {
        const code = sourceEditorRef.current?.codeBlockText();
        if (code === undefined) return false;
        await copyText(code);
        return true;
      }
      if (!editor) return false;
      const code = codeBlockTextAtSelection(editor);
      if (code === undefined) return false;
      await copyText(code);
      return true;
    },
    editLink: () => { if (sourceMode) onError?.("请先退出源码模式再编辑链接。"); else openLinkEditor(); },
    undo: () => { editor?.commands.undo(); },
    redo: () => { editor?.commands.redo(); },
    insertTable: () => {
      if (sourceMode) onError?.("请先退出源码模式再插入表格。");
      else if (editor?.isEditable) setTableInsertOpen(true);
    },
    insertMermaid: () => {
      if (sourceMode) {
        onError?.("请先退出源码模式再插入 Mermaid 图表。");
        return;
      }
      if (!editor?.isEditable) return;
      editor.chain().focus().insertContent({
        type: "mermaidBlock",
        attrs: { markdown: "```mermaid\nflowchart LR\n  A --> B\n```" }
      }).run();
    },
    insertMath: () => {
      if (sourceMode) {
        onError?.("请先退出源码模式再插入公式。");
        return;
      }
      if (!editor?.isEditable) return;
      editor.chain().focus().insertContent({
        type: "mathBlock",
        attrs: { markdown: "$$\nE = mc^2\n$$" }
      }).run();
    },
    prepareExport: async () => {
      if (editor) await waitForExportAssets(editor.view.dom);
    },
    getExportHtml: () => editor ? snapshotEditorHtml(editor.view.dom) : "",
    find: (query, direction = "next") => sourceMode
      ? sourceEditorRef.current?.find(query, direction) ?? { current: 0, total: 0 }
      : editor ? selectMatch(editor, query, direction) : { current: 0, total: 0 },
    jumpToHeading: (reference) => editor ? jumpToHeading(editor, reference) : false
  }), [editor, onError, preferredEol, sourceMode, sourceValue, value]);

  if (!editor) return <div className="editor-loading" aria-label="正在载入文档" />;

  return (
    <div className={`editor-host${sourceMode ? " source-mode" : ""}`}>
      {sourceMode ? (
        <SourceEditor
          ref={sourceEditorRef}
          value={sourceValue}
          editable={editable}
          autofocus
          onChange={changeSource}
          onExit={() => {
            exitSourceMode();
          }}
        />
      ) : null}
      <div className="rendered-editor" hidden={sourceMode}>
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
    </div>
  );
});
