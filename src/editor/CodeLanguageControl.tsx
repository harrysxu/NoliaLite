import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type ControlState = { left: number; top: number; from: number; language: string };

const languageOptions = [
  ["", "纯文本"], ["json", "JSON"], ["xml", "XML"], ["yaml", "YAML"], ["toml", "TOML"],
  ["markdown", "Markdown"], ["javascript", "JavaScript"], ["typescript", "TypeScript"], ["tsx", "TSX"],
  ["jsx", "JSX"], ["html", "HTML"], ["css", "CSS"], ["bash", "Bash"], ["sql", "SQL"],
  ["python", "Python"], ["java", "Java"], ["go", "Go"], ["rust", "Rust"], ["c", "C"],
  ["cpp", "C++"], ["csharp", "C#"], ["php", "PHP"], ["ruby", "Ruby"], ["swift", "Swift"],
  ["kotlin", "Kotlin"], ["dockerfile", "Dockerfile"], ["diff", "Diff"], ["mermaid", "Mermaid 图表"]
] as const;

const languageAliases: ReadonlyMap<string, string> = new Map([
  ["text", ""], ["plaintext", ""], ["txt", ""],
  ["yml", "yaml"], ["js", "javascript"], ["mjs", "javascript"], ["cjs", "javascript"],
  ["ts", "typescript"], ["sh", "bash"], ["shell", "bash"], ["zsh", "bash"],
  ["md", "markdown"], ["mdown", "markdown"], ["py", "python"], ["rs", "rust"],
  ["svg", "xml"], ["xhtml", "xml"], ["scss", "css"], ["less", "css"],
  ["c++", "cpp"], ["cc", "cpp"], ["cxx", "cpp"], ["cs", "csharp"], ["c#", "csharp"],
  ["rb", "ruby"], ["kt", "kotlin"]
]);

export function normalizeCodeBlockLanguage(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return languageAliases.get(normalized) ?? normalized;
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through for WebViews where the Clipboard API is unavailable at runtime.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.setAttribute("readonly", "");
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Unable to copy code");
}

export function CodeLanguageControl({ editor }: { editor: Editor }) {
  const [state, setState] = useState<ControlState>();
  const [copiedFrom, setCopiedFrom] = useState<number>();
  const copiedTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const { $from } = editor.state.selection;
        for (let depth = $from.depth; depth > 0; depth -= 1) {
          const node = $from.node(depth);
          if (node.type.name !== "codeBlock") continue;
          const from = $from.before(depth);
          const dom = editor.view.nodeDOM(from);
          const pre = dom instanceof HTMLPreElement ? dom : dom instanceof Element ? dom.querySelector("pre") : undefined;
          if (!pre) break;
          const bounds = pre.getBoundingClientRect();
          const controlWidth = editor.isEditable ? 158 : 30;
          setState({
            left: Math.max(12, Math.min(window.innerWidth - controlWidth - 12, bounds.right - controlWidth - 8)),
            top: Math.max(52, bounds.top + 8),
            from,
            language: normalizeCodeBlockLanguage(node.attrs.language)
          });
          return;
        }
        setState(undefined);
      });
    };
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    update();
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(copiedTimer.current);
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [editor]);

  if (!state) return null;
  const copied = copiedFrom === state.from;
  const options = languageOptions.some(([value]) => value === state.language)
    ? languageOptions
    : [[state.language, state.language], ...languageOptions] as const;
  return (
    <div
      className="code-language-control"
      role="toolbar"
      aria-label="代码块操作"
      style={{ left: state.left, top: state.top }}
    >
      {editor.isEditable ? (
        <select
          aria-label="代码语言"
          title="代码语言"
          value={state.language}
          onMouseDown={(event) => event.stopPropagation()}
          onChange={(event) => {
            const node = editor.state.doc.nodeAt(state.from);
            if (!node || node.type.name !== "codeBlock") return;
            const language = normalizeCodeBlockLanguage(event.currentTarget.value);
            if (language === "mermaid") {
              const diagram = editor.schema.nodes.mermaidBlock.create({
                markdown: `\`\`\`mermaid\n${node.textContent}\n\`\`\``
              });
              const transaction = editor.state.tr.replaceWith(state.from, state.from + node.nodeSize, diagram);
              transaction.setSelection(NodeSelection.create(transaction.doc, state.from));
              editor.view.dispatch(transaction.scrollIntoView());
              editor.view.focus();
              return;
            }
            const transaction = editor.state.tr.setNodeMarkup(state.from, undefined, {
              ...node.attrs,
              language: language || null
            });
            editor.view.dispatch(transaction);
            editor.view.focus();
          }}
        >
          {options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      ) : null}
      <button
        type="button"
        className={copied ? "is-copied" : undefined}
        aria-label={copied ? "已复制" : "复制代码"}
        title={copied ? "已复制" : "复制代码"}
        onMouseDown={(event) => event.preventDefault()}
        onClick={async () => {
          const node = editor.state.doc.nodeAt(state.from);
          if (!node || node.type.name !== "codeBlock") return;
          await copyText(node.textContent);
          window.clearTimeout(copiedTimer.current);
          setCopiedFrom(state.from);
          copiedTimer.current = window.setTimeout(() => setCopiedFrom(undefined), 1600);
        }}
      >
        {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      </button>
    </div>
  );
}
