import type { Fragment, Node as PMNode } from '@tiptap/pm/model';
import { encodeMdxSource } from './extensions/mdx-roundtrip';

/*
 * A fenced code block keeps the source lines it was read from, so a save writes
 * them back as they were. The editor's list and quote serializers write container
 * prefixes in one canonical form (`> `, two spaces under `- `), so without this a
 * fence indented with tabs, or with a tab after `>`, was rewritten on every save.
 * The lines are only written back while they still mean the same thing where the
 * block now sits: same code, same language, and the same containers in the same
 * CommonMark columns. Anything else saves in the canonical form, as before.
 */

/** What is left of a source line once some container prefixes are read, and the
 *  column its first character sits at. Columns count as CommonMark does: a tab
 *  moves to the next multiple of four. */
interface LineRest {
  text: string;
  column: number;
}

const nextTabStop = (column: number): number => column + 4 - (column % 4);

/** Read up to `target` columns: whitespace only, or anything (a list marker) with
 *  `anyCharacter`. A tab that reaches past `target` leaves its remaining columns
 *  as spaces, which is how CommonMark reads a partly used tab. */
function advanceTo(rest: LineRest, target: number, anyCharacter: boolean): LineRest {
  let { column } = rest;
  let index = 0;
  while (index < rest.text.length && column < target) {
    const character = rest.text[index];
    if (character === '\t') {
      const stop = nextTabStop(column);
      if (stop > target) return { text: ' '.repeat(stop - target) + rest.text.slice(index + 1), column: target };
      column = stop;
    } else if (character === ' ' || anyCharacter) column += 1;
    else break;
    index += 1;
  }
  return { text: rest.text.slice(index), column };
}

const QUOTE_MARKER = /^ {0,3}>/;

/** Read a quote's marker: up to three spaces, `>`, and one optional column of space
 *  after it, which may be the first column of a tab. A line without the marker (a
 *  lazy continuation) is left as it is. */
function readQuoteMarker(rest: LineRest): LineRest {
  const marker = QUOTE_MARKER.exec(rest.text)?.[0];
  if (!marker) return rest;
  const column = rest.column + marker.length;
  const text = rest.text.slice(marker.length);
  if (text[0] === ' ') return { text: text.slice(1), column: column + 1 };
  if (text[0] === '\t') return { text: ' '.repeat(nextTabStop(column) - column - 1) + text.slice(1), column: column + 1 };
  return { text, column };
}

/** The column a list item's content starts at, as CommonMark reads its first line
 *  (`- a` → 2, `10. a` → 4): one to four columns of space after the marker count,
 *  and a marker followed by nothing or by more than four takes one. */
function listItemContentColumn(rest: LineRest): number {
  const match = /^( *)([-+*]|\d{1,9}[.)])/.exec(rest.text);
  if (!match) return rest.column;
  const marker = rest.column + match[0].length;
  let column = marker;
  let index = match[0].length;
  while (rest.text[index] === ' ' || rest.text[index] === '\t') {
    column = rest.text[index] === '\t' ? nextTabStop(column) : column + 1;
    index += 1;
  }
  const gap = column - marker;
  return index >= rest.text.length || gap === 0 || gap > 4 ? marker + 1 : column;
}

/** An open quote, or a list item whose content starts at `column` and whose
 *  first line (marker included) is line `line`. */
type FenceContainer = { quote: true } | { quote: false; column: number; line: number };

/**
 * What is left of line `at` after its containers' prefixes, outermost first: each
 * reads its own prefix from what the containers around it leave of the line, in
 * columns. On a list item's first line its marker is part of its prefix. With
 * `strict`, null when the line doesn't carry them all (a quote's `>`, an item's
 * indent before text), so it would not continue those containers.
 */
function withoutContainers(line: string, at: number, containers: readonly FenceContainer[], strict = false): LineRest | null {
  let rest: LineRest = { text: line, column: 0 };
  for (const container of containers) {
    if (container.quote) {
      if (strict && !QUOTE_MARKER.test(rest.text)) return null;
      rest = readQuoteMarker(rest);
      continue;
    }
    rest = advanceTo(rest, container.column, at === container.line);
    if (strict && rest.column < container.column && rest.text.trim() !== '') return null;
  }
  return rest;
}

interface MarkdownToken {
  type: string;
  map: [number, number] | null;
  info: string;
  hidden: boolean;
  level: number;
  block: boolean;
  content: string;
  children: MarkdownToken[] | null;
  attrSet(name: string, value: string): void;
}

interface MarkdownCoreState<T extends MarkdownToken> {
  src: string;
  tokens: T[];
  Token: new (type: string, tag: string, nesting: 1 | 0 | -1) => T;
}

const LIST_OPEN = new Set(['bullet_list_open', 'ordered_list_open']);
const LIST_CLOSE = new Set(['bullet_list_close', 'ordered_list_close']);

/**
 * A markdown-it core rule, run after the block rules. Each fence gets its source:
 * the opening and closing lines without their containers' prefixes (a quote's `>`,
 * a list item's indent or marker), which the containers' serializers write again,
 * and its lines exactly as written. Keeping the prefixes added another on every
 * save until the fence broke (`> ```js` saved as `> > ```js`; #574 in list items).
 *
 * A fence that opens on its list item's first line (`- ```js`) gets an empty
 * paragraph before it: the editor's list item starts with a paragraph, and without
 * one the code block was moved out of the list (#578). The serializer leaves that
 * paragraph out again (see `writeFence`).
 */
export function annotateFences<T extends MarkdownToken>(state: MarkdownCoreState<T>): void {
  const lines = state.src.split('\n');
  const containers: FenceContainer[] = [];
  /** Open lists, innermost last: their open token, and whether they hold a shown
   *  paragraph or a lead. A list passes both on to the list around it when it
   *  closes, so each token touches only the innermost list. */
  const lists: Array<{ token: T; paragraph: boolean; lead: boolean }> = [];
  // The tokens are copied once, front to back, with the lead paragraphs in place:
  // inserting each into the array would move every token after it.
  const tokens: T[] = [];
  let previous: T | undefined;
  for (const token of state.tokens) {
    const after = previous;
    previous = token;
    if (token.type === 'blockquote_open') containers.push({ quote: true });
    if (token.type === 'list_item_open') {
      const line = token.map?.[0] ?? -1;
      const rest = withoutContainers(lines[line] ?? '', line, containers) as LineRest;
      containers.push({ quote: false, column: listItemContentColumn(rest), line });
    }
    if (token.type === 'blockquote_close' || token.type === 'list_item_close') containers.pop();
    if (LIST_OPEN.has(token.type)) lists.push({ token, paragraph: false, lead: false });
    const list = lists[lists.length - 1];
    if (list && token.type === 'paragraph_open' && !token.hidden) list.paragraph = true;
    if (list && LIST_CLOSE.has(token.type)) {
      lists.pop();
      // tiptap-markdown reads a list as loose when it holds any <p>, so a list that
      // was tight stays tight with its lead paragraphs.
      if (list.lead && !list.paragraph) list.token.attrSet('data-tight', 'true');
      const parent = lists[lists.length - 1];
      if (parent) {
        parent.paragraph ||= list.paragraph;
        parent.lead ||= list.lead;
      }
    }
    if (token.type === 'fence' && token.map) {
      annotateFence(token, lines, containers);
      if (after?.type === 'list_item_open') {
        tokens.push(...leadParagraph(state, token));
        if (list) list.lead = true;
      }
    }
    tokens.push(token);
  }
  state.tokens = tokens;
}

/** The fence's source: see `annotateFences`. */
function annotateFence(token: MarkdownToken, lines: readonly string[], containers: readonly FenceContainer[]): void {
  const [first, end] = token.map ?? [0, 0];
  const closeLine = Math.max(first, end - 1);
  const open = (withoutContainers(lines[first] ?? '', first, containers) as LineRest).text;
  const close = (withoutContainers(lines[closeLine] ?? '', closeLine, containers) as LineRest).text;
  const language = token.info.trim().split(/\s+/, 1)[0] ?? '';
  token.attrSet('data-mdx-fence-open', encodeMdxSource(open));
  token.attrSet('data-mdx-fence-close', encodeMdxSource(close));
  token.attrSet('data-mdx-fence-language', encodeMdxSource(language));
  token.attrSet('data-mdx-fence-lines', encodeMdxSource(lines.slice(first, closeLine + 1).join('\n')));
}

/** An empty paragraph, as markdown-it's tokens, to go before `fence` in its list item. */
function leadParagraph<T extends MarkdownToken>(state: MarkdownCoreState<T>, fence: T): T[] {
  const open = new state.Token('paragraph_open', 'p', 1);
  const inline = new state.Token('inline', '', 0);
  const close = new state.Token('paragraph_close', 'p', -1);
  for (const [offset, token] of [open, inline, close].entries()) {
    token.map = fence.map;
    token.block = true;
    token.level = fence.level + (offset === 1 ? 1 : 0);
  }
  inline.content = '';
  inline.children = [];
  return [open, inline, close];
}

/** The parts of prosemirror-markdown's serializer state a fence is written with. */
export interface FenceSerializeState {
  out: string;
  delim: string;
  closed: PMNode | null;
  write: (text?: string) => void;
  text: (text: string, shouldEscape?: boolean) => void;
  ensureNewLine: () => void;
  closeBlock: (node: PMNode) => void;
  flushClose: (size?: number) => void;
}

/**
 * The containers a serialized line sits in, read from what the serializer writes
 * before it: `delim` (`> ` for a quote, the marker's width in spaces for a list
 * item) and, on a block's first line, `first`, which has the item markers where
 * `delim` has spaces. Adjacent list items read as one, since their prefixes are
 * only whitespace on continuation lines. Null for anything else.
 */
function serializedContainers(delim: string, first: string): FenceContainer[] | null {
  if (first && first.length !== delim.length) return null;
  const containers: FenceContainer[] = [];
  let index = 0;
  while (index < delim.length) {
    if (delim[index] === '>') {
      if (first && first[index] !== '>') return null;
      containers.push({ quote: true });
      index += delim[index + 1] === ' ' ? 2 : 1;
      continue;
    }
    let end = index;
    while (delim[end] === ' ') end++;
    if (end === index) return null;
    // Line 0 is the opening line when it carries this item's marker; body lines are read as line 1.
    containers.push({ quote: false, column: end, line: /\S/.test(first.slice(index, end)) ? 0 : -1 });
    index = end;
  }
  return containers;
}

const nonSpace = (text: string): string => text.replaceAll(' ', '').replaceAll('\t', '');

/**
 * The code markdown-it reads from a fence's body line: what is left after the
 * containers and the fence's own indent. When the fence sits right at a quote's
 * content, with no indent to take off, markdown-it keeps a tab after `>` as
 * written unless that tab is one column wide (its blockquote rule); CommonMark
 * reads the tab's other columns as spaces. Null when the line lacks a prefix.
 */
function codeLine(line: string, containers: readonly FenceContainer[], indent: number): string | null {
  const innermost = containers[containers.length - 1];
  if (indent > 0 || !innermost?.quote) {
    const rest = withoutContainers(line, 1, containers, true);
    return rest && advanceTo(rest, rest.column + indent, false).text;
  }
  const rest = withoutContainers(line, 1, containers.slice(0, -1), true);
  const marker = rest ? QUOTE_MARKER.exec(rest.text)?.[0] : undefined;
  if (!rest || !marker) return null;
  const text = rest.text.slice(marker.length);
  const oneColumnTab = (rest.column + marker.length) % 4 === 3;
  return text[0] === ' ' || (text[0] === '\t' && oneColumnTab) ? text.slice(1) : text;
}

/**
 * The fence's source lines, when they can be written back unchanged where the
 * block now sits: the code, opening and closing lines are as parsed, and each line
 * read with the containers the serializer is writing (`first` on the opening line,
 * if it shares its container's first line) gives the same content. A line that
 * needs a container's `>` or indent it lacks, or differs once the fence's own
 * indent is taken off, means the containers changed; then null.
 */
function sourceLinesFor(node: PMNode, open: string, delim: string, first: string): string[] | null {
  const lines = String(node.attrs.sourceFenceLines ?? '').split('\n');
  const code = node.textContent ? node.textContent.split('\n') : [];
  const close = String(node.attrs.sourceFenceClose ?? '');
  const containers = serializedContainers(delim, first);
  const indent = /^ */.exec(open)?.[0].length ?? 0;
  if (!containers || lines.length !== code.length + 2 || open[indent] === '\t') return null;
  const read = (line: string, at: number) => withoutContainers(line, at, containers, true);
  const opening = read(lines[0] ?? '', first ? 0 : 1);
  if (opening?.text !== open || nonSpace(lines[0] ?? '') !== nonSpace(first || delim) + nonSpace(open)) return null;
  if (read(lines[lines.length - 1] ?? '', 1)?.text !== close) return null;
  for (const [index, text] of code.entries()) if (codeLine(lines[index + 1] ?? '', containers, indent) !== text) return null;
  return lines;
}

/**
 * Write a fence read from source: its source lines when they still hold (see
 * `sourceLinesFor`), otherwise its opening and closing lines around the code.
 * A list item's empty lead paragraph before it (see `annotateFences`) is left
 * out, so the fence opens on the item's first line, as written.
 */
export function writeFence(state: FenceSerializeState, node: PMNode, parent: PMNode | Fragment | undefined, index: number, open: string): void {
  // The clipboard serializer renders a slice's content, whose parent is a Fragment.
  const item = parent && 'type' in parent && parent.type.name === 'listItem' ? parent : undefined;
  const lead = item?.firstChild;
  if (index === 1 && lead?.type.name === 'paragraph' && lead.content.size === 0 && state.closed === lead) state.closed = null;
  // On a container's first line (a quote's, or an item's after its lead), what the
  // containers already wrote of it: `> `, `- `, `1. `.
  const atLineStart = state.out === '' || state.out.endsWith('\n');
  const first = state.closed || atLineStart ? '' : state.out.slice(state.out.lastIndexOf('\n') + 1);
  const unchanged = open !== '' && open === String(node.attrs.sourceFenceOpen ?? '');
  const lines = unchanged ? sourceLinesFor(node, open, state.delim, first) : null;
  if (lines) {
    state.flushClose();
    // The source's first line has its own markers in place of the ones written.
    if (first) state.out = state.out.slice(0, state.out.length - first.length);
    state.out += lines.join('\n');
    state.closeBlock(node);
    return;
  }
  state.write(open);
  state.write('\n');
  state.text(node.textContent, false);
  state.ensureNewLine();
  state.write(String(node.attrs.sourceFenceClose ?? '') || (open.trimStart().startsWith('~') ? '~~~' : '```'));
  state.closeBlock(node);
}
