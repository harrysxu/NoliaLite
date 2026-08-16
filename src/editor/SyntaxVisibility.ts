import { Extension, getMarkRange } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const markSyntax: Record<string, { prefix: string; suffix: string }> = {
  bold: { prefix: "**", suffix: "**" },
  italic: { prefix: "*", suffix: "*" },
  strike: { prefix: "~~", suffix: "~~" },
  code: { prefix: "`", suffix: "`" }
};

const syntaxFocusKey = new PluginKey<boolean>("syntaxVisibilityFocus");

export const SyntaxVisibility = Extension.create<{ enabled: boolean }>({
  name: "syntaxVisibility",

  addOptions() {
    return { enabled: true };
  },

  addProseMirrorPlugins() {
    if (!this.options.enabled) return [];
    return [
      new Plugin({
        key: syntaxFocusKey,
        state: {
          init: () => false,
          apply: (transaction, focused) => transaction.getMeta(syntaxFocusKey) ?? focused
        },
        props: {
          handleDOMEvents: {
            focus: (view) => {
              view.dispatch(view.state.tr.setMeta(syntaxFocusKey, true));
              return false;
            },
            blur: (view) => {
              view.dispatch(view.state.tr.setMeta(syntaxFocusKey, false));
              return false;
            }
          },
          decorations(state) {
            if (!syntaxFocusKey.getState(state) || !state.selection.empty) return DecorationSet.empty;
            const { $from } = state.selection;
            const decorations: Decoration[] = [];

            for (let depth = $from.depth; depth > 0; depth -= 1) {
              const node = $from.node(depth);
              if (node.type.name === "heading") {
                const prefix = `${"#".repeat(Number(node.attrs.level) || 1)} `;
                const from = $from.before(depth);
                decorations.push(Decoration.node(from, from + node.nodeSize, {
                  class: "is-active-block-syntax",
                  "data-markdown-prefix": prefix
                }));
                break;
              }
              if (node.isTextblock && depth > 0 && $from.node(depth - 1).type.name === "blockquote") {
                const from = $from.before(depth);
                decorations.push(Decoration.node(from, from + node.nodeSize, {
                  class: "is-active-block-syntax",
                  "data-markdown-prefix": "> "
                }));
                break;
              }
            }

            for (const mark of $from.marks()) {
              const syntax = markSyntax[mark.type.name];
              if (!syntax) continue;
              const range = getMarkRange($from, mark.type, mark.attrs);
              if (!range || range.from === range.to) continue;
              decorations.push(Decoration.inline(range.from, range.to, {
                class: `is-active-inline-syntax is-${mark.type.name}`,
                "data-markdown-prefix": syntax.prefix,
                "data-markdown-suffix": syntax.suffix
              }));
            }

            return DecorationSet.create(state.doc, decorations);
          }
        }
      })
    ];
  }
});
