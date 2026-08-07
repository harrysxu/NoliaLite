import type { Editor, JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Columns3,
  EllipsisVertical,
  Rows3,
  Trash2
} from "lucide-react";
import { useEffect, useState } from "react";

type Position = { left: number; top: number; below: boolean };
type Point = { left: number; top: number };
type TableRange = { from: number; to: number; node: ProseMirrorNode };
type SourceEditorState = Point & TableRange & { markdown: string; error?: string };

function tableElementAtSelection(editor: Editor): HTMLTableElement | undefined {
  if (editor.isDestroyed) return undefined;
  if (!editor.isActive("table")) return undefined;
  const resolved = editor.view.domAtPos(editor.state.selection.from).node;
  const element = resolved instanceof Element ? resolved : resolved.parentElement;
  return element?.closest("table") ?? undefined;
}

function tableRangeAtSelection(editor: Editor): TableRange | undefined {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === "table") {
      return { from: $from.before(depth), to: $from.after(depth), node };
    }
  }
  return undefined;
}

export function TableToolbar({ editor }: { editor: Editor }) {
  const [position, setPosition] = useState<Position>();
  const [menuPoint, setMenuPoint] = useState<Point>();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sourceEditor, setSourceEditor] = useState<SourceEditorState>();

  useEffect(() => {
    let frame = 0;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        if (editor.isDestroyed) return;
        if (!editor.isEditable) {
          setPosition(undefined);
          setMenuOpen(false);
          setSourceEditor(undefined);
          return;
        }
        const table = tableElementAtSelection(editor);
        if (!table) {
          setPosition(undefined);
          setMenuOpen(false);
          return;
        }
        const bounds = table.getBoundingClientRect();
        const below = bounds.top < 96;
        setPosition({
          left: Math.max(180, Math.min(window.innerWidth - 12, bounds.right)),
          top: below ? Math.min(window.innerHeight - 44, bounds.bottom + 8) : bounds.top - 8,
          below
        });
      });
    };
    const handleContextMenu = (event: globalThis.MouseEvent) => {
      const target = event.target instanceof Element ? event.target : undefined;
      const table = target?.closest("table");
      if (!table || !editor.view.dom.contains(table)) return;
      const pointer = editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
      if (pointer) {
        const selection = TextSelection.near(editor.state.doc.resolve(pointer.pos));
        editor.view.dispatch(editor.state.tr.setSelection(selection));
      }
      event.preventDefault();
      setMenuPoint({
        left: Math.max(12, Math.min(window.innerWidth - 252, event.clientX)),
        top: Math.max(52, Math.min(window.innerHeight - 360, event.clientY))
      });
      setMenuOpen(true);
    };
    const closeOutside = (event: globalThis.MouseEvent) => {
      const target = event.target instanceof Element ? event.target : undefined;
      if (target?.closest(".table-toolbar, .table-menu-popover, .table-source-popover")) return;
      setMenuOpen(false);
    };

    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    editor.view.dom.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("mousedown", closeOutside);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    update();
    return () => {
      window.cancelAnimationFrame(frame);
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
      editor.view.dom.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("mousedown", closeOutside);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [editor]);

  const run = (action: () => void) => {
    action();
    setMenuOpen(false);
    setMenuPoint(undefined);
  };

  const openSourceEditor = () => {
    const range = tableRangeAtSelection(editor);
    const table = tableElementAtSelection(editor);
    if (!range || !table || !editor.markdown) return;
    const bounds = table.getBoundingClientRect();
    const markdown = editor.markdown.serialize({ type: "doc", content: [cleanTrackingAttributes(range.node.toJSON())] }).trim();
    setSourceEditor({
      ...range,
      markdown,
      left: Math.max(292, Math.min(window.innerWidth - 292, bounds.left + bounds.width / 2)),
      top: Math.max(64, Math.min(window.innerHeight - 280, bounds.top + 20))
    });
    setMenuOpen(false);
  };

  const applySource = () => {
    if (!sourceEditor || !editor.markdown) return;
    try {
      const parsed = editor.markdown.parse(sourceEditor.markdown);
      const nodes = parsed.content ?? [];
      if (nodes.length !== 1 || nodes[0].type !== "table") throw new Error("请输入一张有效的 Markdown 表格");
      const table = editor.schema.nodeFromJSON(nodes[0]);
      const from = Math.min(sourceEditor.from, editor.state.doc.content.size);
      const existing = editor.state.doc.nodeAt(from);
      const to = existing?.type.name === "table" ? from + existing.nodeSize : Math.min(sourceEditor.to, editor.state.doc.content.size);
      const transaction = editor.state.tr.replaceWith(from, to, table);
      const selectionPosition = Math.min(from + 3, transaction.doc.content.size);
      transaction.setSelection(TextSelection.near(transaction.doc.resolve(selectionPosition)));
      editor.view.dispatch(transaction.scrollIntoView());
      editor.view.focus();
      setSourceEditor(undefined);
    } catch (error) {
      setSourceEditor((current) => current ? {
        ...current,
        error: error instanceof Error ? error.message : "无法解析 Markdown 表格"
      } : current);
    }
  };

  if (!editor.isEditable || (!position && !sourceEditor)) return null;

  const toolbarButton = (label: string, icon: React.ReactNode, action: () => void) => (
    <button type="button" aria-label={label} title={label} onMouseDown={(event) => event.preventDefault()} onClick={action}>
      {icon}
    </button>
  );
  const automaticMenuPoint = position ? {
    left: Math.max(12, Math.min(window.innerWidth - 252, position.left - 244)),
    top: Math.max(52, Math.min(window.innerHeight - 404, position.below ? position.top + 38 : position.top + 4))
  } : undefined;

  return (
    <>
      {position ? (
        <div
          className={`table-toolbar${position.below ? " is-below" : ""}`}
          role="toolbar"
          aria-label="表格操作"
          style={{ left: position.left, top: position.top }}
        >
          {toolbarButton("更多表格操作", <EllipsisVertical size={16} />, () => {
            setMenuPoint(undefined);
            setMenuOpen((value) => !value);
          })}
          <span className="toolbar-separator" aria-hidden="true" />
          {toolbarButton("左对齐", <AlignLeft size={16} />, () => run(() => editor.chain().focus().setCellAttribute("align", "left").run()))}
          {toolbarButton("居中对齐", <AlignCenter size={16} />, () => run(() => editor.chain().focus().setCellAttribute("align", "center").run()))}
          {toolbarButton("右对齐", <AlignRight size={16} />, () => run(() => editor.chain().focus().setCellAttribute("align", "right").run()))}
          <span className="toolbar-separator" aria-hidden="true" />
          {toolbarButton("删除表格", <Trash2 size={16} />, () => run(() => editor.chain().focus().deleteTable().run()))}
        </div>
      ) : null}

      {menuOpen && (menuPoint ?? automaticMenuPoint) ? (
        <TableMenu
          editor={editor}
          point={menuPoint ?? automaticMenuPoint!}
          onRun={run}
          onEditSource={openSourceEditor}
        />
      ) : null}

      {sourceEditor ? (
        <form
          className={`table-source-popover${sourceEditor.error ? " has-source-error" : ""}`}
          role="dialog"
          aria-label="表格 Markdown 源码"
          style={{ left: sourceEditor.left, top: sourceEditor.top }}
          onSubmit={(event) => {
            event.preventDefault();
            applySource();
          }}
          onBlur={(event) => {
            if (event.relatedTarget instanceof globalThis.Node && event.currentTarget.contains(event.relatedTarget)) return;
            applySource();
          }}
        >
          <label>
            <span>Markdown 表格源码</span>
            <textarea
              autoFocus
              aria-label="表格 Markdown 源码"
              value={sourceEditor.markdown}
              rows={Math.min(14, Math.max(5, sourceEditor.markdown.split(/\r?\n/).length + 1))}
              spellCheck={false}
              onChange={(event) => setSourceEditor({ ...sourceEditor, markdown: event.currentTarget.value, error: undefined })}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Escape") {
                  event.preventDefault();
                  setSourceEditor(undefined);
                  editor.view.focus();
                } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  applySource();
                }
              }}
            />
          </label>
          {sourceEditor.error ? <p role="alert">{sourceEditor.error}</p> : null}
          <div className="table-source-actions">
            <button type="button" onClick={() => {
              setSourceEditor(undefined);
              editor.view.focus();
            }}>取消</button>
            <button type="submit" className="is-primary">应用</button>
          </div>
        </form>
      ) : null}
    </>
  );
}

function TableMenu({
  editor,
  point,
  onRun,
  onEditSource
}: {
  editor: Editor;
  point: Point;
  onRun: (action: () => void) => void;
  onEditSource: () => void;
}) {
  const range = tableRangeAtSelection(editor);
  const dimensions = range ? tableDimensions(range.node) : { rows: 3, columns: 3 };
  const item = (label: string, action: () => void, icon?: React.ReactNode) => (
    <button type="button" role="menuitem" onMouseDown={(event) => event.preventDefault()} onClick={() => onRun(action)}>
      {icon}<span>{label}</span>
    </button>
  );
  return (
    <div className="table-menu-popover" role="menu" aria-label="表格操作" style={point}>
      <TableResizePicker editor={editor} rows={dimensions.rows} columns={dimensions.columns} onRun={onRun} />
      <span className="table-menu-separator" aria-hidden="true" />
      <button type="button" role="menuitem" onMouseDown={(event) => event.preventDefault()} onClick={onEditSource}>
        <span>编辑 Markdown 源码</span>
      </button>
      <span className="table-menu-separator" aria-hidden="true" />
      {item("在左侧新增列", () => editor.chain().focus().addColumnBefore().run(), <BetweenVerticalStart size={15} />)}
      {item("在右侧新增列", () => editor.chain().focus().addColumnAfter().run(), <BetweenVerticalEnd size={15} />)}
      {item("在上方新增行", () => editor.chain().focus().addRowBefore().run(), <BetweenHorizontalStart size={15} />)}
      {item("在下方新增行", () => editor.chain().focus().addRowAfter().run(), <BetweenHorizontalEnd size={15} />)}
      <span className="table-menu-separator" aria-hidden="true" />
      {item("删除当前列", () => editor.chain().focus().deleteColumn().run(), <Columns3 size={15} />)}
      {item("删除当前行", () => editor.chain().focus().deleteRow().run(), <Rows3 size={15} />)}
      {item("删除表格", () => editor.chain().focus().deleteTable().run(), <Trash2 size={15} />)}
      <span className="table-menu-separator" aria-hidden="true" />
      {item("切换表头行", () => editor.chain().focus().toggleHeaderRow().run())}
      {item("切换表头列", () => editor.chain().focus().toggleHeaderColumn().run())}
    </div>
  );
}

function TableResizePicker({
  editor,
  rows,
  columns,
  onRun
}: {
  editor: Editor;
  rows: number;
  columns: number;
  onRun: (action: () => void) => void;
}) {
  const [preview, setPreview] = useState({ rows: Math.min(rows, 10), columns: Math.min(columns, 10) });
  return (
    <div className="table-resize-picker" aria-label={`${preview.rows} x ${preview.columns}`} onMouseLeave={() => setPreview({ rows: Math.min(rows, 10), columns: Math.min(columns, 10) })}>
      <div className="table-picker-header"><span>表格大小</span><strong>{preview.rows} x {preview.columns}</strong></div>
      <div className="table-grid-picker">
        {Array.from({ length: 100 }).map((_, index) => {
          const row = Math.floor(index / 10) + 1;
          const column = index % 10 + 1;
          const selected = row <= preview.rows && column <= preview.columns;
          const current = row <= rows && column <= columns;
          return (
            <button
              key={index}
              type="button"
              className={`${selected ? "is-selected" : ""}${current ? " is-current" : ""}`}
              aria-label={`${row} x ${column}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setPreview({ rows: row, columns: column })}
              onFocus={() => setPreview({ rows: row, columns: column })}
              onClick={() => onRun(() => resizeSelectedTable(editor, row, column))}
            />
          );
        })}
      </div>
    </div>
  );
}

function tableDimensions(table: ProseMirrorNode): { rows: number; columns: number } {
  let columns = 0;
  table.forEach((row) => { columns = Math.max(columns, row.childCount); });
  return { rows: table.childCount, columns: Math.max(1, columns) };
}

function resizeSelectedTable(editor: Editor, rows: number, columns: number) {
  const range = tableRangeAtSelection(editor);
  if (!range) return;
  const rowType = editor.schema.nodes.tableRow;
  const headerType = editor.schema.nodes.tableHeader;
  const cellType = editor.schema.nodes.tableCell;
  const paragraphType = editor.schema.nodes.paragraph;
  const firstRow = range.node.childCount ? range.node.child(0) : undefined;
  const hasHeader = Boolean(firstRow?.childCount && Array.from({ length: firstRow.childCount }).every((_, index) => firstRow.child(index).type.name === "tableHeader"));
  const nextRows: ProseMirrorNode[] = [];
  for (let rowIndex = 0; rowIndex < Math.max(1, Math.min(20, rows)); rowIndex += 1) {
    const existingRow = rowIndex < range.node.childCount ? range.node.child(rowIndex) : undefined;
    const cells: ProseMirrorNode[] = [];
    for (let columnIndex = 0; columnIndex < Math.max(1, Math.min(12, columns)); columnIndex += 1) {
      const existing = existingRow && columnIndex < existingRow.childCount ? existingRow.child(columnIndex) : undefined;
      cells.push(existing ?? (hasHeader && rowIndex === 0 ? headerType : cellType).create(null, paragraphType.create()));
    }
    nextRows.push(rowType.create(null, cells));
  }
  const table = range.node.type.create(range.node.attrs, nextRows, range.node.marks);
  const transaction = editor.state.tr.replaceWith(range.from, range.to, table);
  transaction.setSelection(TextSelection.near(transaction.doc.resolve(Math.min(range.from + 3, transaction.doc.content.size))));
  editor.view.dispatch(transaction.scrollIntoView());
  editor.view.focus();
}

function cleanTrackingAttributes(node: JSONContent): JSONContent {
  const attrs = node.attrs ? { ...node.attrs } : undefined;
  if (attrs) {
    delete attrs.sourceRaw;
    delete attrs.sourceCanonical;
    delete attrs.sourceIndex;
  }
  return {
    ...node,
    ...(attrs && Object.keys(attrs).length ? { attrs } : { attrs: undefined }),
    ...(node.content ? { content: node.content.map(cleanTrackingAttributes) } : {})
  };
}

export function TableInsertDialog({
  open,
  onClose,
  onInsert
}: {
  open: boolean;
  onClose: () => void;
  onInsert: (rows: number, columns: number) => void;
}) {
  const [preview, setPreview] = useState({ rows: 3, columns: 3 });
  if (!open) return null;
  return (
    <div className="table-insert-layer" role="dialog" aria-modal="true" aria-label="插入表格" onKeyDown={(event) => {
      if (event.key === "Escape") onClose();
    }}>
      <button type="button" className="table-insert-backdrop" aria-label="取消插入表格" onClick={onClose} />
      <section className="table-insert-popover">
        <div className="table-picker-header"><span>插入表格</span><strong>{preview.rows} x {preview.columns}</strong></div>
        <div className="table-grid-picker">
          {Array.from({ length: 80 }).map((_, index) => {
            const row = Math.floor(index / 10) + 1;
            const column = index % 10 + 1;
            return (
              <button
                key={index}
                type="button"
                autoFocus={row === 3 && column === 3}
                className={row <= preview.rows && column <= preview.columns ? "is-selected" : ""}
                aria-label={`${row} x ${column}`}
                onMouseEnter={() => setPreview({ rows: row, columns: column })}
                onFocus={() => setPreview({ rows: row, columns: column })}
                onClick={() => onInsert(row, column)}
              />
            );
          })}
        </div>
      </section>
    </div>
  );
}

export const _testing = { tableDimensions, cleanTrackingAttributes };
