import { Extension, type Editor } from "@tiptap/core";
import { Fragment, type Mark, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { Lexer, type Token } from "marked";

export type MarkdownSyntaxKind = "heading" | "blockquote" | "list" | "bold" | "italic" | "strike" | "code" | "link";

export type MarkdownSyntaxSource = {
  id: string;
  kind: MarkdownSyntaxKind;
  markdown: string;
  from: number;
  to: number;
  display: "inline" | "block";
  decorateType: "inline" | "node";
  decorateFrom: number;
  decorateTo: number;
  widgetAt: number;
  listItemIndex?: number;
};

type MarkdownSyntaxEditorOptions = {
  onSubmit: (source: MarkdownSyntaxSource, markdown: string) => boolean | void;
  onCancel: (source: MarkdownSyntaxSource) => void;
};

type InlineSyntaxToken = {
  text: string;
  classes: string[];
};

const markdownSyntaxEditorKey = new PluginKey<MarkdownSyntaxSource | null>("noliaMarkdownSyntaxEditor");

export const MarkdownSyntaxEditor = Extension.create<MarkdownSyntaxEditorOptions>({
  name: "markdownSyntaxEditor",

  addOptions() {
    return {
      onSubmit: () => undefined,
      onCancel: () => undefined
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin<MarkdownSyntaxSource | null>({
        key: markdownSyntaxEditorKey,
        state: {
          init: () => null,
          apply(transaction, current) {
            const next = transaction.getMeta(markdownSyntaxEditorKey) as MarkdownSyntaxSource | null | undefined;
            if (next !== undefined) return next;
            if (!transaction.docChanged || !current) return current;
            const mapped = {
              ...current,
              from: transaction.mapping.map(current.from, 1),
              to: transaction.mapping.map(current.to, -1),
              decorateFrom: transaction.mapping.map(current.decorateFrom, 1),
              decorateTo: transaction.mapping.map(current.decorateTo, -1),
              widgetAt: transaction.mapping.map(current.widgetAt, 1)
            };
            return mapped.to > mapped.from ? mapped : null;
          }
        },
        props: {
          decorations(state) {
            const source = markdownSyntaxEditorKey.getState(state);
            if (!source) return DecorationSet.empty;
            const hiddenClass = source.decorateType === "node"
              ? `is-markdown-syntax-hidden-node is-markdown-syntax-${source.kind}`
              : "is-markdown-syntax-hidden-inline";
            const decorations = source.decorateFrom < source.decorateTo
              ? [source.decorateType === "node"
                  ? Decoration.node(source.decorateFrom, source.decorateTo, { class: hiddenClass })
                  : Decoration.inline(source.decorateFrom, source.decorateTo, { class: hiddenClass })]
              : [];
            decorations.push(
              Decoration.widget(source.widgetAt, () => createSourceWidget(source, options), {
                key: `${source.id}:widget`,
                side: -1,
                ignoreSelection: true,
                stopEvent: (event) => event.target instanceof HTMLElement
                  && event.target.closest(".markdown-inline-session") !== null
              })
            );
            return DecorationSet.create(state.doc, decorations);
          }
        }
      })
    ];
  }
});

function createSourceWidget(source: MarkdownSyntaxSource, options: MarkdownSyntaxEditorOptions): HTMLElement {
  const wrapper = document.createElement("span");
  wrapper.className = `markdown-inline-session is-${source.display} is-${source.kind}`;
  wrapper.contentEditable = "false";
  wrapper.dataset.sourceId = source.id;

  const editor = document.createElement("span");
  editor.className = "markdown-inline-editor";
  editor.contentEditable = "true";
  editor.spellcheck = false;
  editor.setAttribute("role", "textbox");
  editor.setAttribute("aria-label", sourceLabel(source.kind));
  editor.setAttribute("aria-multiline", "false");
  editor.setAttribute("autocapitalize", "off");
  editor.setAttribute("autocomplete", "off");
  editor.dataset.sourceId = source.id;
  renderInlineSyntax(editor, source.markdown, source.kind);

  let completed = false;
  let completing = false;
  let composing = false;
  const complete = (action: "submit" | "cancel") => {
    if (completed || completing) return;
    if (action === "cancel") {
      completed = true;
      options.onCancel(source);
      return;
    }
    completing = true;
    const accepted = options.onSubmit(source, editor.textContent ?? "") !== false;
    completing = false;
    if (accepted) {
      completed = true;
      return;
    }
    wrapper.classList.add("has-source-error");
    editor.setAttribute("aria-invalid", "true");
    requestAnimationFrame(() => {
      if (!completed && editor.isConnected) editor.focus({ preventScroll: true });
    });
  };

  editor.addEventListener("blur", () => complete("submit"));
  editor.addEventListener("compositionstart", () => {
    composing = true;
  });
  editor.addEventListener("compositionend", () => {
    composing = false;
    refreshInlineSyntax(editor, source.kind);
  });
  editor.addEventListener("input", (event) => {
    event.stopPropagation();
    wrapper.classList.remove("has-source-error");
    editor.removeAttribute("aria-invalid");
    if (!composing) refreshInlineSyntax(editor, source.kind);
  });
  editor.addEventListener("paste", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const text = event.clipboardData?.getData("text/plain").replace(/[\r\n]+/g, " ") ?? "";
    insertPlainText(editor, text);
    wrapper.classList.remove("has-source-error");
    editor.removeAttribute("aria-invalid");
    refreshInlineSyntax(editor, source.kind);
  });
  editor.addEventListener("beforeinput", (event) => {
    if (!["insertParagraph", "insertLineBreak"].includes(event.inputType)) return;
    event.preventDefault();
    complete("submit");
  });
  editor.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.isComposing || composing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      complete("cancel");
    } else if (event.key === "Enter") {
      event.preventDefault();
      complete("submit");
    }
  });
  for (const eventName of ["mousedown", "mouseup", "click", "dblclick", "touchstart"]) {
    editor.addEventListener(eventName, (event) => event.stopPropagation());
  }
  wrapper.append(editor);
  return wrapper;
}

function refreshInlineSyntax(editor: HTMLElement, kind: MarkdownSyntaxKind): void {
  const selection = selectionOffsets(editor);
  const markdown = editor.textContent ?? "";
  renderInlineSyntax(editor, markdown, kind);
  if (selection) restoreSelection(editor, selection.anchor, selection.focus);
}

function renderInlineSyntax(editor: HTMLElement, markdown: string, kind: MarkdownSyntaxKind): void {
  const fragment = editor.ownerDocument.createDocumentFragment();
  for (const token of inlineSyntaxTokens(markdown, kind)) {
    const span = editor.ownerDocument.createElement("span");
    span.className = ["markdown-inline-token", ...token.classes].join(" ");
    span.textContent = token.text;
    fragment.append(span);
  }
  editor.replaceChildren(fragment);
}

function inlineSyntaxTokens(markdown: string, kind: MarkdownSyntaxKind): InlineSyntaxToken[] {
  const output: InlineSyntaxToken[] = [];
  const prefix = blockSyntaxPrefix(markdown, kind);
  if (prefix) appendToken(output, prefix, ["is-delimiter"]);
  appendInlineTokens(output, markdown.slice(prefix.length));
  return output;
}

function blockSyntaxPrefix(markdown: string, kind: MarkdownSyntaxKind): string {
  if (kind === "heading") return markdown.match(/^(#{1,6})[ \t]+/)?.[0] ?? "";
  if (kind === "blockquote") return markdown.match(/^(?:[ \t]*>[ \t]?)+/)?.[0] ?? "";
  if (kind === "list") {
    return markdown.match(/^[ \t]*(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/)?.[0] ?? "";
  }
  return "";
}

function appendInlineTokens(output: InlineSyntaxToken[], markdown: string, classes: string[] = []): void {
  let tokens: Token[];
  try {
    tokens = Lexer.lexInline(markdown);
  } catch {
    appendToken(output, markdown, classes);
    return;
  }
  for (const token of tokens) appendMarkedToken(output, token, classes);
}

function appendMarkedToken(output: InlineSyntaxToken[], token: Token, classes: string[]): void {
  const raw = token.raw ?? "";
  if (token.type === "strong" && raw.length >= 4) {
    const marker = raw.startsWith("__") ? "__" : "**";
    appendWrappedToken(output, raw, marker, [...classes, "is-bold"]);
    return;
  }
  if (token.type === "em" && raw.length >= 2) {
    const marker = raw[0] ?? "*";
    appendWrappedToken(output, raw, marker, [...classes, "is-italic"]);
    return;
  }
  if (token.type === "del" && raw.length >= 4) {
    appendWrappedToken(output, raw, "~~", [...classes, "is-strike"]);
    return;
  }
  if (token.type === "codespan") {
    const marker = raw.match(/^`+/)?.[0] ?? "`";
    if (raw.endsWith(marker) && raw.length >= marker.length * 2) {
      appendToken(output, marker, ["is-delimiter", "is-code-delimiter"]);
      appendToken(output, raw.slice(marker.length, -marker.length), [...classes, "is-code"]);
      appendToken(output, marker, ["is-delimiter", "is-code-delimiter"]);
      return;
    }
  }
  if (token.type === "link") {
    const link = splitInlineLink(raw);
    if (link) {
      appendToken(output, "[", ["is-delimiter"]);
      appendInlineTokens(output, link.label, [...classes, "is-link-label"]);
      appendToken(output, "](", ["is-delimiter"]);
      appendToken(output, link.destination, ["is-link-destination"]);
      appendToken(output, ")", ["is-delimiter"]);
      return;
    }
  }
  if (token.type === "escape" && raw.startsWith("\\")) {
    appendToken(output, "\\", ["is-delimiter"]);
    appendToken(output, raw.slice(1), classes);
    return;
  }
  appendToken(output, raw, classes);
}

function appendWrappedToken(
  output: InlineSyntaxToken[],
  raw: string,
  marker: string,
  contentClasses: string[]
): void {
  if (!raw.startsWith(marker) || !raw.endsWith(marker) || raw.length < marker.length * 2) {
    appendToken(output, raw, contentClasses);
    return;
  }
  appendToken(output, marker, ["is-delimiter"]);
  appendInlineTokens(output, raw.slice(marker.length, -marker.length), contentClasses);
  appendToken(output, marker, ["is-delimiter"]);
}

function splitInlineLink(raw: string): { label: string; destination: string } | undefined {
  if (!raw.startsWith("[") || !raw.endsWith(")")) return undefined;
  let nestedBrackets = 0;
  for (let index = 1; index < raw.length - 2; index += 1) {
    const character = raw[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "[") {
      nestedBrackets += 1;
      continue;
    }
    if (character !== "]") continue;
    if (nestedBrackets > 0) {
      nestedBrackets -= 1;
      continue;
    }
    if (raw[index + 1] !== "(") continue;
    return {
      label: raw.slice(1, index),
      destination: raw.slice(index + 2, -1)
    };
  }
  return undefined;
}

function appendToken(output: InlineSyntaxToken[], text: string, classes: string[]): void {
  if (!text) return;
  const previous = output.at(-1);
  if (previous && !classes.includes("is-delimiter") && previous.classes.join(" ") === classes.join(" ")) {
    previous.text += text;
    return;
  }
  output.push({ text, classes });
}

function selectionOffsets(root: HTMLElement): { anchor: number; focus: number } | undefined {
  const selection = root.ownerDocument.getSelection();
  if (!selection?.anchorNode || !selection.focusNode) return undefined;
  if (!root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return undefined;
  return {
    anchor: textOffset(root, selection.anchorNode, selection.anchorOffset),
    focus: textOffset(root, selection.focusNode, selection.focusOffset)
  };
}

function textOffset(root: HTMLElement, node: Node, offset: number): number {
  const range = root.ownerDocument.createRange();
  range.selectNodeContents(root);
  range.setEnd(node, offset);
  return range.toString().length;
}

function restoreSelection(root: HTMLElement, anchor: number, focus: number): void {
  const selection = root.ownerDocument.getSelection();
  if (!selection) return;
  const anchorPoint = textPointAtOffset(root, anchor);
  const focusPoint = textPointAtOffset(root, focus);
  if (typeof selection.setBaseAndExtent === "function") {
    selection.setBaseAndExtent(anchorPoint.node, anchorPoint.offset, focusPoint.node, focusPoint.offset);
    return;
  }
  const range = root.ownerDocument.createRange();
  range.setStart(anchorPoint.node, anchorPoint.offset);
  range.setEnd(focusPoint.node, focusPoint.offset);
  selection.removeAllRanges();
  selection.addRange(range);
}

function textPointAtOffset(root: HTMLElement, offset: number): { node: Node; offset: number } {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, offset);
  let node = walker.nextNode();
  while (node) {
    const length = node.textContent?.length ?? 0;
    if (remaining <= length) return { node, offset: remaining };
    remaining -= length;
    node = walker.nextNode();
  }
  return { node: root, offset: root.childNodes.length };
}

function insertPlainText(root: HTMLElement, text: string): void {
  const selection = root.ownerDocument.getSelection();
  if (!selection?.rangeCount || !selection.anchorNode || !root.contains(selection.anchorNode)) {
    root.append(root.ownerDocument.createTextNode(text));
    return;
  }
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const node = root.ownerDocument.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function sourceLabel(kind: MarkdownSyntaxKind): string {
  if (kind === "heading") return "标题 Markdown 源码";
  if (kind === "blockquote") return "引用 Markdown 源码";
  if (kind === "list") return "列表项 Markdown 源码";
  if (kind === "bold") return "粗体 Markdown 源码";
  if (kind === "italic") return "斜体 Markdown 源码";
  if (kind === "strike") return "删除线 Markdown 源码";
  if (kind === "link") return "链接 Markdown 源码";
  return "行内代码 Markdown 源码";
}

export function clearMarkdownSyntaxEditor(view: EditorView): void {
  if (markdownSyntaxEditorKey.getState(view.state)) {
    view.dispatch(view.state.tr.setMeta(markdownSyntaxEditorKey, null));
  }
}

export function isMarkdownSyntaxEditorActive(view: EditorView): boolean {
  return Boolean(markdownSyntaxEditorKey.getState(view.state));
}

export function openMarkdownSyntaxEditorAtPosition(
  editor: Editor,
  position: number,
  target?: Element,
  event?: MouseEvent
): boolean {
  if (!editor.isEditable || target?.closest(".markdown-inline-session")) return false;
  const source = syntaxSourceAtPosition(editor, position, target, event);
  if (!source) return false;
  const selectionPosition = ["heading", "blockquote", "list"].includes(source.kind)
    ? Math.min(source.widgetAt, editor.state.doc.content.size)
    : source.from;
  const transaction = editor.state.tr
    .setMeta(markdownSyntaxEditorKey, source)
    .setSelection(TextSelection.create(editor.state.doc, selectionPosition));
  editor.view.dispatch(transaction);
  focusInlineSyntaxEditor(editor.view, source.id);
  return true;
}

export function openLinkMarkdownEditorAtPosition(
  editor: Editor,
  position: number,
  anchor: Element
): boolean {
  if (!editor.isEditable || !editor.markdown || anchor.closest(".markdown-inline-session")) return false;
  const range = linkRangeAtPosition(editor.state, position) ?? linkRangeFromAnchor(editor, anchor);
  if (!range) return false;
  const href = linkHrefAtRange(editor.state, range) || anchor.getAttribute("href") || "";
  const label = linkLabelMarkdown(editor, range);
  const source: MarkdownSyntaxSource = {
    id: `syntax-link-${range.from}-${range.to}`,
    kind: "link",
    markdown: linkMarkdown(label, href),
    from: range.from,
    to: range.to,
    display: "inline",
    decorateType: "inline",
    decorateFrom: range.from,
    decorateTo: range.to,
    widgetAt: range.from
  };
  const transaction = editor.state.tr
    .setMeta(markdownSyntaxEditorKey, source)
    .setSelection(TextSelection.create(editor.state.doc, range.from, range.to));
  editor.view.dispatch(transaction);
  focusInlineSyntaxEditor(editor.view, source.id);
  return true;
}

function focusInlineSyntaxEditor(view: EditorView, sourceId: string): void {
  const focus = () => {
    const editor = view.dom.querySelector<HTMLElement>(`.markdown-inline-editor[data-source-id="${cssEscape(sourceId)}"]`);
    if (!editor) return false;
    editor.focus({ preventScroll: true });
    const length = editor.textContent?.length ?? 0;
    restoreSelection(editor, length, length);
    return true;
  };
  if (focus()) return;
  requestAnimationFrame(() => {
    if (!focus()) window.setTimeout(focus, 0);
  });
}

function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/["\\]/g, "\\$&");
}

function syntaxSourceAtPosition(
  editor: Editor,
  position: number,
  target?: Element,
  event?: MouseEvent
): MarkdownSyntaxSource | undefined {
  const markdownManager = editor.markdown;
  if (!markdownManager) return undefined;
  const inlineKind = target ? inlineKindFromTarget(target, event) : undefined;
  if (inlineKind) {
    const inlinePositions = [position];
    const domPosition = target ? inlinePositionFromTarget(editor.view, target, inlineKind) : undefined;
    if (domPosition !== undefined) inlinePositions.unshift(domPosition);
    for (const inlinePosition of inlinePositions) {
      const range = inlineRangeAtPosition(editor.state, inlinePosition, inlineKind);
      if (!range) continue;
      const paragraph = editor.schema.nodes.paragraph.create(null, editor.state.doc.slice(range.from, range.to).content);
      const markdown = markdownManager.serialize({ type: "doc", content: [paragraph.toJSON()] }).trim();
      return {
        id: `syntax-${inlineKind}-${range.from}-${range.to}`,
        kind: inlineKind,
        markdown,
        from: range.from,
        to: range.to,
        display: "inline",
        decorateType: "inline",
        decorateFrom: range.from,
        decorateTo: range.to,
        widgetAt: range.from
      };
    }
  }

  const block = target?.closest("h1, h2, h3, h4, h5, h6, blockquote, li");
  if (!block) return undefined;
  let blockSource: MarkdownSyntaxSource | undefined;
  editor.state.doc.descendants((node, nodePosition) => {
    if (blockSource || !["heading", "blockquote", "listItem", "taskItem"].includes(node.type.name)) {
      return blockSource ? false : undefined;
    }
    if (editor.view.nodeDOM(nodePosition) !== block) return undefined;
    blockSource = blockSourceAtResolved(editor, editor.state.doc.resolve(Math.min(nodePosition + 1, editor.state.doc.content.size)));
    return false;
  });
  if (blockSource) return blockSource;
  const positions = [position];
  try {
    const domPosition = editor.view.posAtDOM(block, 0, 1);
    positions.unshift(domPosition, domPosition + 1);
  } catch {
    // The click position remains a safe fallback when the DOM is being remounted.
  }
  for (const candidate of positions) {
    const resolved = editor.state.doc.resolve(Math.max(0, Math.min(candidate, editor.state.doc.content.size)));
    const source = blockSourceAtResolved(editor, resolved);
    if (source) return source;
  }
  return undefined;
}

function blockSourceAtResolved(editor: Editor, resolved: ReturnType<EditorState["doc"]["resolve"]>): MarkdownSyntaxSource | undefined {
  const markdownManager = editor.markdown;
  if (!markdownManager) return undefined;
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    const node = resolved.node(depth);
    if (node.type.name === "heading") {
      return headingSourceForNode(markdownManager, node, resolved.before(depth), resolved.after(depth));
    }
    if (node.type.name === "blockquote") {
      const from = resolved.before(depth);
      const to = resolved.after(depth);
      return {
        id: `syntax-blockquote-${from}-${to}`,
        kind: "blockquote",
        markdown: markdownManager.serialize({ type: "doc", content: [node.toJSON()] }).trimEnd(),
        from,
        to,
        display: "block",
        decorateType: "node",
        decorateFrom: from,
        decorateTo: to,
        widgetAt: from + 1
      };
    }
    if (node.type.name === "listItem" || node.type.name === "taskItem") {
      const listDepth = depth - 1;
      if (listDepth <= 0) continue;
      const listNode = resolved.node(listDepth);
      if (!["bulletList", "orderedList", "taskList"].includes(listNode.type.name)) continue;
      const itemIndex = resolved.index(listDepth);
      const listFrom = resolved.before(listDepth);
      const listTo = resolved.after(listDepth);
      const itemFrom = resolved.before(depth);
      const itemTo = resolved.after(depth);
      const attrs = listNode.type.name === "orderedList"
        ? { ...listNode.attrs, start: (Number(listNode.attrs.start) || 1) + itemIndex }
        : listNode.attrs;
      const singleItemList = listNode.type.create(attrs, [node]);
      return {
        id: `syntax-list-${itemFrom}-${itemTo}`,
        kind: "list",
        markdown: markdownManager.serialize({ type: "doc", content: [singleItemList.toJSON()] }).trimEnd(),
        from: listFrom,
        to: listTo,
        display: "block",
        decorateType: "node",
        decorateFrom: itemFrom,
        decorateTo: itemTo,
        widgetAt: itemFrom + 1,
        listItemIndex: itemIndex
      };
    }
  }
  return undefined;
}

function headingSourceForNode(
  markdownManager: NonNullable<Editor["markdown"]>,
  node: ProseMirrorNode,
  from: number,
  to: number
): MarkdownSyntaxSource {
  const markdown = markdownManager.serialize({ type: "doc", content: [node.toJSON()] }).trimEnd();
  return {
    id: `syntax-heading-${from}-${to}`,
    kind: "heading",
    markdown,
    from,
    to,
    display: "block",
    decorateType: "inline",
    decorateFrom: from + 1,
    decorateTo: to - 1,
    widgetAt: from + 1
  };
}

type InlineKind = Exclude<MarkdownSyntaxKind, "heading" | "blockquote" | "list" | "link">;

function inlinePositionFromTarget(view: EditorView, target: Element, kind: InlineKind): number | undefined {
  const selectors: Record<InlineKind, string> = {
    bold: "strong, b",
    italic: "em, i",
    strike: "s, del",
    code: "code:not(pre code)"
  };
  const element = target.closest(selectors[kind]);
  if (!element) return undefined;
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const text = walker.nextNode();
  try {
    return text ? view.posAtDOM(text, Math.min(1, text.textContent?.length ?? 0), -1) : view.posAtDOM(element, 0, 1);
  } catch {
    return undefined;
  }
}

function inlineKindFromTarget(target: Element, event?: MouseEvent): InlineKind | undefined {
  const hitTarget = event && typeof target.ownerDocument.elementFromPoint === "function"
    ? target.ownerDocument.elementFromPoint(event.clientX, event.clientY)
    : undefined;
  for (const candidate of [hitTarget, target]) {
    if (!(candidate instanceof Element)) continue;
    if (candidate.closest("code:not(pre code)")) return "code";
    if (candidate.closest("strong, b")) return "bold";
    if (candidate.closest("em, i")) return "italic";
    if (candidate.closest("s, del")) return "strike";
  }
  return undefined;
}

function inlineRangeAtPosition(
  state: EditorState,
  position: number,
  kind: InlineKind
): { from: number; to: number } | undefined {
  const markType = state.schema.marks[kind];
  if (!markType) return undefined;
  for (const candidate of [position, position - 1, position + 1]) {
    if (candidate < 0 || candidate > state.doc.content.size) continue;
    const resolved = state.doc.resolve(candidate);
    const mark = [...(resolved.nodeAfter?.marks ?? []), ...(resolved.nodeBefore?.marks ?? [])]
      .find((item) => item.type === markType);
    if (!mark) continue;
    const start = resolved.start();
    const end = resolved.end();
    let from = candidate;
    let to = candidate;
    while (from > start) {
      const before = state.doc.resolve(from).nodeBefore;
      if (!before?.marks.some((item) => item.eq(mark))) break;
      from -= before.nodeSize;
    }
    while (to < end) {
      const after = state.doc.resolve(to).nodeAfter;
      if (!after?.marks.some((item) => item.eq(mark))) break;
      to += after.nodeSize;
    }
    if (from < to) return { from, to };
  }
  return undefined;
}

export function applyMarkdownSyntaxSource(
  editor: Editor,
  source: MarkdownSyntaxSource,
  markdown: string
): boolean {
  if (!editor.markdown) return false;
  if (markdown === source.markdown) {
    editor.view.focus();
    return true;
  }
  if (source.kind === "heading") {
    applyHeadingSource(editor, source, markdown);
    return true;
  }
  if (source.kind === "blockquote") {
    applyBlockquoteSource(editor, source, markdown);
    return true;
  }
  if (source.kind === "list") {
    applyListSource(editor, source, markdown);
    return true;
  }
  applyInlineSource(editor, source, markdown);
  return true;
}

export function applyLinkMarkdownSource(
  editor: Editor,
  source: MarkdownSyntaxSource,
  markdown: string
): boolean {
  if (source.kind !== "link") return false;
  if (markdown === source.markdown) {
    editor.view.focus();
    return true;
  }
  const parsed = parseLinkMarkdown(markdown);
  const linkType = editor.schema.marks.link;
  if (!parsed || !linkType) return false;
  const from = Math.min(source.from, editor.state.doc.content.size);
  const to = Math.min(source.to, editor.state.doc.content.size);
  const content = markInlineFragment(
    inlineFragmentFromMarkdown(editor, parsed.text),
    linkType.create({ href: parsed.href })
  );
  const transaction = editor.state.tr.replaceWith(from, to, content);
  const caret = Math.min(from + content.size, transaction.doc.content.size);
  transaction.setSelection(TextSelection.near(transaction.doc.resolve(caret)));
  editor.view.dispatch(transaction.scrollIntoView());
  editor.view.focus();
  return true;
}

function linkRangeAtPosition(
  state: EditorState,
  position: number
): { from: number; to: number } | undefined {
  const linkType = state.schema.marks.link;
  if (!linkType) return undefined;
  for (const candidate of [position, position - 1, position + 1]) {
    if (candidate < 0 || candidate > state.doc.content.size) continue;
    const resolved = state.doc.resolve(candidate);
    const child = resolved.parent.childAfter(resolved.parentOffset).node
      ?? resolved.parent.childBefore(resolved.parentOffset).node;
    const linkMark = child?.marks.find((mark) => mark.type === linkType);
    if (!linkMark) continue;
    let from = candidate;
    let to = candidate;
    while (from > resolved.start()) {
      const before = state.doc.resolve(from).nodeBefore;
      if (!before?.marks.some((mark) => mark.eq(linkMark))) break;
      from -= before.nodeSize;
    }
    while (to < resolved.end()) {
      const after = state.doc.resolve(to).nodeAfter;
      if (!after?.marks.some((mark) => mark.eq(linkMark))) break;
      to += after.nodeSize;
    }
    if (from < to) return { from, to };
  }
  return undefined;
}

function linkRangeFromAnchor(editor: Editor, anchor: Element): { from: number; to: number } | undefined {
  const walker = anchor.ownerDocument.createTreeWalker(anchor, NodeFilter.SHOW_TEXT);
  const text = walker.nextNode();
  try {
    const position = text
      ? editor.view.posAtDOM(text, Math.min(text.textContent?.length ?? 0, 1), -1)
      : editor.view.posAtDOM(anchor, 0, 1);
    return linkRangeAtPosition(editor.state, position);
  } catch {
    return undefined;
  }
}

function linkHrefAtRange(state: EditorState, range: { from: number; to: number }): string | undefined {
  const linkType = state.schema.marks.link;
  let href: string | undefined;
  state.doc.nodesBetween(range.from, range.to, (node) => {
    const mark = node.marks.find((item) => item.type === linkType);
    if (!mark?.attrs.href) return undefined;
    href = String(mark.attrs.href);
    return false;
  });
  return href;
}

function linkLabelMarkdown(editor: Editor, range: { from: number; to: number }): string {
  const fragment = removeMarkFromFragment(
    editor.state.doc.slice(range.from, range.to).content,
    "link"
  );
  const paragraph = editor.schema.nodes.paragraph.create(null, fragment);
  return normalizeEditableInlineMarkdown(
    editor.markdown?.serialize({ type: "doc", content: [paragraph.toJSON()] }).trim() ?? ""
  );
}

function removeMarkFromFragment(fragment: Fragment, markName: string): Fragment {
  const nodes: ProseMirrorNode[] = [];
  fragment.forEach((node) => {
    const marks = node.marks.filter((mark) => mark.type.name !== markName);
    const content = node.content.size ? removeMarkFromFragment(node.content, markName) : node.content;
    nodes.push(node.isText ? node.mark(marks) : node.copy(content).mark(marks));
  });
  return Fragment.fromArray(nodes);
}

function markInlineFragment(fragment: Fragment, mark: Mark): Fragment {
  const nodes: ProseMirrorNode[] = [];
  fragment.forEach((node) => {
    nodes.push(node.isInline ? node.mark(mark.addToSet(node.marks)) : node);
  });
  return Fragment.fromArray(nodes);
}

function linkMarkdown(text: string, href: string): string {
  const label = normalizeEditableInlineMarkdown(text).replace(/]/g, "\\]");
  const destination = normalizeEditableInlineMarkdown(href).replace(/\)/g, "%29");
  return `[${label}](${destination})`;
}

function parseLinkMarkdown(markdown: string): { text: string; href: string } | undefined {
  const match = markdown.trim().match(/^\[([^\]\n]*(?:\\][^\]\n]*)*)]\(([\s\S]+?)\)$/);
  if (!match) return undefined;
  const text = (match[1] ?? "").replace(/\\]/g, "]");
  let href = (match[2] ?? "").trim();
  const titleMatch = href.match(/\s+("((?:\\"|[^"])*)"|'((?:\\'|[^'])*)'|\(([^()]*)\))\s*$/);
  if (titleMatch && typeof titleMatch.index === "number") href = href.slice(0, titleMatch.index).trim();
  if (href.startsWith("<") && href.endsWith(">")) href = href.slice(1, -1).trim();
  return text && href
    ? { text: normalizeEditableInlineMarkdown(text), href: normalizeEditableInlineMarkdown(href) }
    : undefined;
}

function normalizeEditableInlineMarkdown(markdown: string): string {
  let result = "";
  let start = 0;
  const codeSpanPattern = /(`+)([\s\S]*?)\1/g;
  for (const match of markdown.matchAll(codeSpanPattern)) {
    result += normalizeEscapedUrlPunctuation(markdown.slice(start, match.index));
    result += match[0];
    start = (match.index ?? 0) + match[0].length;
  }
  return result + normalizeEscapedUrlPunctuation(markdown.slice(start));
}

function normalizeEscapedUrlPunctuation(value: string): string {
  return value.replace(/\b[A-Za-z][A-Za-z0-9+.-]{1,31}\\*:[^\s<>()\]]*/g, (url) => url.replace(/\\+([/:])/g, "$1"));
}

function applyHeadingSource(editor: Editor, source: MarkdownSyntaxSource, markdown: string): void {
  const markdownManager = editor.markdown;
  if (!markdownManager) return;
  const parsed = markdownManager.parse(markdown.trim());
  const parsedNodes = parsed.content ?? [];
  let node: ProseMirrorNode;
  if (!markdown.trim()) {
    node = editor.schema.nodes.paragraph.create();
  } else if (parsedNodes.length === 1 && ["heading", "paragraph"].includes(parsedNodes[0].type ?? "")) {
    node = editor.schema.nodeFromJSON(parsedNodes[0]);
  } else {
    node = editor.schema.nodes.paragraph.create(null, editor.schema.text(markdown));
  }
  const from = Math.min(source.from, editor.state.doc.content.size);
  const existing = editor.state.doc.nodeAt(from);
  const to = existing?.type.name === "heading" ? from + existing.nodeSize : Math.min(source.to, editor.state.doc.content.size);
  const transaction = editor.state.tr.replaceWith(from, to, node);
  const caret = Math.min(from + 1 + node.content.size, transaction.doc.content.size);
  transaction.setSelection(TextSelection.near(transaction.doc.resolve(caret)));
  editor.view.dispatch(transaction.scrollIntoView());
  editor.view.focus();
}

function applyBlockquoteSource(editor: Editor, source: MarkdownSyntaxSource, markdown: string): void {
  const markdownManager = editor.markdown;
  if (!markdownManager) return;
  const parsedNodes = markdownManager.parse(markdown.trim()).content ?? [];
  let node: ProseMirrorNode;
  if (!markdown.trim()) {
    node = editor.schema.nodes.paragraph.create();
  } else if (parsedNodes.length === 1 && ["blockquote", "paragraph"].includes(parsedNodes[0].type ?? "")) {
    node = editor.schema.nodeFromJSON(parsedNodes[0]);
  } else {
    node = editor.schema.nodes.paragraph.create(null, inlineFragmentFromMarkdown(editor, markdown.trim()));
  }
  replaceBlockSource(editor, source, node, "blockquote");
}

type ParsedListSource =
  | { kind: "paragraph"; markdown: string }
  | { kind: "bullet"; markdown: string }
  | { kind: "ordered"; start: number; markdown: string }
  | { kind: "task"; checked: boolean; markdown: string };

function parseListSource(markdown: string): ParsedListSource {
  const value = markdown.trim();
  const task = value.match(/^[-+*]\s+\[([ xX])]\s*([\s\S]*)$/);
  if (task) return { kind: "task", checked: task[1].toLowerCase() === "x", markdown: task[2] ?? "" };
  const bullet = value.match(/^[-+*]\s*([\s\S]*)$/);
  if (bullet) return { kind: "bullet", markdown: bullet[1] ?? "" };
  const ordered = value.match(/^(\d+)[.)]\s*([\s\S]*)$/);
  if (ordered) return { kind: "ordered", start: Number(ordered[1]) || 1, markdown: ordered[2] ?? "" };
  return { kind: "paragraph", markdown: value };
}

function applyListSource(editor: Editor, source: MarkdownSyntaxSource, markdown: string): void {
  const from = Math.min(source.from, editor.state.doc.content.size);
  const listNode = editor.state.doc.nodeAt(from);
  if (!listNode || !["bulletList", "orderedList", "taskList"].includes(listNode.type.name)) return;
  const itemIndex = Math.max(0, Math.min(source.listItemIndex ?? 0, listNode.childCount - 1));
  const parsed = parseListSource(markdown);
  const replacement = parsed.kind === "paragraph"
    ? listReplacementWithParagraph(editor, listNode, itemIndex, parsed.markdown)
    : [convertedListNode(editor, listNode, itemIndex, parsed)];
  const transaction = editor.state.tr.replaceWith(from, from + listNode.nodeSize, Fragment.fromArray(replacement));
  transaction.setSelection(TextSelection.near(transaction.doc.resolve(Math.min(from + 1, transaction.doc.content.size))));
  editor.view.dispatch(transaction.scrollIntoView());
  editor.view.focus();
}

function listReplacementWithParagraph(
  editor: Editor,
  listNode: ProseMirrorNode,
  itemIndex: number,
  markdown: string
): ProseMirrorNode[] {
  const nodes: ProseMirrorNode[] = [];
  const before = childNodesBetween(listNode, 0, itemIndex);
  const after = childNodesBetween(listNode, itemIndex + 1, listNode.childCount);
  if (before.length) nodes.push(listNode.type.create(listNode.attrs, before));
  nodes.push(editor.schema.nodes.paragraph.create(null, inlineFragmentFromMarkdown(editor, markdown)));
  if (after.length) nodes.push(listNode.type.create(listAttrsAfterSplit(listNode, itemIndex), after));
  return nodes;
}

function convertedListNode(
  editor: Editor,
  listNode: ProseMirrorNode,
  itemIndex: number,
  parsed: Exclude<ParsedListSource, { kind: "paragraph" }>
): ProseMirrorNode {
  const listType = editor.schema.nodes[parsed.kind === "ordered" ? "orderedList" : parsed.kind === "task" ? "taskList" : "bulletList"];
  const itemType = editor.schema.nodes[parsed.kind === "task" ? "taskItem" : "listItem"];
  const items: ProseMirrorNode[] = [];
  for (let index = 0; index < listNode.childCount; index += 1) {
    const item = listNode.child(index);
    const contentMarkdown = index === itemIndex ? parsed.markdown : markdownForListItemContent(editor, item);
    const checked = parsed.kind === "task" && (index === itemIndex ? parsed.checked : Boolean(item.attrs.checked));
    items.push(convertedListItem(editor, item, itemType, contentMarkdown, checked));
  }
  const attrs = parsed.kind === "ordered" ? { ...listNode.attrs, start: parsed.start } : null;
  return listType.create(attrs, items);
}

function convertedListItem(
  editor: Editor,
  item: ProseMirrorNode,
  itemType: ProseMirrorNode["type"],
  markdown: string,
  checked: boolean
): ProseMirrorNode {
  const attrs = itemType.name === "taskItem" ? { checked } : null;
  const content: ProseMirrorNode[] = [];
  const inline = inlineFragmentFromMarkdown(editor, markdown);
  let updated = false;
  item.forEach((child) => {
    if (!updated && child.isTextblock) {
      content.push(child.type.create(child.attrs, inline.size ? inline : undefined));
      updated = true;
    } else {
      content.push(child);
    }
  });
  if (!updated) content.unshift(editor.schema.nodes.paragraph.create(null, inline.size ? inline : undefined));
  return itemType.create(attrs, content);
}

function markdownForListItemContent(editor: Editor, item: ProseMirrorNode): string {
  const paragraph = Array.from({ length: item.childCount }, (_, index) => item.child(index)).find((child) => child.isTextblock);
  if (!paragraph || !editor.markdown) return item.textContent;
  return editor.markdown.serialize({ type: "doc", content: [paragraph.toJSON()] }).trim();
}

function childNodesBetween(node: ProseMirrorNode, from: number, to: number): ProseMirrorNode[] {
  const children: ProseMirrorNode[] = [];
  for (let index = from; index < to; index += 1) children.push(node.child(index));
  return children;
}

function listAttrsAfterSplit(listNode: ProseMirrorNode, itemIndex: number): Record<string, unknown> | null {
  if (listNode.type.name !== "orderedList") return listNode.attrs;
  return { ...listNode.attrs, start: (Number(listNode.attrs.start) || 1) + itemIndex + 1 };
}

function replaceBlockSource(editor: Editor, source: MarkdownSyntaxSource, node: ProseMirrorNode, expectedType: string): void {
  const from = Math.min(source.from, editor.state.doc.content.size);
  const existing = editor.state.doc.nodeAt(from);
  const to = existing?.type.name === expectedType ? from + existing.nodeSize : Math.min(source.to, editor.state.doc.content.size);
  const transaction = editor.state.tr.replaceWith(from, to, node);
  transaction.setSelection(TextSelection.near(transaction.doc.resolve(Math.min(from + 1 + node.content.size, transaction.doc.content.size))));
  editor.view.dispatch(transaction.scrollIntoView());
  editor.view.focus();
}

function applyInlineSource(editor: Editor, source: MarkdownSyntaxSource, markdown: string): void {
  const from = Math.min(source.from, editor.state.doc.content.size);
  const to = Math.min(source.to, editor.state.doc.content.size);
  const content = markdown ? inlineFragmentFromMarkdown(editor, markdown) : Fragment.empty;
  const transaction = editor.state.tr.replaceWith(from, to, content);
  const caret = Math.min(from + content.size, transaction.doc.content.size);
  transaction.setSelection(TextSelection.near(transaction.doc.resolve(caret)));
  editor.view.dispatch(transaction.scrollIntoView());
  editor.view.focus();
}

function inlineFragmentFromMarkdown(editor: Editor, markdown: string): Fragment {
  const markdownManager = editor.markdown;
  if (!markdownManager) return Fragment.empty;
  const parsed = markdownManager.parse(markdown);
  const nodes = (parsed.content ?? []).map((node) => editor.schema.nodeFromJSON(node));
  const inlineNodes: ProseMirrorNode[] = [];
  for (const node of nodes) {
    if (node.isTextblock) node.content.forEach((child) => inlineNodes.push(child));
    else if (node.isInline) inlineNodes.push(node);
  }
  return Fragment.fromArray(inlineNodes);
}

export const _testing = {
  activeSource: (state: EditorState) => markdownSyntaxEditorKey.getState(state),
  inlineSyntaxTokens,
  inlineRangeAtPosition,
  linkRangeAtPosition,
  parseLinkMarkdown,
  syntaxSourceAtPosition
};
