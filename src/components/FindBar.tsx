import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useRef } from "react";

import type { FindResult } from "../editor/MarkdownEditor";

type Props = {
  query: string;
  result: FindResult;
  onQueryChange: (value: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
};

export function FindBar({ query, result, onQueryChange, onPrevious, onNext, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="find-bar" role="search">
      <input
        ref={inputRef}
        aria-label="在文档中查找"
        value={query}
        onChange={(event) => onQueryChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (event.shiftKey) onPrevious();
            else onNext();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      />
      <span aria-live="polite">{query ? `${result.current}/${result.total}` : ""}</span>
      <button type="button" onClick={onPrevious} aria-label="上一个匹配项" title="上一个匹配项">
        <ChevronUp size={15} />
      </button>
      <button type="button" onClick={onNext} aria-label="下一个匹配项" title="下一个匹配项">
        <ChevronDown size={15} />
      </button>
      <button type="button" onClick={onClose} aria-label="关闭查找" title="关闭查找">
        <X size={15} />
      </button>
    </div>
  );
}
