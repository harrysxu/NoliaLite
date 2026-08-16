import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export type SourceEditorHandle = {
  insertText: (text: string) => void;
  focus: () => void;
  find: (query: string, direction?: "next" | "previous") => { current: number; total: number };
  codeBlockText: () => string | undefined;
};

type Props = {
  value: string;
  editable: boolean;
  autofocus?: boolean;
  onChange: (value: string) => void;
  onExit: () => void;
};

type SourceMatch = { from: number; to: number };

function sourceMatches(value: string, query: string): SourceMatch[] {
  if (!query) return [];
  const haystack = value.toLocaleLowerCase();
  const needle = query.toLocaleLowerCase();
  const matches: SourceMatch[] = [];
  let index = haystack.indexOf(needle);
  while (index >= 0) {
    matches.push({ from: index, to: index + query.length });
    index = haystack.indexOf(needle, index + Math.max(query.length, 1));
  }
  return matches;
}

function codeBlockTextAt(value: string, position: number): string | undefined {
  const fence = /^( {0,3})(`{3,}|~{3,})[^\r\n]*\r?\n([\s\S]*?)^(?: {0,3})\2[ \t]*$/gm;
  for (const match of value.matchAll(fence)) {
    const start = match.index;
    const end = start + match[0].length;
    if (position < start || position > end) continue;
    return match[3].replace(/\r?\n$/, "");
  }
  return undefined;
}

export const SourceEditor = forwardRef<SourceEditorHandle, Props>(function SourceEditor(
  { value, editable, autofocus = false, onChange, onExit },
  ref
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autofocus) textareaRef.current?.focus();
  }, [autofocus]);

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
    insertText: (text) => {
      const textarea = textareaRef.current;
      if (!textarea || !editable) return;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      onChange(`${value.slice(0, start)}${text}${value.slice(end)}`);
      requestAnimationFrame(() => {
        const position = start + text.length;
        textarea.focus();
        textarea.setSelectionRange(position, position);
      });
    },
    find: (query, direction = "next") => {
      const textarea = textareaRef.current;
      const matches = sourceMatches(value, query);
      if (!textarea || !matches.length) return { current: 0, total: 0 };
      const cursor = textarea.selectionStart;
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
      textarea.setSelectionRange(match.from, match.to);
      return { current: index + 1, total: matches.length };
    },
    codeBlockText: () => {
      const textarea = textareaRef.current;
      return textarea ? codeBlockTextAt(value, textarea.selectionStart) : undefined;
    }
  }), [editable, onChange, value]);

  return (
    <textarea
      ref={textareaRef}
      className="markdown-source-editor"
      aria-label="Markdown 源码"
      spellCheck={false}
      readOnly={!editable}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape" || ((event.metaKey || event.ctrlKey) && event.key === "/")) {
          event.preventDefault();
          event.stopPropagation();
          onExit();
        }
      }}
    />
  );
});
