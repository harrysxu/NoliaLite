import type { Editor } from "@tiptap/core";
import { Bold, Code, Italic, Link2, Strikethrough } from "lucide-react";

type ToolbarPosition = { left: number; top: number };

type Props = {
  editor: Editor;
  position?: ToolbarPosition;
  onEditLink: () => void;
};

export function SelectionToolbar({ editor, position, onEditLink }: Props) {
  if (!position) return null;

  const button = (
    label: string,
    active: boolean,
    icon: React.ReactNode,
    onClick: () => void
  ) => (
    <button
      type="button"
      className={active ? "is-active" : undefined}
      aria-label={label}
      title={label}
      aria-pressed={active}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {icon}
    </button>
  );

  return (
    <div
      className="selection-toolbar"
      role="toolbar"
      aria-label="文本格式"
      style={{ left: position.left, top: position.top }}
    >
      {button("粗体", editor.isActive("bold"), <Bold size={16} />, () => editor.chain().focus().toggleBold().run())}
      {button("斜体", editor.isActive("italic"), <Italic size={16} />, () => editor.chain().focus().toggleItalic().run())}
      {button("删除线", editor.isActive("strike"), <Strikethrough size={16} />, () => editor.chain().focus().toggleStrike().run())}
      {button("行内代码", editor.isActive("code"), <Code size={16} />, () => editor.chain().focus().toggleCode().run())}
      <span className="toolbar-separator" aria-hidden="true" />
      {button("链接", editor.isActive("link"), <Link2 size={16} />, onEditLink)}
    </div>
  );
}
