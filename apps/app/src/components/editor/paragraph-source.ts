import Paragraph from '@tiptap/extension-paragraph';
import type { Fragment, Node as PMNode } from '@tiptap/pm/model';
import type { MarkdownNodeSpec } from 'tiptap-markdown';
import { decodeMdxSource, encodeMdxSource } from './extensions/mdx-roundtrip';
import type { MarkdownOutput } from './markdown-output';
import { markTightLists } from './tight-lists';

/*
 * A paragraph wrapped across several lines in the source keeps those lines, so a
 * save writes them back as they were. The editor reads a line break inside a
 * paragraph as a space, and its serializer writes every paragraph on one line,
 * so without this every hard-wrapped paragraph (the starter pages, most imported
 * and Git-authored Markdown) was rewritten the first time its page was saved,
 * even when the writer only changed another paragraph.
 *
 * The lines are written back only while the paragraph still says exactly what
 * they say: the serializer's own output for the paragraph must equal the source
 * lines joined the way the reader joins them. Any edit to the paragraph's text,
 * marks or links makes the two differ, and the paragraph saves in the canonical
 * form, as before. Container prefixes (a quote's `>`, a list item's indent) are
 * not part of the kept text: the containers' serializers write them again.
 */

/** The HTML attribute the markdown-it rule leaves on a paragraph's `<p>`. */
const SOURCE_ATTRIBUTE = 'data-md-paragraph-source';
const QUOTE_PREFIXES_ATTRIBUTE = 'data-md-paragraph-quote-prefixes';

const isSpaceOrTab = (character: string | undefined): boolean => character === ' ' || character === '\t';

/**
 * The source lines of a paragraph joined the way markdown-it and the editor read
 * them: each line break, with the next line's leading spaces and one trailing
 * space before it, becomes one space. Null when the paragraph has no line break
 * or one of its breaks is a hard break (two or more trailing spaces, or a
 * backslash), which the editor keeps as its own node.
 */
export function joinedSourceLines(source: string): string | null {
  if (!source.includes('\n')) return null;
  const lines = source.split('\n');
  const last = lines.length - 1;
  const parts: string[] = [];
  for (const [index, line] of lines.entries()) {
    let start = 0;
    let end = line.length;
    if (index > 0) while (start < end && isSpaceOrTab(line[start])) start += 1;
    if (index < last) {
      if (line.endsWith('\\') || line.endsWith('  ')) return null;
      if (line.endsWith(' ') && end > start) end -= 1;
    }
    parts.push(line.slice(start, end));
  }
  return parts.join(' ');
}

interface MarkdownToken {
  type: string;
  tag: string;
  content: string;
  hidden: boolean;
  map: [number, number] | null;
  children: MarkdownToken[] | null;
  attrSet(name: string, value: string): void;
}

interface MarkdownCoreState<T extends MarkdownToken> {
  src: string;
  tokens: T[];
}

const LIST_OPEN = new Set(['bullet_list_open', 'ordered_list_open']);
const LIST_CLOSE = new Set(['bullet_list_close', 'ordered_list_close']);
const TASK_ITEM = /^\[[ xX]\][ \t]/;

/** Count the authored quote markers on each line when a continuation omits some. */
function lazyQuotePrefixes(raw: readonly string[], token: MarkdownToken, content: string, depth: number): number[] | null {
  if (!token.map) return null;
  const [start, end] = token.map;
  const lines = content.split('\n');
  if (lines.length !== end - start) return null;
  const counts: number[] = [];
  for (const [index, line] of lines.entries()) {
    const original = raw[start + index] ?? '';
    const prefix = /^(?:> )*/.exec(original)?.[0] ?? '';
    const count = prefix.length / 2;
    if (count > depth || (index === 0 && count !== depth) || original.slice(prefix.length) !== line) return null;
    counts.push(count);
  }
  return counts.some((count) => count < depth) ? counts : null;
}

/**
 * A markdown-it core rule, run after the block rules, in one forward pass over the
 * tokens. Each paragraph written across several lines gets its inline source (the
 * lines without their containers' prefixes) on its `<p>`.
 *
 * markdown-it hides the paragraphs of a tight list, so their `<p>` is never
 * rendered and nothing could carry the source. Such a paragraph is shown. A list
 * reads as tight in tiptap-markdown when it holds no `<p>` at any depth, so each
 * list that held no shown paragraph before, and now holds one of these, is marked
 * tight (`data-tight`, read before looking for a `<p>`): it still saves without
 * blank lines between its items, and lists around it keep their spacing too.
 */
function annotateParagraphs<T extends MarkdownToken>(state: MarkdownCoreState<T>): void {
  const { tokens } = state;
  /** Open lists, innermost last: whether they hold a paragraph shown in the source,
   *  and one shown here. A list hands both to the list around it when it closes. */
  const lists: Array<{ token: T; shown: boolean; revealed: boolean }> = [];
  let quoteDepth = 0;
  let rawLines: string[] | undefined;
  for (const [index, token] of tokens.entries()) {
    if (token.type === 'blockquote_open') quoteDepth++;
    else if (token.type === 'blockquote_close') quoteDepth--;
    if (LIST_OPEN.has(token.type)) lists.push({ token, shown: false, revealed: false });
    const list = lists[lists.length - 1];
    if (list && LIST_CLOSE.has(token.type)) {
      lists.pop();
      if (list.revealed && !list.shown) list.token.attrSet('data-tight', 'true');
      const parent = lists[lists.length - 1];
      if (parent) {
        parent.shown ||= list.shown;
        parent.revealed ||= list.revealed;
      }
    }
    if (token.type !== 'paragraph_open') continue;
    const inline = tokens[index + 1];
    const close = tokens[index + 2];
    if (inline?.type !== 'inline' || close?.type !== 'paragraph_close') continue;
    // An empty paragraph is a fence's lead (fence-source.ts), which handles its list.
    if (list && !token.hidden && inline.content !== '') list.shown = true;
    let quotePrefixes: number[] | null = null;
    if (quoteDepth > 0 && inline.content.includes('\n')) {
      rawLines ??= state.src.split('\n');
      quotePrefixes = lazyQuotePrefixes(rawLines, token, inline.content, quoteDepth);
    }
    if (joinedSourceLines(inline.content) === null && !quotePrefixes) continue;
    if (token.hidden) {
      // A task item's checkbox is read from the start of its text by a later rule.
      if (!list || TASK_ITEM.test(inline.content)) continue;
      token.hidden = false;
      close.hidden = false;
      list.revealed = true;
    }
    token.attrSet(SOURCE_ATTRIBUTE, encodeMdxSource(inline.content));
    if (quotePrefixes) token.attrSet(QUOTE_PREFIXES_ATTRIBUTE, quotePrefixes.join(','));
  }
}

/**
 * A markdown-it core rule, run after the inline rules: a line break right after an
 * element (the end of bold, code, a link, inline HTML) is rendered as a space.
 * tiptap-markdown renders a line break as a newline and then deletes a newline at
 * the start of the text after an element, so such a line was joined to the next
 * word (`Use **bold**` then `next` read as "Use boldnext") and saved that way.
 * A line break after plain text is left alone: it already reads as a space on
 * load, and pasted plain text keeps it as a line break.
 */
function softBreaksAsSpaces<T extends MarkdownToken>(state: MarkdownCoreState<T>): void {
  for (const token of state.tokens) {
    if (token.type !== 'inline' || !token.children) continue;
    let previous: MarkdownToken | undefined;
    for (const child of token.children) {
      if (child.type === 'softbreak' && previous && previous.type !== 'text' && previous.type !== 'softbreak') {
        child.type = 'text';
        child.tag = '';
        child.content = ' ';
      }
      // Emphasis leaves an empty text token where its closing delimiter was.
      if (child.type !== 'text' || child.content !== '') previous = child;
    }
  }
}

/** The parts of prosemirror-markdown's serializer state a paragraph is written with. */
interface ParagraphSerializeState {
  output: MarkdownOutput;
  delim: string;
  write: (content?: string) => void;
  text: (text: string, escapeText?: boolean) => void;
  renderInline: (node: PMNode) => void;
  closeBlock: (node: PMNode) => void;
}

/** The containers whose first line their serializer writes before their first child: a
 *  list item's marker, a quote's `>`. */
const LINE_CONTAINERS: ReadonlySet<string> = new Set(['listItem', 'blockquote']);

/**
 * Whether `node` is an empty paragraph that opens a list item or quote, with a paragraph
 * after it. Markdown has no empty paragraph there: written (`- `, a blank line, then the
 * rest), it read back as an empty item and a paragraph outside the list, so a page with
 * one never saved to a fixed point. It is left out, and the paragraph after it opens the
 * item. Before any other block (a nested list, a quote) it is written as before: left
 * out, that block's own marker would share the item's line (`- - Beta`).
 */
const emptyLead = (node: PMNode, parent: PMNode | Fragment | undefined, index: number | undefined): boolean =>
  index === 0 &&
  node.content.size === 0 &&
  !!parent &&
  'type' in parent &&
  LINE_CONTAINERS.has(parent.type.name) &&
  parent.childCount > 1 &&
  parent.child(1).type.name === 'paragraph';

/** Keep a lazy quote's source only while it is still in the original quote depth. */
function lazyQuoteSource(source: string, prefixes: string, delim: string): { canonical: string; authored: string } | null {
  if (!/^(?:> )+$/.test(delim)) return null;
  const lines = source.split('\n');
  const counts = prefixes.split(',').map(Number);
  const depth = delim.length / 2;
  if (counts[0] !== depth || counts.length !== lines.length || counts.some((count) => !Number.isInteger(count) || count < 0 || count > depth))
    return null;
  const canonical =
    joinedSourceLines(source) ??
    lines
      .map((text, index) => {
        const line = index === 0 ? text : text.replace(/^[ \t]+/, '');
        if (index === lines.length - 1) return line;
        if (line.endsWith('\\')) return `${line}\n${delim}`;
        if (line.endsWith('  ')) return `${line.trimEnd()}\\\n${delim}`;
        return `${line.trimEnd()} `;
      })
      .join('');
  const authored = lines.map((line, index) => (index === 0 ? line : `${'> '.repeat(counts[index] ?? 0)}${line}`)).join('\n');
  return { canonical, authored };
}

/**
 * Write a paragraph: its source lines when the paragraph still reads the same as
 * they do (see the note at the top), otherwise the serializer's single line.
 */
function writeParagraph(state: ParagraphSerializeState, node: PMNode, parent?: PMNode | Fragment, index?: number): void {
  if (emptyLead(node, parent, index)) return;
  const [source = '', prefixes] = String(node.attrs.sourceParagraph ?? '').split('\0');
  const lazyQuote = prefixes ? lazyQuoteSource(source, prefixes, state.delim) : null;
  const joined = lazyQuote?.canonical ?? (source ? joinedSourceLines(source) : null);
  if (joined === null) {
    state.renderInline(node);
    state.closeBlock(node);
    return;
  }
  // Write what comes before the paragraph (closing blank lines, container
  // prefixes) first, so only the paragraph's own text is compared.
  state.write();
  const { output } = state;
  const start = output.length;
  state.renderInline(node);
  if (output.length - start === joined.length && output.sliceFrom(start) === joined) {
    output.truncate(start);
    // Unescaped: these lines are the source, already valid Markdown here.
    if (lazyQuote) output.append(lazyQuote.authored);
    else state.text(source, false);
  }
  state.closeBlock(node);
}

const paragraphParsers = new WeakSet<object>();

/** StarterKit's paragraph, keeping its source lines (see the note at the top). */
export const SourceParagraph = Paragraph.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      sourceParagraph: {
        default: '',
        // A new paragraph after Enter starts without a source. (A split mid-paragraph
        // copies it to both halves; neither reads as the source any more, so neither
        // writes it.)
        keepOnSplit: false,
        parseHTML: (element) => {
          const source = decodeMdxSource(element.getAttribute(SOURCE_ATTRIBUTE));
          const prefixes = element.getAttribute(QUOTE_PREFIXES_ATTRIBUTE);
          return source && prefixes ? `${source}\0${prefixes}` : source;
        },
        rendered: false,
      },
    };
  },
  addStorage() {
    return {
      markdown: {
        serialize(state, node, parent, index) {
          // The editor saves with LinearMarkdownSerializerState (markdown-output.ts).
          writeParagraph(state as unknown as ParagraphSerializeState, node, parent, index);
        },
        parse: {
          setup(markdownit) {
            if (paragraphParsers.has(markdownit)) return;
            markdownit.core.ruler.after('block', 'nibleaf_paragraph_source', (state) => annotateParagraphs(state));
            // Reads markdown-it's tight lists before a hidden paragraph is shown (tight-lists.ts).
            markdownit.core.ruler.before('nibleaf_paragraph_source', 'nibleaf_tight_lists', (state) => markTightLists(state));
            markdownit.core.ruler.after('inline', 'nibleaf_soft_breaks', (state) => softBreaksAsSpaces(state));
            paragraphParsers.add(markdownit);
          },
        },
      } satisfies MarkdownNodeSpec,
    };
  },
});
