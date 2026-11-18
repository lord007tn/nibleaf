import { translateFn } from '@nibleaf/i18n';
import { DOCUMENTATION_COMPONENTS, type DocumentationComponentDefinition } from '@nibleaf/shared/documentation-components';
import { fencedMarkdownLines } from '@nibleaf/shared/markdown-code';
import { scanAuthoredEmbeds } from '@nibleaf/shared/reader-embeds';
import { mergeAttributes, Node } from '@tiptap/core';
import type { DOMOutputSpec, Node as PMNode } from '@tiptap/pm/model';
import type { MarkdownNodeSpec } from 'tiptap-markdown';

type SerializeState = {
  write: (text: string) => void;
  closeBlock: (node: PMNode) => void;
  /** prosemirror-markdown internal (not in its typings): output ends at a line start. */
  atBlank?: () => boolean;
};

/**
 * End the previous block before a block-level MDX tag is written, even when
 * the node before it never closed itself. Without this, content such as a
 * trailing image is glued onto the tag (`![x](y)</Card>`), which leaves the tag
 * unclosed for the Markdown parser.
 */
const separateBlock = (state: SerializeState, node: PMNode): void => {
  if (state.atBlank?.() === false) state.closeBlock(node);
};

/** Write a block-level MDX tag on its own blank-line-separated line. */
export const writeBlockTag = (state: SerializeState, node: PMNode, tag: string): void => {
  separateBlock(state, node);
  state.write(tag);
  state.closeBlock(node);
};

/** The output a component's tight layout reads back (LinearMarkdownSerializerState). */
interface ChildrenOutput {
  length: number;
  lastLine: () => string;
  lineFrom: (start: number) => string;
  insertAt: (start: number, text: string) => void;
}

/** prosemirror-markdown's state, with the members a component's tight layout writes with. */
type ChildrenState = SerializeState & {
  ensureNewLine: () => void;
  /** prosemirror-markdown internal: write the line breaks a closed block still owes. */
  flushClose: (size?: number) => void;
  /** prosemirror-markdown internal: the block just closed, its line breaks not yet written. */
  closed?: unknown;
  /** The prefix of the containers being written (`> `, a list item's indent). */
  delim?: string;
  output?: ChildrenOutput;
};

/** For each serializer, the tight openers written and not yet closed, innermost last: the
 *  component, and where its children start in the output. */
const openTight = new WeakMap<object, Array<{ node: PMNode; start: number }>>();

/**
 * Whether a line written next to a component's tag keeps the tight layout when the page
 * is read again: it must be what `childrenLayout` reads as a child's Markdown line, not
 * blank in its containers (`> ` left by an emptied quote) and not another tag.
 */
const tightLine = (line: string): boolean => !blankInContainers(line) && (!TAG_LINE.test(line) || AUTOLINK_LINE.test(line));

/**
 * A component's opening tag before its children (#606). Where the author started the
 * children on the line right after the tag, they start there again; otherwise a blank
 * line follows the tag, as after any block tag. Whether they still can is read back when
 * the component closes (`writeChildrenCloser`).
 */
export const writeChildrenOpener = (state: SerializeState, node: PMNode, tag: string): void => {
  const children = state as ChildrenState;
  if (!isTightOpen(node) || !children.output) {
    writeBlockTag(state, node, tag);
    return;
  }
  separateBlock(state, node);
  state.write(tag);
  children.ensureNewLine();
  const open = openTight.get(state) ?? [];
  open.push({ node, start: children.output.length });
  openTight.set(state, open);
};

/**
 * A component's closing tag after its children: on the line right after them where the
 * author wrote it so (#606), otherwise after a blank line. The tight layout is kept only
 * where it reads back the same: the children's first and last lines written must each be
 * a Markdown line (see `tightLine`). An edit that emptied the first or last child, removed
 * every child, or left a tag or a blank line there gets main's blank-line layout on that
 * side, so every save loads to itself.
 */
export const writeChildrenCloser = (state: SerializeState, node: PMNode, tag: string): void => {
  const children = state as ChildrenState;
  const { output } = children;
  const open = openTight.get(state);
  const opened = open?.[open.length - 1]?.node === node ? open.pop() : undefined;
  if (output && opened) {
    const empty = output.length === opened.start;
    const first = empty ? '' : output.lineFrom(opened.start);
    const containers = (children.delim ?? '').replace(/\s+$/, '');
    // A first line blank in the component's own containers is already the blank line a
    // block tag gets (an empty first paragraph wrote it); anything else that isn't a
    // Markdown line (a quote's `> ` left empty, a tag) gets one, in the same containers.
    if (empty || (first.trim() !== containers.trim() && !tightLine(first))) output.insertAt(opened.start, `${containers}\n`);
    if (empty) {
      // No child wrote anything (an emptied paragraph): main's `<Note>⏎⏎</Note>`, with no
      // more blank lines owed for the empty child.
      children.closed = null;
      writeBlockTag(state, node, tag);
      return;
    }
  }
  // The children's last line: the block written last still owes its line break, or wrote it
  // itself (a table); a line break written with no block owing one leaves a blank line.
  const last = output && (children.closed || state.atBlank?.() === false) ? output.lastLine() : '';
  if (!isTightClose(node) || !output || !tightLine(last)) {
    writeBlockTag(state, node, tag);
    return;
  }
  if (children.closed) children.flushClose(1);
  else children.ensureNewLine();
  state.write(tag);
  state.closeBlock(node);
};

export type SupportedDefinition = {
  canonical: string;
  attrs: string[];
  defaults?: Record<string, string | boolean>;
  inline?: boolean;
  calloutVariant?: string;
  /** Boolean attributes (switches and presence flags): an empty authored
   *  value (`defaultOpen=""`) means present, as it does in HTML. */
  booleans?: string[];
  /** Holds only certain components (`<Steps>` holds `<Step>`s), not any block. */
  childrenOnly?: boolean;
};

const supportedDefinition = (component: DocumentationComponentDefinition, tag: string): SupportedDefinition => {
  const defaults = Object.fromEntries(
    component.attributes.flatMap((attribute) =>
      attribute.default === undefined
        ? []
        : [[attribute.name, typeof attribute.default === 'number' ? String(attribute.default) : attribute.default]],
    ),
  );
  const booleans = component.attributes.filter((attribute) => attribute.type === 'boolean').map((attribute) => attribute.name);
  return {
    canonical: tag,
    attrs: component.attributes.map((attribute) => attribute.name),
    ...(Object.keys(defaults).length > 0 ? { defaults } : {}),
    ...(booleans.length > 0 ? { booleans } : {}),
    ...(component.kind === 'inline' ? { inline: true } : {}),
    ...(component.reader?.callout ? { calloutVariant: component.reader.callout } : {}),
    ...(component.allowedChildren?.length ? { childrenOnly: true } : {}),
  };
};

/** The single capability inventory used by the source adapter and safety UX,
 *  keyed by lowercase tag and derived from the documentation component registry. */
export const SUPPORTED_MDX_COMPONENTS: Readonly<Record<string, SupportedDefinition>> = Object.fromEntries(
  DOCUMENTATION_COMPONENTS.flatMap((component) =>
    component.tag ? [[component.tag.toLowerCase(), supportedDefinition(component, component.tag)]] : [],
  ),
);

/** All-caps names of HTML elements the editor handles itself. MDX reads `<IMG>` as a
 *  component, yet the reader renders it as an HTML image, so the editor treats it as
 *  `<img>`: the image attribute allow-list applies and it saves as `<img …>`. Mixed-case
 *  names such as `<Img>` stay components. */
const HTML_ELEMENT_ALIASES: ReadonlyMap<string, string> = new Map([['IMG', 'img']]);

/** The HTML the editor reads as its own content: the nodes and marks it structures,
 *  also what it takes as HTML content (`<p><a href>`). `u`, `sup`, `sub`, `mark` and
 *  `img` save back byte for byte; the rest save as their Markdown form. Any other
 *  lowercase HTML (`<iframe>`, `<video>`, `<kbd>`, `<script>`, a custom element) loads
 *  as an opaque block that saves back exactly as written: the editor's HTML parser
 *  would otherwise drop it. */
const STRUCTURED_HTML: ReadonlySet<string> = new Set([
  ...['img', 'u', 'sup', 'sub', 'mark', 'a', 'p', 'strong', 'b', 'em', 'i', 'code', 'ul', 'ol', 'li', 'blockquote', 'pre'],
  ...['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'nibleaf-mdx-opaque-block', 'nibleaf-mdx-opaque-inline'],
]);

/** The editor writes a table Markdown can't hold as HTML, so a raw table opens as a table. */
const TABLE_HTML: ReadonlySet<string> = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col']);

/** The lowercase names of the editor's components and callouts (`<accordion>`, `<note>`),
 *  which it reads as those nodes. `<button>` is an HTML element first, so it stays raw. */
const COMPONENT_HTML: ReadonlySet<string> = new Set(Object.keys(SUPPORTED_MDX_COMPONENTS).filter((name) => name !== 'button'));

/** HTML the editor also writes inside its own HTML (a table cell, a `<p>`), so it is
 *  structured there. Written in Markdown, these save back as written, since the
 *  editor would rewrite them (`<br>` as `\`, `<hr>` as `---`, `<s>` as `~~`). */
const EDITOR_HTML_CONTENT: ReadonlySet<string> = new Set(['br', 'hr', 's', 'del', 'strike']);

/** Elements whose content is raw text in HTML: a `<` in a script is not a tag. */
const RAW_TEXT_HTML: ReadonlySet<string> = new Set(['script', 'style', 'textarea', 'title']);

/** A raw-text element's complete closing tag (`</title>`, `</title >`), searched in
 *  lowercased source. A `</title` with no `>`, or `</titles>`, doesn't close it. */
const RAW_TEXT_CLOSERS = new Map([...RAW_TEXT_HTML].map((name) => [name, new RegExp(`</${name}[ \\t\\r\\n\\f]*>`, 'g')]));
const rawTextCloser = (name: string): RegExp => RAW_TEXT_CLOSERS.get(name) ?? new RegExp(`</${name}[ \\t\\r\\n\\f]*>`, 'g');

/** The block tokens of the editor's own Markdown parser (markdown-it). */
type MarkdownBlockTokens = (source: string) => ReadonlyArray<{ type: string; map: [number, number] | null; content: string }>;

/**
 * Whether markdown-it read a closing line for a fence token. Its map takes in the
 * opening line, the code and the closing line; for a fence with no closer, which
 * CommonMark runs to the end of the page (or of its quote or list item), only the
 * first two. Its content ends each line of code with `\n`, except a last line at
 * the very end of a page with no line break after it. A last line that is blank
 * once its quote's `>` or list item's indent is read (`> ` at the end of the page)
 * adds nothing to the content, so the count alone reads that fence as closed; a
 * closing line is never blank, so `lastLine` settles it.
 */
export const fenceClosed = (token: { map: [number, number] | null; content: string }, lastLine?: string): boolean => {
  const [first, end] = token.map ?? [0, 0];
  if (end - first < 2 || fenceContentLines(token.content) !== end - first - 2) return false;
  return lastLine === undefined || !blankInContainers(lastLine);
};

/** How many lines of code markdown-it's fence content holds: see `fenceClosed`. */
export const fenceContentLines = (content: string): number => {
  let lines = content !== '' && !content.endsWith('\n') ? 1 : 0;
  for (let at = content.indexOf('\n'); at >= 0; at = content.indexOf('\n', at + 1)) lines++;
  return lines;
};

/** A line with nothing but quote markers and whitespace (`> `, `>`, `> > `, a list
 *  item's indent), its line break included. */
const blankInContainers = (line: string): boolean => {
  for (const character of line)
    if (character !== '>' && character !== ' ' && character !== '\t' && character !== '\n' && character !== '\r') return false;
  return true;
};

interface Span {
  start: number;
  end: number;
}

/** How the editor's Markdown parser reads the page's blocks, as offsets into `source`. */
interface MarkdownLayout {
  /** Fenced code, in every container (blockquotes, list items). */
  fenced: Span[];
  /** True for positions in indented code. */
  indented: Uint8Array;
  /** Index of the paragraph each line is in, or -1. */
  paragraphOfLine: Int32Array;
  paragraphs: Array<[number, number]>;
  lineStarts: number[];
  /** How many non-space characters come before each position, so a span's
   *  blankness is one subtraction rather than a scan of its line. */
  nonSpace: Int32Array;
  length: number;
  /** Where a fence with no closing line that runs to the end of the page starts, or -1. */
  unclosedFence: number;
  /** For each line in a blockquote or list item, the line after the innermost one ends;
   *  the line count for a line in neither. */
  containerEnd: Int32Array;
}

function markdownLayout(source: string, blockTokens: MarkdownBlockTokens | undefined): MarkdownLayout {
  // markdown-it reads `\r\n` and `\r` as one line break each, as this does.
  const lineStarts = [0];
  const breaks = /\r\n?|\n/g;
  for (let match = breaks.exec(source); match; match = breaks.exec(source)) lineStarts.push(match.index + match[0].length);
  const layout: MarkdownLayout = {
    fenced: [],
    indented: new Uint8Array(source.length),
    paragraphOfLine: new Int32Array(lineStarts.length).fill(-1),
    paragraphs: [],
    lineStarts,
    nonSpace: new Int32Array(source.length + 1),
    length: source.length,
    unclosedFence: -1,
    containerEnd: new Int32Array(lineStarts.length).fill(lineStarts.length),
  };
  for (let index = 0; index < source.length; index++) {
    const code = source.charCodeAt(index);
    const space = code === 32 || (code >= 9 && code <= 13) || (code > 127 && /\s/.test(source[index] ?? ''));
    layout.nonSpace[index + 1] = (layout.nonSpace[index] ?? 0) + (space ? 0 : 1);
  }
  if (!blockTokens) return layout;
  const at = (line: number) => lineStarts[line] ?? source.length;
  for (const token of blockTokens(source.replace(/\r\n?/g, '\n'))) {
    if (!token.map) continue;
    const [first, last] = token.map;
    if (token.type === 'fence') {
      layout.fenced.push({ start: at(first), end: at(last) });
      if (at(last) === source.length && !fenceClosed(token, source.slice(at(last - 1), at(last)))) layout.unclosedFence = at(first);
    } else if (token.type === 'code_block') layout.indented.fill(1, at(first), at(last));
    else if (token.type === 'blockquote_open' || token.type === 'list_item_open') {
      // The innermost container ends first.
      for (let line = first; line < last; line++) layout.containerEnd[line] = Math.min(layout.containerEnd[line] ?? last, last);
    } else if (token.type === 'paragraph_open') {
      layout.paragraphOfLine.fill(layout.paragraphs.length, first, last);
      layout.paragraphs.push([first, last]);
    }
  }
  return layout;
}

/** True for positions on the lines the reader reads as fenced code. Its scanner
 *  (`fencedMarkdownLines`) reads MDX components as Markdown containers, and fences
 *  in quotes and list items with CommonMark columns: a tab to the next multiple of
 *  4, the optional space after `>` taken from part of a tab, and a closer of the
 *  same marker at least as long as the opener. */
function readerCodeMask(source: string): Uint8Array {
  const mask = new Uint8Array(source.length);
  const lines = source.split('\n');
  let offset = 0;
  for (const [index, code] of fencedMarkdownLines(lines).entries()) {
    const length = (lines[index]?.length ?? 0) + 1;
    if (code) mask.fill(1, offset, offset + length);
    offset += length;
  }
  return mask;
}

/**
 * Code the reader reads as a fence that the editor's Markdown parser does not, one
 * span per run of lines. markdown-it reads a component tag followed straight away
 * by more lines as one HTML block, so a fence there (`<CodeGroup>`, then `>`, a tab
 * and ```` ```md ````) would load as text. Inside a component the reader also reads
 * a fence indented four columns or more, which markdown-it reads as indented code
 * holding the fence's markers: saved as a code block, those markers were wrapped in
 * another fence, which then grew on every save (#603).
 */
function unreadFences(layout: MarkdownLayout, readerCode: Uint8Array): Array<Span & { inCode: true; name: string }> {
  const fenced = spanIndex(layout.fenced);
  const spans: Array<Span & { inCode: true; name: string }> = [];
  let previous = -2;
  for (const [line, start] of layout.lineStarts.entries()) {
    if (readerCode[start] !== 1 || fenced(start, start)) continue;
    const end = lineStart(layout, line + 1);
    const last = spans[spans.length - 1];
    if (last && previous === line - 1) last.end = end;
    else spans.push({ start, end, inCode: true, name: 'Code' });
    previous = line;
  }
  return spans;
}

/** The line `offset` is on. */
const lineOf = (lineStarts: number[], offset: number): number => {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((lineStarts[middle] ?? 0) <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
};

/** Whether an opaque range is a block of its own, or sits in a line of text. A range
 *  on lines of its own is a block unless Markdown reads those lines as part of a
 *  longer paragraph; newlines inside the range don't decide it. */
function isBlockRange(layout: MarkdownLayout, span: Span): boolean {
  if (!wholeLine(layout, span.start, span.end)) return false;
  const first = lineOf(layout.lineStarts, span.start);
  const paragraph = layout.paragraphs[layout.paragraphOfLine[first] ?? -1];
  if (!paragraph) return true;
  return paragraph[0] === first && paragraph[1] === lineOf(layout.lineStarts, Math.max(span.start, span.end - 1)) + 1;
}

/** Whether `[start, end)` holds only whitespace. */
const blank = (layout: MarkdownLayout, start: number, end: number): boolean =>
  (layout.nonSpace[Math.max(start, end)] ?? 0) - (layout.nonSpace[start] ?? 0) === 0;

const lineStart = (layout: MarkdownLayout, line: number): number => layout.lineStarts[line] ?? layout.length;

/** A range on lines of its own: only whitespace before it on its first line and after it on its last. */
const wholeLine = (layout: MarkdownLayout, start: number, end: number): boolean =>
  blank(layout, lineStart(layout, lineOf(layout.lineStarts, start)), start) &&
  blank(layout, end, lineStart(layout, lineOf(layout.lineStarts, end) + 1));

/** A range written at the start of its own lines with a blank line (or the document
 *  edge) on each side: the layout the editor writes a component's children in, so
 *  an opaque block there saves back byte for byte. */
function isolated(layout: MarkdownLayout, range: Span): boolean {
  const first = lineOf(layout.lineStarts, range.start);
  const last = lineOf(layout.lineStarts, range.end);
  if (lineStart(layout, first) !== range.start || !blank(layout, range.end, lineStart(layout, last + 1))) return false;
  const before = first === 0 || blank(layout, lineStart(layout, first - 1), range.start);
  const after = last + 1 >= layout.lineStarts.length || blank(layout, lineStart(layout, last + 1), lineStart(layout, last + 2));
  return before && after;
}

/** Answers "is this span inside one of the ranges?" in O(log n), for ranges in any order. */
function spanIndex(ranges: readonly Span[]): (start: number, end: number) => boolean {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const reach: number[] = [];
  let furthest = -1;
  for (const range of sorted) {
    furthest = Math.max(furthest, range.end);
    reach.push(furthest);
  }
  return (start, end) => {
    // The last range starting at or before `start`; any earlier one is a candidate too,
    // and `reach` holds the furthest end among them.
    let low = 0;
    let high = sorted.length - 1;
    let found = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if ((sorted[middle]?.start ?? 0) <= start) {
        found = middle;
        low = middle + 1;
      } else high = middle - 1;
    }
    return found >= 0 && (reach[found] ?? -1) >= end;
  };
}

/** Keep one copy of each range and drop every range inside another, in one ordered sweep. */
function outermostRanges<T extends Span>(ranges: readonly T[]): T[] {
  const unique = new Map<string, T>();
  for (const range of ranges) {
    const key = `${range.start}:${range.end}`;
    if (!unique.has(key)) unique.set(key, range);
  }
  const sorted = [...unique.values()].sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: T[] = [];
  let furthest = -1;
  for (const range of sorted) {
    if (range.end <= furthest) continue;
    kept.push(range);
    furthest = range.end;
  }
  return kept;
}

interface Container extends Span {
  name: string;
  /** A structured HTML element (a raw `<table>`), rather than a supported component. */
  html: boolean;
  /** Index of the nearest container around this one, or -1. */
  parent: number;
}

/** Containers sorted by position, each with its parent, from one ordered sweep. */
function containerTree(list: Array<Omit<Container, 'parent'>>): Container[] {
  const containers: Container[] = list.sort((a, b) => a.start - b.start || b.end - a.end).map((item) => ({ ...item, parent: -1 }));
  const stack: number[] = [];
  for (const [index, container] of containers.entries()) {
    while (stack.length > 0 && (containers[stack[stack.length - 1] ?? -1]?.end ?? 0) <= container.start) stack.pop();
    container.parent = enclosingOnStack(containers, stack, container);
    stack.push(index);
  }
  return containers;
}

/** The innermost container on the stack around `span` (well-nested tags make that the top). */
function enclosingOnStack(containers: Container[], stack: number[], span: Span): number {
  for (let at = stack.length - 1; at >= 0; at--) {
    const index = stack[at] ?? -1;
    const container = containers[index];
    if (container && container.start <= span.start && container.end >= span.end && (container.start !== span.start || container.end !== span.end))
      return index;
  }
  return -1;
}

/** For each span (sorted by start), the innermost container around it, in one sweep. */
function innermostContainers(containers: Container[], spans: readonly Span[]): number[] {
  const result: number[] = [];
  const stack: number[] = [];
  let next = 0;
  for (const span of spans) {
    while (next < containers.length && (containers[next]?.start ?? 0) <= span.start) {
      const container = containers[next] as Container;
      while (stack.length > 0 && (containers[stack[stack.length - 1] ?? -1]?.end ?? 0) <= container.start) stack.pop();
      stack.push(next);
      next++;
    }
    while (stack.length > 0 && (containers[stack[stack.length - 1] ?? -1]?.end ?? 0) <= span.start) stack.pop();
    result.push(enclosingOnStack(containers, stack, span));
  }
  return result;
}

/**
 * Where raw HTML must be kept as one opaque range. Inside an HTML element the
 * editor structures (a raw `<table>`, `<sup>`), the outermost such element is kept
 * whole: the editor would otherwise rewrite it in its own HTML. Inside a supported
 * component, raw HTML stays a child when it is inline or sits in the component's
 * usual block layout; otherwise (an indented block, or read as indented code) the
 * nearest component that does is kept whole. A component that holds only certain
 * children (`<Steps>` holds `<Step>`s) has no room for an opaque block, which the
 * editor wrapped in a new child (#603), so the range widens past it too. Returns
 * null for code outside any component.
 */
function rawHtmlRange(
  layout: MarkdownLayout,
  raw: Span,
  inCode: boolean,
  containers: Container[],
  widening: Widening,
  innermost: number,
): (Span & { name: string }) | null {
  const html = widening.outerHtml[innermost] ?? -1;
  if (html >= 0) return containers[widening.target[html] ?? html] ?? null;
  const component = containers[innermost];
  if (!inCode && hasRoom(component) && (!isBlockRange(layout, raw) || isolated(layout, raw))) return { ...raw, name: '' };
  if (!component) return inCode ? null : { ...raw, name: '' };
  return containers[widening.target[innermost] ?? innermost] ?? null;
}

const hasRoom = (container: Container | undefined): boolean => !container || !SUPPORTED_MDX_COMPONENTS[container.name.toLowerCase()]?.childrenOnly;

/** For each container: the outermost structured HTML element at or around it
 *  (or -1), and the container an opaque range kept at it widens to. */
interface Widening {
  outerHtml: Int32Array;
  target: Int32Array;
}

/**
 * The widening `rawHtmlRange` applies, worked out once per container in one
 * forward pass (a parent comes before its children). Inside a structured HTML
 * element the outermost such element is kept; otherwise a container stays when it
 * sits in its parent's usual block layout and its parent has room for it, and
 * widens to its parent's target when not. Walking each candidate's ancestors
 * instead made a page of nested components, each holding an unread fence,
 * quadratic.
 */
function wideningTargets(layout: MarkdownLayout, containers: Container[]): Widening {
  const outerHtml = new Int32Array(containers.length).fill(-1);
  const target = new Int32Array(containers.length);
  for (const [index, container] of containers.entries()) {
    const parent = container.parent;
    const aboveHtml = parent >= 0 ? (outerHtml[parent] ?? -1) : -1;
    outerHtml[index] = aboveHtml >= 0 ? aboveHtml : container.html ? index : -1;
    if (aboveHtml >= 0) target[index] = target[aboveHtml] ?? aboveHtml;
    else if (parent < 0 || (hasRoom(containers[parent]) && (!isBlockRange(layout, container) || isolated(layout, container)))) target[index] = index;
    else target[index] = target[parent] ?? parent;
  }
  return { outerHtml, target };
}

interface TagToken {
  start: number;
  end: number;
  name: string;
  raw: string;
  closing: boolean;
  selfClosing: boolean;
  /** A lowercase HTML tag rather than a JSX component. */
  html: boolean;
  /** The editor's own markup for a node it structures (`<div data-mdx="Card">`). */
  editorMarkup?: boolean;
  /** Lowercase HTML the editor keeps opaque (see classifyHtml). */
  rawHtml?: boolean;
  /** A raw-text element (`<script>`) with no closing tag: its text runs to the end of the page. */
  runsToEnd?: boolean;
  /** A supported component's opening tag the scan couldn't read to its `>`; it
   *  spans only its `<Name` (see brokenRanges). */
  broken?: boolean;
}

interface SourceRange {
  start: number;
  end: number;
  source: string;
  name: string;
  block: boolean;
  /** A component whose opening tag can't be read (brokenRanges). */
  broken?: boolean;
}

interface AttributeToken {
  name: string;
  start: number;
  end: number;
  value: string | boolean;
}

/** A UTF-16 surrogate with no partner: encodeURIComponent throws on it. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
/** How the encoding writes a lone surrogate: `%%` and its four hex digits. Plain
 *  encodeURIComponent output never holds `%%`, since its every `%` starts a `%XX`. */
const ENCODED_SURROGATE = /%%([0-9A-F]{4})/;

/**
 * Source text as an HTML attribute value, the way the editor carries it. A lone
 * surrogate is kept as the code unit it is (#805), so a page holding one loads
 * and saves byte for byte rather than throwing.
 */
export const encodeMdxSource = (value: string): string => {
  let encoded = '';
  let from = 0;
  for (const match of value.matchAll(LONE_SURROGATE)) {
    encoded += `${encodeURIComponent(value.slice(from, match.index))}%%${match[0].charCodeAt(0).toString(16).toUpperCase()}`;
    from = match.index + 1;
  }
  return encoded + encodeURIComponent(value.slice(from));
};

export const decodeMdxSource = (value: string | null | undefined): string => {
  if (!value) return '';
  try {
    return value
      .split(ENCODED_SURROGATE)
      .map((part, index) => (index % 2 === 1 ? String.fromCharCode(Number.parseInt(part, 16)) : decodeURIComponent(part)))
      .join('');
  } catch {
    return value;
  }
};

// A Map, so a name such as `toString` never resolves through Object.prototype.
const NAMED_REFERENCES = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
]);

/** An authored attribute value with its character references decoded, as JSX and
 *  HTML read it: `title="R&amp;D"` is "R&D" in the editor, and saving after an
 *  edit writes `&amp;` once, not again on top. */
const decodeAttributeValue = (value: string): string =>
  value.replace(/&(?:#(\d{1,7})|#x([\da-f]{1,6})|([a-z][a-z\d]{1,31}));/gi, (reference, decimal?: string, hex?: string, name?: string) => {
    if (name) {
      // Names are case-sensitive: `&Lt;` is "≪", not "<".
      const known = NAMED_REFERENCES.get(name);
      if (known) return known;
      // Any other named reference (`&mdash;`, `&nbsp;`) is decoded by the DOM the
      // editor runs in. Only complete references ending in `;` get here, so a URL
      // query such as `?a=1&copy=2` is never touched; unknown names stay as written.
      if (typeof document === 'undefined') return reference;
      const area = document.createElement('textarea');
      area.innerHTML = reference;
      // Every named reference decodes to one or two UTF-16 units. A longer result
      // is a shorter legacy name plus leftover letters (`&notit;` reads as "¬it;"),
      // which JSX and HTML attributes leave as written.
      return area.value.length <= 2 ? area.value : reference;
    }
    const code = decimal ? Number(decimal) : Number.parseInt(hex ?? '', 16);
    // As HTML reads them: U+0000, a surrogate or anything past U+10FFFF is U+FFFD,
    // so a lone surrogate never reaches the saved source.
    return code === 0 || (code >= 0xd8_00 && code <= 0xdf_ff) || code > 0x10_ff_ff ? '�' : String.fromCodePoint(code);
  });

const escapeHtmlAttribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A blank line, as the Markdown parser reads one: a line of spaces and tabs at most,
 *  with `\r\n` (never split in two) or a lone `\r` read as a line break too. */
const BLANK_LINE = /(?:\r\n|\r(?!\n)|\n)[ \t]*(?:\r\n|\r(?!\n)|\n)/;

/**
 * A component opener's attribute value for the HTML the editor parses (#721). The
 * opener's HTML is read as a Markdown HTML block, or inline HTML in its paragraph,
 * and a blank line ends either one: the opener would be cut there and its component
 * dropped. So a value holding a blank line has its line breaks written as character
 * references, and the opener's HTML holds none; the DOM decodes them, so the editor
 * holds the value exactly as written. Any other value is written as before.
 */
const escapeOpenerAttribute = (value: string): string =>
  BLANK_LINE.test(value) ? escapeHtmlAttribute(value).replace(/\r/g, '&#13;').replace(/\n/g, '&#10;') : escapeHtmlAttribute(value);

const lineIsFence = (line: string): { marker: string; length: number } | null => {
  const match = /^\s*(`{3,}|~{3,})/.exec(line);
  return match?.[1] ? { marker: match[1][0] ?? '`', length: match[1].length } : null;
};

// Lines that start a block of their own, so an inline code span can't run
// into them (CommonMark: they interrupt a paragraph). HTML blocks of types 1–6
// interrupt too; a component tag (type 7) doesn't.
const HTML_BLOCK_NAMES =
  'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul';
const INTERRUPTS_PARAGRAPH = new RegExp(
  [
    '^ {0,3}#{1,6}(?:\\s|$)',
    '^ {0,3}([-*_])(?:[ \\t]*\\1){2,}[ \\t]*$',
    '^ {0,3}>',
    '^ {0,3}(?:[-+*]|1[.)])[ \\t]+\\S',
    '^ {0,3}<(?:script|pre|style|textarea)(?:\\s|>|$)',
    '^ {0,3}<(?:!--|\\?|![A-Za-z]|!\\[CDATA\\[)',
    `^ {0,3}</?(?:${HTML_BLOCK_NAMES})(?:\\s|/?>|$)`,
  ].join('|'),
  'i',
);
const ATX_HEADING = /^ {0,3}#{1,6}(?:\s|$)/;

/** Mark the inline code spans of one paragraph, `text` starting at `offset`.
 *  A span may cross the paragraph's line breaks, as in Markdown, but never
 *  its end. A run of backticks closes only at a run of the same length. */
function maskInlineCode(mask: Uint8Array, text: string, offset: number): void {
  let cursor = 0;
  while (cursor < text.length) {
    if (text[cursor] !== '`') {
      cursor++;
      continue;
    }
    let count = 1;
    while (text[cursor + count] === '`') count++;
    let closer = -1;
    for (let at = text.indexOf('`', cursor + count); at >= 0; at = text.indexOf('`', at)) {
      let run = 1;
      while (text[at + run] === '`') run++;
      if (run === count) {
        closer = at;
        break;
      }
      at += run;
    }
    if (closer < 0) {
      // An unmatched run is literal backticks; spans can still open after it.
      cursor += count;
      continue;
    }
    mask.fill(1, offset + cursor, offset + closer + count);
    cursor = closer + count;
  }
}

/** True for positions in fenced or inline code, where JSX-looking text is literal.
 *  A line the reader reads as code is code here too, and never opens or closes a
 *  fence of its own: a list item fence's longer closer (`  ````) is not a new
 *  fence running to the end of the page. */
function codeMask(source: string, readerCode = readerCodeMask(source)): Uint8Array {
  const mask = new Uint8Array(source.length);
  let offset = 0;
  let fence: { marker: string; length: number } | null = null;
  // The paragraph being collected: where it starts, and how far it goes.
  let paragraphStart = -1;
  let paragraphEnd = -1;
  const flush = () => {
    if (paragraphStart >= 0) maskInlineCode(mask, source.slice(paragraphStart, paragraphEnd), paragraphStart);
    paragraphStart = -1;
  };
  for (const lineWithBreak of source.match(/.*(?:\n|$)/g) ?? []) {
    if (!lineWithBreak) continue;
    const line = lineWithBreak.endsWith('\n') ? lineWithBreak.slice(0, -1) : lineWithBreak;
    const candidate = lineIsFence(line);
    if (readerCode[offset] === 1) {
      flush();
      mask.fill(1, offset, offset + lineWithBreak.length);
    } else if (fence || candidate) {
      flush();
      mask.fill(1, offset, offset + lineWithBreak.length);
      if (!fence && candidate) fence = candidate;
      else if (fence && candidate?.marker === fence.marker && candidate.length >= fence.length) fence = null;
    } else if (line.trim() === '') {
      flush();
    } else {
      // A block-starting line opens a new paragraph-like block; a heading is
      // one line on its own, so nothing continues from it either.
      if (INTERRUPTS_PARAGRAPH.test(line)) flush();
      if (paragraphStart < 0) paragraphStart = offset;
      paragraphEnd = offset + line.length;
      if (ATX_HEADING.test(line)) flush();
    }
    offset += lineWithBreak.length;
  }
  flush();
  return mask;
}

/** Words after which a `/` starts a regular expression rather than dividing (`return /x/`). */
const REGEX_AFTER_WORDS: ReadonlySet<string> = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
]);
/** Words whose `( … )` a statement follows, so a `/` after the `)` starts a regular expression (`if (a) /x/.test(b)`). */
const STATEMENT_PAREN_WORDS: ReadonlySet<string> = new Set(['if', 'while', 'for', 'with']);
/** Words after which a `{` opens a block. */
const BLOCK_AFTER_WORDS: ReadonlySet<string> = new Set(['else', 'do', 'try', 'finally']);
/** What starts a word, an identifier or a number: JavaScript's identifier start, `$`, `_`, a digit. */
const WORD_START = /^[\p{ID_Start}$_0-9]$/u;
/** What continues one: JavaScript's identifier part (digits and `_` included), `$`, ZWNJ and ZWJ. */
const WORD_PART = /^[\p{ID_Continue}\p{Join_Control}$]$/u;

/**
 * Where the word that starts at `at` ends, or `at` when none does. Read by code point, so
 * an identifier outside the Basic Multilingual Plane (U+1D49C, say: two UTF-16 units) is one
 * word, not two pieces of punctuation; offsets stay in UTF-16 units.
 */
function wordEnd(source: string, at: number, first: RegExp = WORD_START): number {
  let end = at;
  let test = first;
  while (end < source.length) {
    const code = source.codePointAt(end) ?? 0;
    if (!test.test(String.fromCodePoint(code))) break;
    end += code > 0xff_ff ? 2 : 1;
    test = WORD_PART;
  }
  return end;
}
/** JavaScript's line terminators: they end a `//` comment, and a regular expression literal can't hold one. */
const LINE_BREAK = /[\r\n\u2028\u2029]/g;
const isLineTerminator = (char: string | undefined): boolean => char === '\n' || char === '\r' || char === '\u2028' || char === '\u2029';
/** How deep `${…}` substitutions may nest in template literals before a scan gives up. */
const MAX_TEMPLATE_DEPTH = 32;
/** JavaScript's punctuation (quotes and `.` are read on their own), plus `#` and `@`. */
const PUNCTUATION: ReadonlySet<string> = new Set([...'{}()[];,<>+-*/%&|^!~?:=#@']);
/** How many times one expression's scan may read a `/` both ways before it gives up. */
const MAX_EXPRESSION_FORKS = 16;

interface ExpressionScan {
  /** Whether a `/` here starts a regular expression; `ambiguous` after a block's or function body's `}`. */
  regex: boolean | 'ambiguous';
  /** The previous token: an identifier (`word`) or punctuation. */
  last: string;
  /** The previous identifier, when it is the previous token and not a property name. */
  word: string;
  dot: boolean;
  /** The open braces, each with whether it opened a block or function body. */
  braces: Array<{ at: number; block: boolean }>;
  /** The open parentheses, each with whether a statement follows it (`if (…)`). */
  parens: boolean[];
}

/**
 * What one page's expression scans share: how much more they may read before the page
 * falls back to main's reading (see expressionEnds), and where the last search for a
 * comment's end and a line break started and what it found, so a search is not
 * repeated over text an earlier one passed (`{/*{/*{/*…`, #714).
 */
interface ExpressionContext {
  source: string;
  budget: number;
  /** How many template literals the scan is inside (see templateEnd). */
  depth: number;
  commentEnd: { from: number; at: number };
  lineBreak: { from: number; at: number };
}

const expressionContext = (source: string): ExpressionContext => ({
  source,
  // Enough to read every expression on the page a few times over; past it, main's reading.
  budget: 32 * (source.length + 256),
  depth: 0,
  commentEnd: { from: Number.POSITIVE_INFINITY, at: -1 },
  lineBreak: { from: Number.POSITIVE_INFINITY, at: -1 },
});

/** The first match at or after `from`, reusing the last search when it started no
 *  later and found nothing before `from`. */
function searchFrom(memo: { from: number; at: number }, from: number, search: (from: number) => number): number {
  if (memo.from > from || (memo.at >= 0 && memo.at < from)) {
    memo.from = from;
    memo.at = search(from);
  }
  return memo.at;
}

/** The index of the quote closing the string that opens at `start`, or null. */
function quotedEnd(context: ExpressionContext, start: number): number | null {
  const { source } = context;
  const quote = source[start];
  for (let i = start + 1; i < source.length; i++) {
    if (source[i] === '\\') i++;
    else if (source[i] === quote) {
      context.budget -= i - start;
      return i;
    }
  }
  context.budget -= source.length - start;
  return null;
}

/**
 * The index of the backtick closing the template literal that opens at `start`, or
 * null. Each `${…}` in it is read as JavaScript (readExpression), so a backtick,
 * brace or `//` inside a substitution ends nothing (`` `${`//{`}` ``). Null when it
 * never closes as read, when substitutions nest deeper than MAX_TEMPLATE_DEPTH, or
 * when the budget runs out: callers then read the expression as main did.
 */
function templateEnd(context: ExpressionContext, start: number): number | null {
  const { source } = context;
  if (++context.depth > MAX_TEMPLATE_DEPTH) return null;
  let i = start + 1;
  let end: number | null = null;
  for (; i < source.length; i++) {
    if (--context.budget < 0) break;
    const char = source[i];
    if (char === '\\') i++;
    else if (char === '`') {
      end = i;
      break;
    } else if (char === '$' && source[i + 1] === '{') {
      const close = readExpression(context, i + 1, expressionStart(), { count: 0 });
      if (close === null) break;
      i = close - 1;
    }
  }
  context.depth--;
  return end;
}

/** Where the regular expression literal that opens at `start` ends, its flags
 *  included, or null when it doesn't close on its line. */
function regexEnd(context: ExpressionContext, start: number): number | null {
  const { source } = context;
  let inClass = false;
  let i = start + 1;
  let end: number | null = null;
  for (; i < source.length; i++) {
    const char = source[i];
    if (isLineTerminator(char)) break;
    if (char === '\\') {
      i++;
      if (isLineTerminator(source[i])) break;
    } else if (inClass) inClass = char !== ']';
    else if (char === '[') inClass = true;
    else if (char === '/') {
      end = wordEnd(source, i + 1, WORD_PART);
      break;
    }
  }
  context.budget -= (end ?? i) - start;
  return end;
}

/**
 * Read the JavaScript in `{…}` from `from`, in the state `scan`, to the position
 * after the `}` that closes it. Strings, template literals, `//` and `/* … *\/`
 * comments and regular expression literals are read as JavaScript reads them, so
 * a quote or brace inside them (`/"}/`, `/* } *\/`) ends nothing (#714). This is
 * not a JavaScript parser: whether a `/` divides or starts a regular expression
 * is told from the token before it. After a block's or function body's `}`, where
 * that token can't tell, a `/` that can't start a regular expression there (none
 * closes on its line) divides; otherwise the rest is read both ways, and a reading
 * that breaks (no closing brace) is dropped. Null when it can't tell: the
 * expression never closes as read, both readings close it at different places,
 * more than `MAX_EXPRESSION_FORKS` `/`s are read both ways, or the page's budget
 * runs out. Callers then read the expression as main did (see expressionEnds).
 * `record` hears where each inner `{` closes (or -1, never), up to the first fork.
 */
function readExpression(
  context: ExpressionContext,
  from: number,
  scan: ExpressionScan,
  forks: { count: number },
  record?: (open: number, end: number) => void,
): number | null {
  const { source } = context;
  const { braces, parens } = scan;
  let { regex, last, word, dot } = scan;
  for (let i = from; i < source.length; i++) {
    if (--context.budget < 0) return null;
    const char = source[i] ?? '';
    if (/\s/.test(char)) continue;
    const next = source[i + 1];
    if (char === '/' && next === '/') {
      // A line comment: what follows on its line is not code.
      const end = searchFrom(context.lineBreak, i, (at) => {
        LINE_BREAK.lastIndex = at;
        return LINE_BREAK.exec(source)?.index ?? -1;
      });
      if (end < 0) break;
      i = end;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = searchFrom(context.commentEnd, i + 2, (at) => source.indexOf('*/', at));
      if (end < 0) break;
      i = end + 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      const end = char === '`' ? templateEnd(context, i) : quotedEnd(context, i);
      if (end === null) break;
      i = end;
      regex = false;
      last = 'literal';
      word = '';
      dot = false;
      continue;
    }
    if (char === '/' && source[i - 1] !== '<' && regex) {
      const literal = regexEnd(context, i);
      if (regex === 'ambiguous' && literal !== null) {
        if (++forks.count > MAX_EXPRESSION_FORKS) return null;
        const state = (regex: boolean, last: string): ExpressionScan => ({
          regex,
          last,
          word: '',
          dot: false,
          braces: [...braces],
          parens: [...parens],
        });
        const asRegex = readExpression(context, literal, state(false, 'literal'), forks);
        const asDivision = readExpression(context, i + 1, state(true, '/'), forks);
        if (asRegex === null) return asDivision;
        return asDivision === null || asDivision === asRegex ? asRegex : null;
      }
      if (regex === true) {
        if (literal === null) return null;
        i = literal - 1;
        regex = false;
        last = 'literal';
        word = '';
        dot = false;
        continue;
      }
      // After a block's `}`, a `/` that can't start a regular expression divides.
    }
    const end = wordEnd(source, i);
    if (end > i) {
      context.budget -= end - i;
      const name = source.slice(i, end);
      // After a `.` a keyword is a property name (`obj.return / 2`).
      regex = !dot && REGEX_AFTER_WORDS.has(name);
      word = dot ? '' : name;
      last = 'word';
      dot = false;
      i = end - 1;
      continue;
    }
    if (char === '.') {
      dot = true;
      last = '.';
      word = '';
      continue;
    }
    // Anything else that isn't JavaScript's punctuation (an emoji, a stray `\`): the scan
    // can't tell what it is, so main's reading decides (#714).
    if (!PUNCTUATION.has(char)) return null;
    const previous = last;
    const previousWord = word;
    word = '';
    dot = false;
    last = char;
    regex = true;
    if (char === '{') {
      const enclosing = braces[braces.length - 1];
      const block =
        previous === ')' ||
        previous === '=>' ||
        previous === ';' ||
        BLOCK_AFTER_WORDS.has(previousWord) ||
        ((previous === '{' || previous === '}') && Boolean(enclosing?.block));
      braces.push({ at: i, block });
    } else if (char === '}') {
      const open = braces.pop();
      if (open) record?.(open.at, i + 1);
      if (braces.length === 0) return i + 1;
      regex = open?.block ? 'ambiguous' : false;
    } else if (char === '(') parens.push(STATEMENT_PAREN_WORDS.has(previousWord));
    else if (char === ')') regex = parens.pop() === true;
    else if (char === ']') regex = false;
    else if (char === '=' && next === '>') {
      i++;
      last = '=>';
    } else if ((char === '+' || char === '-') && next === char) {
      // `a++ / 2` divides.
      i++;
      regex = false;
    }
  }
  for (const open of braces) record?.(open.at, -1);
  return null;
}

const expressionStart = (): ExpressionScan => ({ regex: true, last: '', word: '', dot: false, braces: [], parens: [] });

/**
 * Main's `expressionEnds`, kept for where the JavaScript reading can't tell
 * (readExpression): braces counted outside quotes, every quote with backslash escapes,
 * for many starts without rescanning. On those expressions the editor does exactly
 * what main did. A scan passes other `{`s outside quotes in the same state a
 * scan of their own would start in, so the stack of open braces tells where each of
 * those closes, or that it never does.
 */
function mainExpressionEnds(source: string): (start: number) => number | null {
  const known = new Map<number, number>();
  return (start) => {
    const found = known.get(start);
    if (found !== undefined) return found < 0 ? null : found;
    const open: number[] = [];
    let quote = '';
    let escaped = false;
    for (let i = start; i < source.length; i++) {
      const char = source[i] ?? '';
      if (quote) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === quote) quote = '';
        continue;
      }
      if (char === '"' || char === "'" || char === '`') quote = char;
      else if (char === '{') open.push(i);
      else if (char === '}') {
        const opened = open.pop();
        if (opened !== undefined) known.set(opened, i + 1);
        if (open.length === 0) return i + 1;
      }
    }
    for (const opened of open) known.set(opened, -1);
    return null;
  };
}

/**
 * Where each `{…}` expression on `source` ends, for many starts, without rescanning. A scan
 * passes other `{`s outside strings, comments and regular expressions in the
 * state a scan of their own would start in, so it tells where each of those
 * closes, or that it never does as read. A later expression the scan already
 * passed is answered from that; before, every `{` after an unclosed one rescanned
 * the rest of the page. Where the JavaScript reading can't tell, main's reading
 * answers, itself without rescanning; and the page's budget keeps the JavaScript
 * reading to a few passes over the page in all.
 */
function expressionEnds(source: string): (start: number) => number | null {
  const context = expressionContext(source);
  const known = new Map<number, number>();
  const mainEnd = mainExpressionEnds(source);
  return (start) => {
    let found = known.get(start);
    if (found === undefined) {
      found = readExpression(context, start, expressionStart(), { count: 0 }, (open, end) => known.set(open, end)) ?? -1;
      known.set(start, found);
    }
    return found < 0 ? mainEnd(start) : found;
  };
}

/** Whether the character at `at` is backslash-escaped in Markdown: an odd run of
 *  backslashes before it (`\\<` is an escaped backslash, then a real `<`). */
function escapedAt(source: string, at: number): boolean {
  let start = at;
  while (start > 0 && source[start - 1] === '\\') start--;
  return (at - start) % 2 === 1;
}

const JSX_NAME = /[A-Z][A-Za-z0-9_.:-]*/y;
// Lowercase HTML names, custom elements (`my-widget`) included.
const HTML_NAME = /[a-z][a-z0-9]*(?:[-_.][a-z0-9]+)*/y;

/**
 * Scan for JSX component tags and, with `comments`, lowercase HTML tags and
 * `<!-- … -->` comments too. One forward pass: a whole tag, quoted attribute
 * values and `{…}` included, is read before anything after it, so a `<!--` or `<`
 * inside an attribute is never read as markup. An unterminated comment runs to
 * the end of the page, as HTML reads it.
 */
function scanTags(source: string, mask = codeMask(source), comments?: Array<Span & { runsToEnd: boolean }>, indented?: Uint8Array): TagToken[] {
  const tokens: TagToken[] = [];
  const html = Boolean(comments);
  let lower: string | undefined;
  // Positions where a tag scan outside quotes and braces is known to reach the end
  // of the page with no `>`: from there it reads the same text the same way, so a
  // later scan that gets there stops at once. Without this, every `<` after an
  // unclosed tag rescanned the rest of the page. HTML, JSX and a Frame's opener
  // quote differently, so each has its own. A scan marks the positions it passed
  // when it fails.
  const unclosable = { html: new Uint8Array(0), jsx: new Uint8Array(0), frame: new Uint8Array(0) };
  const passed: number[] = [];
  // Inside `{…}` every scan reads the same way, as JavaScript (HTML or JSX), so
  // where a `{` met outside quotes closes is fixed by its position; a later scan
  // that meets that `{` skips to its end, or stops, rather than reading it again.
  const expressionEnd = expressionEnds(source);
  /**
   * The index of the `>` that ends the tag whose attributes start at `from`, or -1
   * when there is none. HTML attribute values have no backslash escapes
   * (`title="Old\"` ends at that quote), and nor do a Frame's quoted values (#579):
   * `caption="Old\"` is the caption `Old\`, as the reader reads it. Only other JSX
   * and the JavaScript inside `{…}` do.
   */
  const readTag = (from: number, kind: keyof typeof unclosable): number => {
    const isHtml = kind === 'html';
    const escapes = kind === 'jsx';
    if (unclosable[kind].length === 0) unclosable[kind] = new Uint8Array(source.length + 1);
    const known = unclosable[kind];
    passed.length = 0;
    let quote = '';
    let escaped = false;
    let cursor = from;
    for (; cursor < source.length; cursor++) {
      const char = source[cursor] ?? '';
      if (quote) {
        if (escaped) escaped = false;
        else if (char === '\\' && (escapes || quote === '`')) escaped = true;
        else if (char === quote) quote = '';
        continue;
      }
      if (known[cursor]) break;
      passed.push(cursor);
      if (char === '"' || char === "'" || (char === '`' && !isHtml)) quote = char;
      else if (char === '{') {
        // An expression that never closes, or that can't be read reliably.
        const end = expressionEnd(cursor);
        if (end === null) break;
        cursor = end - 1;
      } else if (char === '>') return cursor;
    }
    for (const position of passed) known[position] = 1;
    return -1;
  };
  // The first `</name` at or after the last search for it, or -1 for none.
  const closers = new Map<string, number>();
  // Where the indented code block holding the last position asked about ends.
  let codeEnd = -1;
  // The first `-->` at or after the last search for it, or -1 for none (-2: not searched).
  // A `<!--` in indented code ends with its block, so later ones search again: one
  // search per block over the rest of the page grew with the square of the page.
  let commentClose = -2;
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '<' || mask[i]) continue;
    if (comments && source.startsWith('<!--', i)) {
      if (commentClose === -2 || (commentClose >= 0 && commentClose < i + 4)) commentClose = source.indexOf('-->', i + 4);
      const close = commentClose;
      let end = close < 0 ? source.length : close + 3;
      // In indented code a `<!--` is code, not a comment opener: it ends with the code
      // block, and the tags after that block are read (#624). Unclosed, it hid every
      // component after it, which then saved in another form (`<Note>` as `> [!NOTE]`).
      if (indented?.[i] === 1) {
        if (codeEnd <= i) {
          codeEnd = i;
          while (indented[codeEnd] === 1) codeEnd++;
        }
        if (codeEnd < end) end = codeEnd;
      }
      comments.push({ start: i, end, runsToEnd: close < 0 && end === source.length });
      i = end - 1;
      continue;
    }
    let cursor = i + 1;
    const closing = source[cursor] === '/';
    if (closing) cursor++;
    JSX_NAME.lastIndex = cursor;
    HTML_NAME.lastIndex = cursor;
    const nameMatch = JSX_NAME.exec(source) ?? (html ? HTML_NAME.exec(source) : null);
    if (!nameMatch?.[0]) continue;
    const name = nameMatch[0];
    const isHtml = !/^[A-Z]/.test(name);
    cursor += name.length;
    if (!/[\s/>]/.test(source[cursor] ?? '')) continue;
    const kind = isHtml ? 'html' : name === 'Frame' && !closing ? 'frame' : 'jsx';
    const attributesStart = cursor;
    cursor = readTag(attributesStart, kind);
    if (cursor < 0) {
      // A supported component's opening tag that can't be read to its `>` (an
      // unterminated quote or `{`, an expression the scan can't read) is still
      // that component's tag: it pairs with its closing tag, and the editor keeps
      // the two and what is between them byte for byte (brokenRanges, #714). One
      // that reads with quoted values that have no backslash escapes, as a Frame's
      // (`title="Old\">`), is left as before: Markdown reads it as HTML.
      const supported = !isHtml && !closing && SUPPORTED_MDX_COMPONENTS[name.toLowerCase()] && !HTML_ELEMENT_ALIASES.has(name);
      if (supported && (kind === 'frame' || readTag(attributesStart, 'frame') < 0)) {
        // Only its `<Name` is known; brokenRanges finds how far it is kept.
        const end = i + 1 + name.length;
        tokens.push({ start: i, end, name, raw: source.slice(i, end), closing, selfClosing: false, html: false, broken: true });
      }
      continue;
    }
    const raw = source.slice(i, cursor + 1);
    const selfClosing = !closing && /\/\s*>$/.test(raw);
    const token: TagToken = { start: i, end: cursor + 1, name, raw, closing, selfClosing, html: isHtml };
    tokens.push(token);
    i = cursor;
    // In indented code a `<script>` is code, and after an odd run of backslashes
    // (`\<title>`) its `<` is an escaped, literal character: neither starts raw text.
    if (isHtml && !closing && !selfClosing && RAW_TEXT_HTML.has(name) && indented?.[token.start] !== 1 && !escapedAt(source, token.start)) {
      // A script's or style's content is text up to its closing tag, and only a
      // complete one (`</title>`) ends it: a malformed `</title` with no `>` is
      // part of that text (#628). A search that found no closer means none after
      // any later tag either.
      lower ??= source.toLowerCase();
      let close = closers.get(name);
      if (close === undefined || (close !== -1 && close <= i)) {
        const closer = rawTextCloser(name);
        closer.lastIndex = i + 1;
        close = closer.exec(lower)?.index ?? -1;
        closers.set(name, close);
      }
      if (close > i) i = close - 1;
      else {
        // With no closer, HTML reads the rest of the page as its text (#576).
        token.runsToEnd = true;
        i = source.length;
      }
    }
  }
  return tokens;
}

/** Pair each closing tag with the latest unpaired opening tag of the same name. */
function tagPairs(tokens: TagToken[]): Map<number, number> {
  const pairs = new Map<number, number>();
  const open = new Map<string, number[]>();
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token || token.selfClosing) continue;
    if (!token.closing) {
      const stack = open.get(token.name);
      if (stack) stack.push(i);
      else open.set(token.name, [i]);
      continue;
    }
    const openIndex = open.get(token.name)?.pop();
    if (openIndex != null) pairs.set(openIndex, i);
  }
  return pairs;
}

function unsupportedRanges(source: string, layout: MarkdownLayout, tokens: TagToken[], pairs: Map<number, number>): SourceRange[] {
  const ranges: SourceRange[] = [];
  let coveredUntil = -1;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token || token.start < coveredUntil) continue;
    if (token.html ? !token.rawHtml : SUPPORTED_MDX_COMPONENTS[token.name.toLowerCase()] || HTML_ELEMENT_ALIASES.has(token.name)) continue;
    const closeIndex = token.closing ? undefined : pairs.get(i);
    const close = closeIndex == null ? undefined : tokens[closeIndex];
    const end = close?.end ?? (token.runsToEnd ? source.length : token.end);
    // Keep the escape with its literal raw-text tag; left outside, it escapes the internal placeholder.
    const start = token.html && RAW_TEXT_HTML.has(token.name) && escapedAt(source, token.start) ? token.start - 1 : token.start;
    ranges.push(sourceRange(source, layout, { start, end }, token.name));
    if (!token.closing) coveredUntil = end;
  }
  return ranges;
}

/**
 * A supported component whose opening tag can't be read (see scanTags) is kept
 * byte for byte. When its own closing tag is the next component tag after it (so no
 * other component's tag, and no closing tag of one around it, comes between), the
 * whole authored pair is kept, blank lines and headings inside it too. Otherwise it
 * is kept up to the first of: the end of its Markdown block (a blank line or a heading
 * line), or that next component tag. Its own text may run on over lines Markdown would
 * start other blocks with (`<Card title={x\n>`), so those don't end it. So it never
 * holds another component or crosses the closing tag of one around it; a closing tag
 * of its own that is not
 * the next tag is kept on its own (strayPartners). The editor can't tell its
 * attributes, so it doesn't structure it; read as text, the tag was escaped and its
 * closing tag dropped or moved (#714).
 */
const BLANK_LINES = new RegExp(BLANK_LINE.source, 'g');
/** A line break before an ATX heading line. */
const HEADING_LINES = /(?:\r\n|\r(?!\n)|\n) {0,3}#{1,6}(?=[ \t\r\n]|$)/g;

/**
 * From the line break at `at`: past the blank lines after it, the end of a line that is
 * only `>` (spaces and tabs aside), or -1. One forward pass, no backtracking.
 */
function loneTagEnd(source: string, at: number): number {
  let i = at;
  while (i < source.length && (source[i] === '\r' || source[i] === '\n' || source[i] === ' ' || source[i] === '\t')) i++;
  if (i === at || source[i] !== '>') return -1;
  // The `>` must start its line: only spaces and tabs between it and the last line break.
  let back = i - 1;
  while (source[back] === ' ' || source[back] === '\t') back--;
  if (source[back] !== '\r' && source[back] !== '\n') return -1;
  i++;
  while (source[i] === ' ' || source[i] === '\t') i++;
  return i >= source.length || source[i] === '\r' || source[i] === '\n' ? i : -1;
}

/**
 * For each broken opener, the index of the earliest closing tag of a tag opened before it
 * and still open there, whatever the tag (a component, a lowercase component name, the
 * editor's own `<div data-callout>` or `data-mdx` markup, plain HTML): -1 for none. One
 * forward sweep, with the open tags' closing tags in a min-heap.
 */
function enclosingClosers(tokens: TagToken[], pairs: Map<number, number>): Map<number, number> {
  const closeOf = new Int32Array(tokens.length).fill(-1);
  for (const [open, close] of pairs) closeOf[open] = close;
  const heap: number[] = [];
  const push = (value: number) => {
    let at = heap.push(value) - 1;
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if ((heap[parent] ?? 0) <= value) break;
      heap[at] = heap[parent] ?? 0;
      at = parent;
    }
    heap[at] = value;
  };
  const pop = () => {
    const last = heap.pop() ?? 0;
    if (heap.length === 0) return;
    let at = 0;
    for (;;) {
      const left = 2 * at + 1;
      if (left >= heap.length) break;
      const right = left + 1;
      const child = right < heap.length && (heap[right] ?? 0) < (heap[left] ?? 0) ? right : left;
      if ((heap[child] ?? 0) >= last) break;
      heap[at] = heap[child] ?? 0;
      at = child;
    }
    heap[at] = last;
  };
  const enclosing = new Map<number, number>();
  for (const [index, token] of tokens.entries()) {
    while (heap.length > 0 && (heap[0] ?? 0) <= index) pop();
    if (token.broken) enclosing.set(index, heap[0] ?? -1);
    const close = closeOf[index] ?? -1;
    if (close > index) push(close);
  }
  return enclosing;
}

/** How many quote markers (`>`) open the line at `from`, read up to `to`. */
function quoteDepth(source: string, from: number, to: number): number {
  let depth = 0;
  for (let at = from; at < to; at++) {
    const char = source[at];
    if (char === '>') depth++;
    else if (char !== ' ' && char !== '\t') break;
  }
  return depth;
}

/** Whether `line` is blank inside `depth` quotes: nothing but its quote markers and spaces. */
function blankAtDepth(line: string, depth: number): boolean {
  let markers = 0;
  for (const char of line) {
    if (char === '>' && markers < depth) markers++;
    else if (char !== ' ' && char !== '\t' && char !== '\r' && char !== '\n') return false;
  }
  return true;
}

/** Whether a range that starts on `line` inside quotes stands on lines of its own there:
 *  only quote markers and spaces before it, only spaces after it, and no paragraph
 *  running on beyond it (see isBlockRange). */
function quotedBlock(source: string, layout: MarkdownLayout, line: number, span: Span): boolean {
  const before = source.slice(lineStart(layout, line), span.start);
  if (!blankAtDepth(before, before.length)) return false;
  if (!blank(layout, span.end, lineStart(layout, lineOf(layout.lineStarts, span.end) + 1))) return false;
  const paragraph = layout.paragraphs[layout.paragraphOfLine[line] ?? -1];
  return !paragraph || (paragraph[0] === line && paragraph[1] === lineOf(layout.lineStarts, Math.max(span.start, span.end - 1)) + 1);
}

function brokenRanges(source: string, layout: MarkdownLayout, tokens: TagToken[], pairs: Map<number, number>): SourceRange[] {
  const ranges: SourceRange[] = [];
  const enclosing = enclosingClosers(tokens, pairs);
  // Tokens come in page order, so each lookup below only moves forward: one pass in all,
  // however many openers can't be read (a page of them on one line, say).
  let blankLine = -1;
  let headingLine = -1;
  let loneFor = -1;
  let loneEnd = -1;
  let next = 0;
  // Inside quotes, per depth: the first blank quoted line after the line last searched from.
  const quotedBlank = new Map<number, { from: number; line: number }>();
  const blankQuotedLine = (depth: number, line: number): number => {
    let memo = quotedBlank.get(depth);
    if (!memo || memo.from > line || memo.line <= line) {
      let at = line + 1;
      while (at < layout.lineStarts.length && !blankAtDepth(source.slice(lineStart(layout, at), lineStart(layout, at + 1)), depth)) at++;
      memo = { from: line, line: at };
      quotedBlank.set(depth, memo);
    }
    return memo.line < layout.lineStarts.length ? lineStart(layout, memo.line) - 1 : source.length;
  };
  // A range inside an earlier one is dropped by outermostRanges anyway: never sliced.
  let coveredUntil = -1;
  for (const [index, token] of tokens.entries()) {
    if (!token.broken) continue;
    if (blankLine < token.start) {
      BLANK_LINES.lastIndex = token.start;
      blankLine = BLANK_LINES.exec(source)?.index ?? source.length;
    }
    if (headingLine < token.start) {
      HEADING_LINES.lastIndex = token.start;
      headingLine = HEADING_LINES.exec(source)?.index ?? source.length;
    }
    // The opener's Markdown container (a quote or list item) ends its range too, and inside
    // quotes a line of nothing but quote markers is its blank line.
    const line = lineOf(layout.lineStarts, token.start);
    const depth = quoteDepth(source, lineStart(layout, line), token.start);
    const containerEnd = lineStart(layout, layout.containerEnd[line] ?? layout.lineStarts.length);
    const blockEnd = depth === 0 ? blankLine : blankQuotedLine(depth, line);
    // The next component tag (lowercase names and the editor's own markup included), or
    // the closing tag of anything still open around the opener, whichever comes first.
    next = Math.max(next, index + 1);
    while (tokens[next]?.html && !isComponentTag(tokens[next] as TagToken)) next++;
    const around = enclosing.get(index) ?? -1;
    const tagIndex = around >= 0 && (next >= tokens.length || around < next) ? around : next;
    const tag = tokens[tagIndex];
    let end: number;
    if (tag && pairs.get(index) === tagIndex && tag.end <= containerEnd) end = tag.end;
    else {
      const limit = Math.min(headingLine, tag?.start ?? source.length, containerEnd);
      end = Math.min(blockEnd, limit);
      if (depth === 0 && end === blankLine && blankLine < limit) {
        // The opener's own `>` on a line of its own after a blank line ends the opener
        // (`<Card title={x\n\n>`): kept with it, rather than read as an empty quote.
        // Read once per blank line, however many openers end at it.
        if (loneFor !== blankLine) {
          loneFor = blankLine;
          loneEnd = loneTagEnd(source, blankLine);
        }
        if (loneEnd >= 0 && loneEnd <= limit) end = loneEnd;
      }
    }
    while (end > token.start && /\s/.test(source[end - 1] ?? '')) end--;
    if (end <= coveredUntil) continue;
    coveredUntil = end;
    const range = sourceRange(source, layout, { start: token.start, end }, token.name);
    // Inside quotes, a range on lines of its own (nothing but quote markers before it, nothing
    // after it) is a block there, as it is at the top level: read as an inline atom in a
    // quote's first paragraph, a callout would drop it.
    if (!range.block && depth > 0 && quotedBlock(source, layout, line, range)) range.block = true;
    range.broken = true;
    ranges.push(range);
  }
  return ranges;
}

/**
 * A tag whose partner is inside a range kept byte for byte is kept too, whatever the tag
 * (a component, a lowercase component name, the editor's own markup, HTML). Rewritten or
 * read alone, a closing tag would close nothing and be dropped, and an opening tag would
 * hold everything to the end of the page (#714).
 */
function strayPartners(source: string, layout: MarkdownLayout, tokens: TagToken[], pairs: Map<number, number>, opaque: SourceRange[]): SourceRange[] {
  const kept = spanIndex(opaque);
  const strays: SourceRange[] = [];
  for (const [openIndex, closeIndex] of pairs) {
    const open = tokens[openIndex];
    const close = tokens[closeIndex];
    // Raw HTML is kept opaque as a whole (keepRawHtml); every other pair, HTML included, is
    // kept together.
    if (!open || !close || open.rawHtml) continue;
    const openKept = kept(open.start, open.end);
    if (openKept === kept(close.start, close.end)) continue;
    const stray = openKept ? close : open;
    strays.push(sourceRange(source, layout, stray, stray.name));
  }
  return strays;
}

const sourceRange = (source: string, layout: MarkdownLayout, span: Span, name: string): SourceRange => ({
  start: span.start,
  end: span.end,
  source: source.slice(span.start, span.end),
  name,
  block: isBlockRange(layout, span),
});

/** Whether a lowercase tag is the editor's own markup for a node it structures:
 *  `<div data-callout>`, or `<div|span data-mdx="Name">` for that component, read
 *  from the tag's actual attributes. */
function isEditorMarkup(token: TagToken): boolean {
  if (token.closing || (token.name !== 'div' && token.name !== 'span')) return false;
  const attrs = parseAttributes(token.raw, token.name);
  if (token.name === 'div' && attrs.some((attr) => attr.name === 'data-callout')) return true;
  const component = attrs.find((attr) => attr.name === 'data-mdx')?.value;
  const definition = typeof component === 'string' ? SUPPORTED_MDX_COMPONENTS[component.toLowerCase()] : undefined;
  return Boolean(definition && definition.canonical === component && Boolean(definition.inline) === (token.name === 'span'));
}

/**
 * Mark which lowercase tags are raw HTML to keep opaque. A tag the editor
 * structures (STRUCTURED_HTML, tables, its components' lowercase names, its own
 * markup) is parsed as before, and so is the HTML it writes inside its own HTML.
 * Everything else is raw. Closing tags follow the tag they close.
 */
function classifyHtml(tokens: TagToken[], pairs: Map<number, number>): void {
  const editorHtml: Span[] = [];
  for (const [index, token] of tokens.entries()) {
    if (!token.html || token.closing) continue;
    token.editorMarkup = isEditorMarkup(token);
    const close = tokens[pairs.get(index) ?? -1];
    if (close) close.editorMarkup = token.editorMarkup;
    if (close && (token.editorMarkup || STRUCTURED_HTML.has(token.name) || TABLE_HTML.has(token.name) || COMPONENT_HTML.has(token.name)))
      editorHtml.push({ start: token.end, end: close.start });
  }
  const insideEditorHtml = spanIndex(editorHtml);
  for (const token of tokens) {
    if (!token.html) continue;
    const structured =
      token.editorMarkup ||
      STRUCTURED_HTML.has(token.name) ||
      TABLE_HTML.has(token.name) ||
      COMPONENT_HTML.has(token.name) ||
      (EDITOR_HTML_CONTENT.has(token.name) && insideEditorHtml(token.start, token.end));
    token.rawHtml = !structured;
  }
  // A pair is raw or structured together, as its opening tag is.
  for (const [openIndex, closeIndex] of pairs) {
    const open = tokens[openIndex];
    const close = tokens[closeIndex];
    if (open?.html && close) close.rawHtml = open.rawHtml;
  }
}

/** A supported component's tag. The editor's own markup and its components'
 *  lowercase names (`<note>`) hold their children as components do. */
const isComponentTag = (token: TagToken): boolean =>
  token.html
    ? !token.rawHtml && Boolean(token.editorMarkup || COMPONENT_HTML.has(token.name))
    : Boolean(SUPPORTED_MDX_COMPONENTS[token.name.toLowerCase()]) && !HTML_ELEMENT_ALIASES.has(token.name);

/**
 * Text that runs to the end of the page (an unterminated comment or raw-text
 * element, a fence with no closing line) holds the closing tags of the components
 * opened before it, or they were never written. The editor closed such a
 * component after that text when saving, where the next load read the closing tag
 * as part of the text again, so every save added one (#603, #576). The range from
 * the first component still open there (no closing tag, or one inside the range)
 * through the end of the page is kept whole, byte for byte. One backward pass.
 */
function openComponentsRange(
  source: string,
  layout: MarkdownLayout,
  tokens: TagToken[],
  pairs: Map<number, number>,
  opaque: SourceRange[],
  runsToEnd: readonly number[],
): SourceRange | null {
  if (runsToEnd.length === 0) return null;
  let start = Math.min(...runsToEnd);
  const covered = spanIndex(opaque);
  let opener: TagToken | undefined;
  for (let index = tokens.length - 1; index >= 0; index--) {
    const token = tokens[index];
    if (!token || token.start >= start || token.closing || token.selfClosing || !isComponentTag(token) || covered(token.start, token.end)) continue;
    const close = tokens[pairs.get(index) ?? -1];
    if (close && close.start < start) continue;
    start = token.start;
    opener = token;
  }
  return opener ? sourceRange(source, layout, { start, end: source.length }, opener.name) : null;
}

/** Structured HTML the editor writes with a prefix on every line: a quote, a list. */
const LINE_PREFIXED_HTML: ReadonlySet<string> = new Set(['blockquote', 'ul', 'ol', 'li']);

/** The editor's own `<div data-callout>`, which it writes as a quote (`> [!NOTE]`). */
const isCalloutMarkup = (token: TagToken): boolean =>
  Boolean(token.editorMarkup) && token.name === 'div' && parseAttributes(token.raw, token.name).some((attr) => attr.name === 'data-callout');

/**
 * A range kept byte for byte over several lines is written back as its source, and a
 * quote or list item around it prefixes only its first line: the source of one inside
 * a Markdown quote carries its own `>` markers. Inside HTML the editor writes as a quote
 * or list (a `<div data-callout>` saved as `> [!NOTE]`, a `<blockquote>`), it carries
 * none, so the next load read its later lines as other blocks and the second save
 * changed the page again (#806). The outermost such container is kept whole instead,
 * byte for byte, as raw HTML inside structured HTML is (rawHtmlRange). One forward pass.
 */
function linePrefixedRanges(
  source: string,
  layout: MarkdownLayout,
  containers: Container[],
  prefixed: ReadonlySet<number>,
  opaque: readonly SourceRange[],
): SourceRange[] {
  if (prefixed.size === 0) return [];
  const multiLine = opaque.filter((range) => /[\r\n]/.test(range.source)).sort((a, b) => a.start - b.start);
  if (multiLine.length === 0) return [];
  // For each container, the outermost line-prefixed container at or around it, or -1
  // (a parent comes before its children).
  const outer = new Int32Array(containers.length).fill(-1);
  for (const [index, container] of containers.entries()) {
    const above = container.parent >= 0 ? (outer[container.parent] ?? -1) : -1;
    outer[index] = above >= 0 ? above : prefixed.has(container.start) ? index : -1;
  }
  const innermost = innermostContainers(containers, multiLine);
  const kept = new Set<number>();
  const ranges: SourceRange[] = [];
  for (const index of multiLine.keys()) {
    const around = innermost[index] ?? -1;
    const target = around >= 0 ? (outer[around] ?? -1) : -1;
    const container = containers[target];
    if (!container || kept.has(target)) continue;
    kept.add(target);
    ranges.push(sourceRange(source, layout, container, container.name));
  }
  return ranges;
}

/** Add raw HTML (comments, and HTML read as indented code inside a component) to
 *  the opaque ranges, widening any raw HTML range to what keeps it byte for byte
 *  (see rawHtmlRange). Ranges inside a wider one are dropped. */
function keepRawHtml(
  source: string,
  layout: MarkdownLayout,
  tokens: TagToken[],
  pairs: Map<number, number>,
  authored: SourceRange[],
  extra: Array<Span & { inCode: boolean; name: string }>,
): SourceRange[] {
  const list: Array<Omit<Container, 'parent'>> = [];
  // For linePrefixedRanges: the containers the editor structures (a broken opener is
  // kept, not structured, and its closing tag may lie outside the tags around it), and
  // which of them it writes with a prefix on every line.
  const structured: Array<Omit<Container, 'parent'>> = [];
  const prefixed = new Set<number>();
  for (const [openIndex, closeIndex] of pairs) {
    const open = tokens[openIndex];
    const close = tokens[closeIndex];
    if (!open || !close) continue;
    // Structured HTML elements, and supported components.
    const html = open.html && !open.rawHtml && !open.editorMarkup && !COMPONENT_HTML.has(open.name);
    if (!html && !isComponentTag(open)) continue;
    list.push({ start: open.start, end: close.end, name: open.name, html });
    if (open.broken) continue;
    structured.push({ start: open.start, end: close.end, name: open.name, html });
    if (html ? LINE_PREFIXED_HTML.has(open.name) : isCalloutMarkup(open)) prefixed.add(open.start);
  }
  const containers = containerTree(list);
  const opaque = outermostRanges([...authored, ...linePrefixedRanges(source, layout, containerTree(structured), prefixed, authored)]);
  const covered = spanIndex(opaque);
  const candidates = [
    ...opaque.filter((range) => /^[a-z]/.test(range.name)).map((range) => ({ ...range, inCode: false })),
    ...extra.filter((span) => !covered(span.start, span.end)),
  ].sort((a, b) => a.start - b.start);
  const innermost = innermostContainers(containers, candidates);
  const widening = wideningTargets(layout, containers);
  const kept = [...opaque];
  // Many candidates can widen to the same container: it is kept once.
  const keptContainers = new Set<Span>();
  for (const [index, candidate] of candidates.entries()) {
    const range = rawHtmlRange(layout, candidate, candidate.inCode, containers, widening, innermost[index] ?? -1);
    if (!range || keptContainers.has(range)) continue;
    if (range.name) keptContainers.add(range);
    kept.push(sourceRange(source, layout, range, range.name || candidate.name));
  }
  return outermostRanges(kept);
}

function parseAttributes(raw: string, componentName: string): AttributeToken[] {
  const attrs: AttributeToken[] = [];
  // A Frame's quoted values have no backslash escapes (see scanTags, #579).
  const escapes = componentName !== 'Frame';
  let cursor = raw.indexOf(componentName) + componentName.length;
  const limit = raw.length - (raw.endsWith('/>') ? 2 : 1);
  // One reader for the whole tag: its searches are shared, not repeated per attribute.
  const expressionEnd = expressionEnds(raw);
  while (cursor < limit) {
    while (/\s/.test(raw[cursor] ?? '')) cursor++;
    if (cursor >= limit) break;
    const start = cursor;
    while (cursor < limit && !/[\s=/>]/.test(raw[cursor] ?? '')) cursor++;
    const name = raw.slice(start, cursor);
    if (!name) break;
    const nameEnd = cursor;
    while (/\s/.test(raw[cursor] ?? '')) cursor++;
    if (raw[cursor] !== '=') {
      // A boolean attribute is its name: the space after it belongs to what follows (#714).
      attrs.push({ name, start, end: nameEnd, value: true });
      continue;
    }
    cursor++;
    while (/\s/.test(raw[cursor] ?? '')) cursor++;
    let value: string;
    const quote = raw[cursor];
    if (quote === '"' || quote === "'") {
      const valueStart = ++cursor;
      while (cursor < limit && raw[cursor] !== quote) cursor += escapes && raw[cursor] === '\\' ? 2 : 1;
      value = decodeAttributeValue(raw.slice(valueStart, cursor));
      cursor++;
    } else if (quote === '{') {
      const end = expressionEnd(cursor) ?? limit;
      value = raw.slice(cursor, end);
      cursor = end;
    } else {
      const valueStart = cursor;
      while (cursor < limit && !/\s/.test(raw[cursor] ?? '')) cursor++;
      value = decodeAttributeValue(raw.slice(valueStart, cursor));
    }
    attrs.push({ name, start, end: cursor, value });
  }
  return attrs;
}

const attributeValue = (attrs: AttributeToken[], name: string): string | boolean | undefined =>
  attrs.find((attr) => attr.name.toLowerCase() === name.toLowerCase())?.value;

function effectiveAttributes(definition: SupportedDefinition, attrs: AttributeToken[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (const name of definition.attrs) {
    const authored = attributeValue(attrs, name);
    // `defaultOpen=""` is present (the reader opens it): treat it as true so
    // the editor node agrees and the authored spelling is kept on save.
    result[name] = authored === '' && definition.booleans?.includes(name) ? true : (authored ?? definition.defaults?.[name] ?? '');
  }
  return result;
}

/** The element the editor's Video and Embed block (`./video-embed`) is parsed from. */
export const VIDEO_EMBED_ELEMENT = 'nibleaf-video-embed';

/**
 * The Video/Embed block for a raw HTML range, or null to keep the range opaque.
 * Only an opaque block that is exactly one embed the reader reads qualifies: an
 * `<iframe>` or `<video>` the shared scanner accepts as closed in its own
 * Markdown block (`scanAuthoredEmbeds`, the reader's own rules), alone or as the
 * only child of a `<Frame>` that raw HTML widened to. Anything else (code, which
 * never becomes an opaque range; inline HTML; an unclosed or unreadable tag; a
 * raw table around it; a Frame with a caption expression) stays #573's opaque,
 * byte-for-byte block. The block keeps the range's source and saves it back
 * unchanged until the writer edits it.
 */
function videoEmbedPlaceholder(range: SourceRange, frame: { open: TagToken; close: TagToken } | undefined): string | null {
  if (!range.block) return null;
  let frameOpen = 0;
  let frameClose = range.source.length;
  let caption = '';
  if (frame) {
    const value = attributeValue(parseAttributes(frame.open.raw, frame.open.name), 'caption');
    if (typeof value === 'string' && value.startsWith('{')) return null;
    caption = typeof value === 'string' ? value : '';
    frameOpen = frame.open.end - range.start;
    frameClose = frame.close.start - range.start;
  } else if (range.name !== 'iframe' && range.name !== 'video') return null;
  const inner = range.source.slice(frameOpen, frameClose);
  const embeds = scanAuthoredEmbeds(inner);
  const embed = embeds[0];
  if (embeds.length !== 1 || !embed?.closed || inner.slice(0, embed.start).trim() || inner.slice(embed.end).trim()) return null;
  return `<${VIDEO_EMBED_ELEMENT} data-source="${encodeMdxSource(range.source)}" data-frame-open="${frameOpen}" data-frame-close="${frameClose}" data-caption="${escapeOpenerAttribute(caption)}"></${VIDEO_EMBED_ELEMENT}>`;
}

function placeholder(range: SourceRange): string {
  const tag = range.block ? 'nibleaf-mdx-opaque-block' : 'nibleaf-mdx-opaque-inline';
  // A broken component's mark: a callout keeps it where it starts the callout (callout.ts).
  const broken = range.broken ? ' data-broken=""' : '';
  return `<${tag} data-source="${encodeMdxSource(range.source)}" data-name="${escapeHtmlAttribute(range.name)}"${broken}></${tag}>`;
}

function metadataAttributes(
  open: TagToken,
  close: TagToken | undefined,
  definition: SupportedDefinition,
  layout: { open?: string; close: boolean } | null = null,
): string {
  // A tight layout (#606) is kept as a line break after the opener and before the closer.
  const sourceOpen = layout?.open === undefined ? open.raw : `${open.raw}\n`;
  const sourceClose = close && layout?.close ? `\n${close.raw}` : (close?.raw ?? '');
  const attrs = parseAttributes(open.raw, open.name);
  const effective = effectiveAttributes(definition, attrs);
  const known = definition.attrs
    .map((name) => {
      const value = effective[name];
      return value === '' || value === false || value == null ? '' : ` data-${name}="${escapeOpenerAttribute(String(value))}"`;
    })
    .join('');
  return ` data-mdx-source-open="${encodeMdxSource(sourceOpen)}" data-mdx-source-close="${encodeMdxSource(sourceClose)}" data-mdx-source-original="${encodeMdxSource(
    JSON.stringify(effective),
  )}"${known}`;
}

/** Where the line holding `at` starts. */
const lineStartOf = (source: string, at: number): number => {
  // Back to the nearest line break only: `lastIndexOf('\r')` on a page with none read the
  // whole page before every component.
  let start = at;
  while (start > 0 && source[start - 1] !== '\n' && source[start - 1] !== '\r') start -= 1;
  return start;
};
/**
 * Where the line holding `at` starts, when only indentation and quote markers come before
 * `at` on it (the tag starts its line); -1 otherwise. Reads back only over those, so a tag
 * in the middle of a long line is turned down at the first character that isn't one.
 */
const leadStartOf = (source: string, at: number): number => {
  let start = at;
  for (; start > 0; start -= 1) {
    const char = source[start - 1];
    if (char === '\n' || char === '\r') break;
    if (char !== ' ' && char !== '\t' && char !== '>') return -1;
  }
  return start;
};
/** A line that starts with a tag (after its quote markers): another component's, or HTML. */
const TAG_LINE = /^[ \t>]*</;
/** CommonMark URI and email autolinks are Markdown, even though they start with `<`. */
const AUTOLINK_LINE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: CommonMark URI autolinks exclude ASCII controls and spaces
  /^[ \t>]*<(?:[a-z][a-z\d+.-]{1,31}:[^<>\u0000-\u0020]*|[a-z\d.!#$%&'*+/=?^_`{|}~-]+@[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?)*)>/i;
/** The rest of a tag's line (whitespace only), its line break, and the line after it. */
const NEXT_LINE = /^[ \t]*(\r\n|\r|\n)([^\r\n]*)/;

/**
 * Whether a block component's children start on the line right after its opening tag
 * (`open`), and its closing tag is on the line right after them (`close`), with no
 * blank line between (#606). `open` is what goes after the opener's markup to keep
 * those children Markdown: a line break and the quote markers before the tag, so a
 * blank line in the same quote follows the tag. Both need a tag that starts its own
 * line, and an opener that ends its own.
 */
function childrenLayout(source: string, open: TagToken, close: TagToken | undefined): { open?: string; close: boolean } | null {
  const leadStart = leadStartOf(source, open.start);
  if (leadStart < 0) return null;
  const lead = source.slice(leadStart, open.start);
  // In a quote, an opener over several lines may end at a quote's `>` marker: left as it was.
  if (lead.includes('>') && /[\r\n]/.test(open.raw)) return null;
  const next = NEXT_LINE.exec(source.slice(open.end, open.end + 4096));
  if (!next) return null;
  const [, lineBreak = '\n', firstLine = ''] = next;
  const tightOpen = tightLine(firstLine);
  let tightClose = false;
  if (close) {
    // The line before the closing tag is read only once the tag is known to start its line.
    const closeLine = leadStartOf(source, close.start);
    if (closeLine > open.end) {
      const previousEnd = source[closeLine - 1] === '\n' && source[closeLine - 2] === '\r' ? closeLine - 2 : closeLine - 1;
      const previous = source.slice(lineStartOf(source, previousEnd), previousEnd);
      tightClose = tightLine(previous);
    }
  }
  if (!tightOpen && !tightClose) return null;
  // The quotes the tag is in: the children may open a quote of their own.
  const markers = lead.replace(/[ \t]+$/, '');
  return { open: tightOpen ? `${lineBreak}${markers}` : undefined, close: tightClose };
}

/** A component tag at the start of a line, read in place from `lastIndex` (sticky). */
const COMPONENT_TAG_LINE = /[ \t]*<\/?[A-Z]/y;

/**
 * Mask a fence the editor's Markdown parser reads, line by line, except a line
 * the reader reads as a component tag rather than code. markdown-it can open a
 * fence at a closer the reader reads inside a component (a blank line in the code
 * ended the HTML block it read the component's start as), and that fence runs on
 * past the component; hiding the component's closing tag would leave it unpaired.
 */
function maskFence(source: string, layout: MarkdownLayout, mask: Uint8Array, readerCode: Uint8Array, fence: Span): void {
  for (let line = lineOf(layout.lineStarts, fence.start); lineStart(layout, line) < fence.end; line++) {
    const start = lineStart(layout, line);
    const end = Math.min(lineStart(layout, line + 1), fence.end);
    COMPONENT_TAG_LINE.lastIndex = start;
    if (readerCode[start] === 1 || !COMPONENT_TAG_LINE.test(source)) mask.fill(1, start, end);
  }
}

/**
 * Converts MDX-only syntax into HTML that markdown-it/DOMParser can safely feed
 * to ProseMirror. Serializers restore the source metadata before persistence.
 */
function prepareMdxForEditor(source: string, blockTokens?: MarkdownBlockTokens): string {
  if (!source || (!source.includes('<') && !source.includes('{') && !/^\s*(?:import|export)\s/m.test(source))) return source;
  const readerCode = readerCodeMask(source);
  const mask = codeMask(source, readerCode);
  // Nothing inside code is ever replaced: code is found the way the Markdown
  // parser reads it, inside blockquotes and list items too.
  const layout = markdownLayout(source, blockTokens);
  for (const fence of layout.fenced) maskFence(source, layout, mask, readerCode, fence);
  const comments: Array<Span & { runsToEnd: boolean }> = [];
  const scanned = scanTags(source, mask, comments, layout.indented);
  for (const comment of comments) mask.fill(1, comment.start, comment.end);
  // Raw HTML read as indented code stays code, unless a component holds it.
  const inIndentedCode = (at: number) => layout.indented[at] === 1;
  const codeHtml = scanned.filter((token) => token.html && inIndentedCode(token.start));
  const tokens = scanned.filter((token) => !(token.html && inIndentedCode(token.start)));
  const pairs = tagPairs(tokens);
  classifyHtml(tokens, pairs);
  // A component holding a fence only the reader reads as one is kept whole, byte
  // for byte: the editor can't hold its children's layout (#589).
  const readerFences = blockTokens ? unreadFences(layout, readerCode) : [];
  let opaque = keepRawHtml(
    source,
    layout,
    tokens,
    pairs,
    [...unsupportedRanges(source, layout, tokens, pairs), ...brokenRanges(source, layout, tokens, pairs)],
    [
      ...readerFences,
      ...comments.map((comment) => ({ ...comment, inCode: inIndentedCode(comment.start), name: 'HTML comment' })),
      ...codeHtml
        .filter(
          (token) => !STRUCTURED_HTML.has(token.name) && !TABLE_HTML.has(token.name) && !COMPONENT_HTML.has(token.name) && !isEditorMarkup(token),
        )
        .map((token) => ({ start: token.start, end: token.end, inCode: true, name: token.name })),
    ],
  );
  // Where text that runs to the end of the page starts: see openComponentsRange.
  const runsToEnd = [
    layout.unclosedFence,
    ...comments.filter((comment) => comment.runsToEnd && !inIndentedCode(comment.start)).map((comment) => comment.start),
    ...tokens.filter((token) => token.runsToEnd).map((token) => token.start),
    ...readerFences.filter((span) => blank(layout, span.end, source.length)).map((span) => span.start),
  ].filter((start) => start >= 0);
  const openComponents = openComponentsRange(source, layout, tokens, pairs, opaque, runsToEnd);
  if (openComponents) opaque = outermostRanges([...opaque, openComponents]);

  // MDX ESM and standalone expressions are also explicit opaque nodes. Braces
  // inside JSX tags were consumed by scanTags and are excluded here.
  const tagSpans = tokens.filter((token) => !token.html || token.rawHtml).map((token) => ({ start: token.start, end: token.end }));
  const taken = spanIndex([...opaque, ...tagSpans]);
  // Any range starting before `end` that reaches past `start` overlaps [start, end).
  const sortedTaken = [...opaque, ...tagSpans].sort((a, b) => a.start - b.start);
  const reach: number[] = [];
  for (const range of sortedTaken) reach.push(Math.max(reach[reach.length - 1] ?? -1, range.end));
  const overlaps = (start: number, end: number) => {
    let low = 0;
    let high = sortedTaken.length - 1;
    let found = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if ((sortedTaken[middle]?.start ?? 0) < end) {
        found = middle;
        low = middle + 1;
      } else high = middle - 1;
    }
    return found >= 0 && (reach[found] ?? -1) > start;
  };
  const modules: SourceRange[] = [];
  let offset = 0;
  for (const lineWithBreak of source.match(/.*(?:\n|$)/g) ?? []) {
    if (!lineWithBreak) continue;
    const line = lineWithBreak.endsWith('\n') ? lineWithBreak.slice(0, -1) : lineWithBreak;
    if (!mask[offset] && /^\s*(?:import|export)\s/.test(line) && !overlaps(offset, offset + line.length)) {
      modules.push({ start: offset, end: offset + line.length, source: line, name: 'MDX module', block: true });
    }
    offset += lineWithBreak.length;
  }
  const inModule = spanIndex(modules);
  const expressions: SourceRange[] = [];
  const expressionEnd = expressionEnds(source);
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '{' || mask[i] || taken(i, i + 1) || inModule(i, i + 1)) continue;
    const end = expressionEnd(i);
    if (!end) continue;
    // A standalone expression owns any JSX nested inside it. Replace the whole
    // expression once, rather than exposing punctuation around smaller atoms.
    expressions.push({ start: i, end, source: source.slice(i, end), name: 'Expression', block: wholeLine(layout, i, end) });
    i = end - 1;
  }
  opaque = outermostRanges([...opaque, ...modules, ...expressions]);
  const strays = strayPartners(source, layout, tokens, pairs, opaque);
  if (strays.length > 0) opaque = outermostRanges([...opaque, ...strays]);

  // A Frame that raw HTML widened to, found by its opening tag (for the Video block).
  const tokenAt = new Map(tokens.map((token, index) => [token.start, index]));
  const frameOf = (range: SourceRange) => {
    const index = range.name === 'Frame' ? tokenAt.get(range.start) : undefined;
    const open = index === undefined ? undefined : tokens[index];
    const close = index === undefined ? undefined : tokens[pairs.get(index) ?? -1];
    return open && close && !open.closing && !open.selfClosing && !open.broken && close.end === range.end ? { open, close } : undefined;
  };
  const replacements: Array<{ start: number; end: number; value: string }> = opaque.map((range) => ({
    start: range.start,
    end: range.end,
    value: videoEmbedPlaceholder(range, frameOf(range)) ?? placeholder(range),
  }));
  const coveredByOpaque = spanIndex(opaque);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token || token.html || coveredByOpaque(token.start, token.start + 1)) continue;
    const element = HTML_ELEMENT_ALIASES.get(token.name);
    if (element) {
      // img is a void element: a stray closing tag has nothing to close.
      replacements.push({ start: token.start, end: token.end, value: token.closing ? '' : `<${element}${token.raw.slice(token.name.length + 1)}` });
      continue;
    }
    const definition = SUPPORTED_MDX_COMPONENTS[token.name.toLowerCase()];
    if (!definition) continue;
    if (token.closing) {
      const wrapper = definition.inline ? 'span' : 'div';
      replacements.push({ start: token.start, end: token.end, value: `</${wrapper}>` });
      continue;
    }
    const closeIndex = pairs.get(i);
    const close = closeIndex == null ? undefined : tokens[closeIndex];
    const wrapper = definition.inline ? 'span' : 'div';
    const marker = definition.calloutVariant
      ? ` data-callout="" data-variant="${escapeOpenerAttribute(
          definition.canonical === 'Callout'
            ? String(attributeValue(parseAttributes(token.raw, token.name), 'type') ?? definition.calloutVariant)
            : definition.calloutVariant,
        )}"`
      : ` data-mdx="${definition.canonical}"`;
    const layout = definition.inline || token.selfClosing ? null : childrenLayout(source, token, close);
    const open = `<${wrapper}${marker}${metadataAttributes(token, close, definition, layout)}>`;
    // Children on the very next line would be read as the raw text of the HTML block the
    // tag opens: a blank line there, in the same quote, has them read as Markdown (#606).
    replacements.push({ start: token.start, end: token.end, value: token.selfClosing ? `${open}</${wrapper}>` : `${open}${layout?.open ?? ''}` });
  }

  // From the end, skipping any replacement that overlaps one already taken; then
  // the page is assembled once, front to back.
  replacements.sort((a, b) => b.start - a.start || b.end - a.end);
  const chosen: typeof replacements = [];
  let lastStart = source.length + 1;
  for (const replacement of replacements) {
    if (replacement.end > lastStart) continue;
    chosen.push(replacement);
    lastStart = replacement.start;
  }
  const parts: string[] = [];
  let cursor = 0;
  for (const replacement of chosen.reverse()) {
    parts.push(source.slice(cursor, replacement.start), replacement.value);
    cursor = replacement.end;
  }
  parts.push(source.slice(cursor));
  return parts.join('');
}

/** Inventory unknown tags without treating them as a page-wide failure. */
export function findUnsupportedMdxComponents(source: string): string[] {
  const tokens = scanTags(source);
  const result: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const lower = token.name.toLowerCase();
    if (!SUPPORTED_MDX_COMPONENTS[lower] && !HTML_ELEMENT_ALIASES.has(token.name) && !seen.has(lower)) {
      seen.add(lower);
      result.push(token.name);
    }
  }
  return result;
}

export function sourceMetadataAttributes() {
  return {
    sourceOpen: {
      default: '',
      parseHTML: (element: HTMLElement) => decodeMdxSource(element.getAttribute('data-mdx-source-open')),
      rendered: false,
    },
    sourceClose: {
      default: '',
      parseHTML: (element: HTMLElement) => decodeMdxSource(element.getAttribute('data-mdx-source-close')),
      rendered: false,
    },
    sourceOriginal: {
      default: '',
      parseHTML: (element: HTMLElement) => decodeMdxSource(element.getAttribute('data-mdx-source-original')),
      rendered: false,
    },
  };
}

/** The line break `sourceOpen` ends with, and `sourceClose` starts with, where the
 *  children start right after the opening tag, and the closing tag right after them
 *  (#606). Kept in those values, so every other component's attributes stay as they were. */
const TIGHT_BREAK = '\n';
const isTightOpen = (node: PMNode): boolean => String(node.attrs.sourceOpen ?? '').endsWith(TIGHT_BREAK);
const isTightClose = (node: PMNode): boolean => String(node.attrs.sourceClose ?? '').startsWith(TIGHT_BREAK);

/** A component's opening tag as authored, without the line break that marks a tight layout. */
export const sourceOpeningTag = (node: PMNode): string => {
  const raw = String(node.attrs.sourceOpen ?? '');
  return isTightOpen(node) ? raw.slice(0, -TIGHT_BREAK.length) : raw;
};

const equalSourceValue = (left: unknown, right: unknown): boolean => String(left ?? '') === String(right ?? '');

/** Where an opening tag's end starts: its `>`, its `/>`, or a spaced `/ >` (#714), read
 *  back from the end; -1 when it doesn't end in `>`. */
function tagEndAt(raw: string): number {
  let at = raw.length - 1;
  while (at >= 0 && /\s/.test(raw[at] ?? '')) at--;
  if (raw[at] !== '>') return -1;
  let slash = at - 1;
  while (slash >= 0 && /\s/.test(raw[slash] ?? '')) slash--;
  return raw[slash] === '/' ? slash : at;
}

export function replaceOpeningAttribute(raw: string, componentName: string, name: string, value: unknown): string {
  const attrs = parseAttributes(raw, componentName);
  const existing = attrs.find((attr) => attr.name.toLowerCase() === name.toLowerCase());
  const remove = value == null || value === '' || value === false;
  if (existing) {
    const after = raw.slice(existing.end);
    // What follows may touch the attribute (`hidden title="Old"href="/docs"`): where
    // it starts another attribute, a space keeps the two apart.
    const separator = after === '' || /^[\s/>]/.test(after) ? '' : ' ';
    // A removed attribute takes the space before it along, so no double space is left;
    // unless what follows touches it, where that authored space (a line break, say) now
    // keeps the next attribute apart (#714).
    const before = raw.slice(0, existing.start);
    if (remove) return separator && /\s$/.test(before) ? `${before}${after}` : `${before.trimEnd()}${separator}${after}`;
    const rendered =
      value === true
        ? `${existing.name}${separator}`
        : `${existing.name}="${String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}"`;
    return `${raw.slice(0, existing.start)}${rendered}${after}`;
  }
  if (remove) return raw;
  const insertAt = tagEndAt(raw);
  const rendered =
    value === true ? name : `${name}="${String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}"`;
  return insertAt < 0 ? raw : `${raw.slice(0, insertAt)} ${rendered}${raw.slice(insertAt)}`;
}

/** Reuse an author's exact opener until a visually editable prop changes. */
export function preservedOpeningTag(node: PMNode, canonical: string, attrKeys: string[], selfClosing = false): string {
  const raw = sourceOpeningTag(node);
  if (!raw) {
    const attrs = attrKeys
      .map((key) => {
        const value = node.attrs[key];
        if (value == null || value === '' || value === false) return '';
        return value === true
          ? ` ${key}`
          : ` ${key}="${String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}"`;
      })
      .join('');
    return `<${canonical}${attrs}${selfClosing ? ' /' : ''}>`;
  }
  let original: Record<string, unknown> = {};
  try {
    original = JSON.parse(String(node.attrs.sourceOriginal ?? '')) as Record<string, unknown>;
  } catch {
    return raw;
  }
  if (attrKeys.every((key) => equalSourceValue(node.attrs[key], original[key]))) return raw;
  const sourceName = /^<([A-Za-z][\w.:-]*)/.exec(raw)?.[1] ?? canonical;
  return attrKeys.reduce(
    (opening, key) =>
      equalSourceValue(node.attrs[key], original[key]) ? opening : replaceOpeningAttribute(opening, sourceName, key, node.attrs[key]),
    raw,
  );
}

export const preservedClosingTag = (node: PMNode, canonical: string): string =>
  String(node.attrs.sourceClose ?? '').slice(isTightClose(node) ? TIGHT_BREAK.length : 0) || `</${canonical}>`;

function opaqueAttributes() {
  return {
    source: {
      default: '',
      parseHTML: (element: HTMLElement) => decodeMdxSource(element.getAttribute('data-source')),
      rendered: false,
    },
    name: { default: 'MDX', parseHTML: (element: HTMLElement) => element.getAttribute('data-name') ?? 'MDX', rendered: false },
  };
}

const opaqueHtml = (node: PMNode, inline: boolean): DOMOutputSpec => {
  const source = String(node.attrs.source ?? '');
  const name = String(node.attrs.name ?? 'MDX');
  const tag = inline ? 'span' : 'div';
  return [
    tag,
    mergeAttributes({
      class: inline ? 'pl-mdx-opaque-inline' : 'pl-mdx-opaque-block',
      'data-mdx-opaque': inline ? 'inline' : 'block',
      'data-name': name,
      title: translateFn('editor.opaqueMdx.tooltip', { name }),
      contenteditable: 'false',
    }),
    source.length > 180 ? `${source.slice(0, 177)}…` : source,
  ];
};

const installedMarkdownParsers = new WeakSet<object>();

const MdxOpaqueBlock = Node.create({
  name: 'mdxOpaqueBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes: opaqueAttributes,
  parseHTML: () => [{ tag: 'nibleaf-mdx-opaque-block' }],
  renderHTML: ({ node }) => opaqueHtml(node, false),
  addStorage: () => ({
    markdown: {
      serialize(state: SerializeState, node: PMNode) {
        writeBlockTag(state, node, String(node.attrs.source ?? ''));
      },
      parse: {
        setup(markdownit) {
          if (installedMarkdownParsers.has(markdownit)) return;
          const blockTokens: MarkdownBlockTokens = (src) => {
            const tokens: ReturnType<typeof markdownit.parse> = [];
            markdownit.block.parse(src, markdownit, {}, tokens);
            return tokens;
          };
          markdownit.core.ruler.before('normalize', 'nibleaf_mdx_source_roundtrip', (state) => {
            state.src = prepareMdxForEditor(state.src, blockTokens);
          });
          installedMarkdownParsers.add(markdownit);
        },
      },
    } satisfies MarkdownNodeSpec,
  }),
});

const MdxOpaqueInline = Node.create({
  name: 'mdxOpaqueInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: opaqueAttributes,
  parseHTML: () => [{ tag: 'nibleaf-mdx-opaque-inline' }],
  renderHTML: ({ node }) => opaqueHtml(node, true),
  addStorage: () => ({
    markdown: {
      serialize(state: SerializeState, node: PMNode) {
        state.write(String(node.attrs.source ?? ''));
      },
      parse: {},
    } satisfies MarkdownNodeSpec,
  }),
});

export const opaqueMdxNodes = [MdxOpaqueBlock, MdxOpaqueInline];
