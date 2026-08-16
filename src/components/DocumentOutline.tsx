import { ListTree } from "lucide-react";
import { useMemo } from "react";

import { extractDocumentHeadings } from "../editor/headingOutline";

type Props = {
  markdown: string;
  onSelect: (reference: string) => void;
};

export function DocumentOutline({ markdown, onSelect }: Props) {
  const headings = useMemo(() => extractDocumentHeadings(markdown), [markdown]);
  if (!headings.length) return null;

  return (
    <nav className="document-outline" aria-label="文档大纲">
      <header className="document-outline-header">
        <ListTree size={15} aria-hidden="true" />
        <span>大纲</span>
      </header>
      <ol>
        {headings.map((heading) => (
          <li key={heading.id}>
            <button
              type="button"
              style={{ paddingLeft: `${12 + (heading.level - 1) * 11}px` }}
              title={heading.text}
              onClick={() => onSelect(heading.reference)}
            >
              {heading.text}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
