import { translateFn } from '@nibleaf/i18n';
import { DOCUMENTATION_COMPONENTS, type DocumentationComponentDefinition } from '@nibleaf/shared/documentation-components';
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

export type SupportedDefinition = {
  canonical: string;
  attrs: string[];
  defaults?: Record<string, string | boolean>;
  inline?: boolean;
  calloutVariant?: string;
  /** Boolean attributes (switches and presence flags): an empty authored
   *  value (`defaultOpen=""`) means present, as it does in HTML. */
  booleans?: string[];
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

/** The block tokens of the editor's own Markdown parser (markdown-it). */
type MarkdownBlockTokens = (source: string) => ReadonlyArray<{ type: string; map: [number, number] | null }>;

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
    if (token.type === 'fence') layout.fenced.push({ start: at(first), end: at(last) });
    else if (token.type === 'code_block') layout.indented.fill(1, at(first), at(last));
    else if (token.type === 'paragraph_open') {
      layout.paragraphOfLine.fill(layout.paragraphs.length, first, last);
      layout.paragraphs.push([first, last]);
    }
  }
  return layout;
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
 * nearest component that does is kept whole. Returns null for code outside any component.
 */
function rawHtmlRange(
  layout: MarkdownLayout,
  raw: Span,
  inCode: boolean,
  containers: Container[],
  innermost: number,
): (Span & { name: string }) | null {
  let current: Span & { name: string } = { ...raw, name: '' };
  let around = innermost;
  let code = inCode;
  for (;;) {
    let outerHtml = -1;
    for (let index = around; index >= 0; index = containers[index]?.parent ?? -1) if (containers[index]?.html) outerHtml = index;
    const html = containers[outerHtml];
    if (html) {
      current = html;
      around = html.parent;
      code = false;
      continue;
    }
    if (!code && (!isBlockRange(layout, current) || isolated(layout, current))) break;
    const component = containers[around];
    if (!component) break;
    current = component;
    around = component.parent;
    code = false;
  }
  return code ? null : current;
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
}

interface SourceRange {
  start: number;
  end: number;
  source: string;
  name: string;
  block: boolean;
}

interface AttributeToken {
  name: string;
  start: number;
  end: number;
  value: string | boolean;
}

export const encodeMdxSource = (value: string): string => encodeURIComponent(value);

export const decodeMdxSource = (value: string | null | undefined): string => {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
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

/** True for positions in fenced or inline code, where JSX-looking text is literal. */
function codeMask(source: string): Uint8Array {
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
    if (fence || candidate) {
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

function balancedEnd(source: string, start: number, open: string, close: string): number | null {
  let depth = 0;
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
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === open) depth++;
    else if (char === close) {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return null;
}

/**
 * `balancedEnd(source, start, '{', '}')` for many starts, without rescanning. A
 * scan passes other `{`s outside quotes in the same state a scan of their own
 * would start in, so the stack of open braces tells where each of those closes,
 * or that it never does. A later expression the scan already passed is answered
 * from that; before, every `{` after an unclosed one rescanned the rest of the page.
 */
function expressionEnds(source: string): (start: number) => number | null {
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
function scanTags(source: string, mask = codeMask(source), comments?: Span[]): TagToken[] {
  const tokens: TagToken[] = [];
  const html = Boolean(comments);
  let lower: string | undefined;
  // Positions where a tag scan outside quotes and braces is known to reach the end
  // of the page with no `>`: from there it reads the same text the same way, so a
  // later scan that gets there stops at once. Without this, every `<` after an
  // unclosed tag rescanned the rest of the page. HTML and JSX quote differently,
  // so each has its own. A scan marks the positions it passed when it fails.
  const unclosable = { html: new Uint8Array(0), jsx: new Uint8Array(0) };
  const passed: number[] = [];
  // The first `</name` at or after the last search for it, or -1 for none.
  const closers = new Map<string, number>();
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '<' || mask[i]) continue;
    if (comments && source.startsWith('<!--', i)) {
      const close = source.indexOf('-->', i + 4);
      const end = close < 0 ? source.length : close + 3;
      comments.push({ start: i, end });
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
    let quote = '';
    let braces = 0;
    let escaped = false;
    // HTML attribute values have no backslash escapes (`title="Old\"` ends at that
    // quote); only JSX and the JavaScript inside `{…}` do.
    let escapes = true;
    const kind = isHtml ? 'html' : 'jsx';
    if (unclosable[kind].length === 0) unclosable[kind] = new Uint8Array(source.length + 1);
    const known = unclosable[kind];
    passed.length = 0;
    for (; cursor < source.length; cursor++) {
      const char = source[cursor] ?? '';
      if (quote) {
        if (escaped) escaped = false;
        else if (char === '\\' && escapes) escaped = true;
        else if (char === quote) quote = '';
        continue;
      }
      if (braces === 0) {
        if (known[cursor]) {
          cursor = source.length;
          break;
        }
        passed.push(cursor);
      }
      if (char === '"' || char === "'" || (char === '`' && (!isHtml || braces > 0))) {
        quote = char;
        escapes = !isHtml || braces > 0;
      } else if (char === '{') braces++;
      else if (char === '}') braces = Math.max(0, braces - 1);
      else if (char === '>' && braces === 0) break;
    }
    if (source[cursor] !== '>') {
      for (const position of passed) known[position] = 1;
      continue;
    }
    const raw = source.slice(i, cursor + 1);
    const selfClosing = !closing && /\/\s*>$/.test(raw);
    tokens.push({ start: i, end: cursor + 1, name, raw, closing, selfClosing, html: isHtml });
    i = cursor;
    if (isHtml && !closing && !selfClosing && RAW_TEXT_HTML.has(name)) {
      // A script's or style's content is text up to its closing tag.
      // A search that found no closer means none after any later tag either.
      lower ??= source.toLowerCase();
      let close = closers.get(name);
      if (close === undefined || (close !== -1 && close <= i)) {
        close = lower.indexOf(`</${name}`, i + 1);
        closers.set(name, close);
      }
      if (close > i) i = close - 1;
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
    ranges.push(sourceRange(source, layout, { start: token.start, end: close?.end ?? token.end }, token.name));
    if (!token.closing) coveredUntil = close?.end ?? token.end;
  }
  return ranges;
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

/** Add raw HTML (comments, and HTML read as indented code inside a component) to
 *  the opaque ranges, widening any raw HTML range to what keeps it byte for byte
 *  (see rawHtmlRange). Ranges inside a wider one are dropped. */
function keepRawHtml(
  source: string,
  layout: MarkdownLayout,
  tokens: TagToken[],
  pairs: Map<number, number>,
  opaque: SourceRange[],
  extra: Array<Span & { inCode: boolean; name: string }>,
): SourceRange[] {
  const list: Array<Omit<Container, 'parent'>> = [];
  for (const [openIndex, closeIndex] of pairs) {
    const open = tokens[openIndex];
    const close = tokens[closeIndex];
    if (!open || !close) continue;
    // Structured HTML elements, and supported components. The editor's own markup and
    // its components' lowercase names hold their children as components do.
    const html = open.html && !open.rawHtml && !open.editorMarkup && !COMPONENT_HTML.has(open.name);
    const component = open.html
      ? !open.rawHtml && !html
      : Boolean(SUPPORTED_MDX_COMPONENTS[open.name.toLowerCase()]) && !HTML_ELEMENT_ALIASES.has(open.name);
    if (html || component) list.push({ start: open.start, end: close.end, name: open.name, html });
  }
  const containers = containerTree(list);
  const covered = spanIndex(opaque);
  const candidates = [
    ...opaque.filter((range) => /^[a-z]/.test(range.name)).map((range) => ({ ...range, inCode: false })),
    ...extra.filter((span) => !covered(span.start, span.end)),
  ].sort((a, b) => a.start - b.start);
  const innermost = innermostContainers(containers, candidates);
  const kept = [...opaque];
  for (const [index, candidate] of candidates.entries()) {
    const range = rawHtmlRange(layout, candidate, candidate.inCode, containers, innermost[index] ?? -1);
    if (range) kept.push(sourceRange(source, layout, range, range.name || candidate.name));
  }
  return outermostRanges(kept);
}

function parseAttributes(raw: string, componentName: string): AttributeToken[] {
  const attrs: AttributeToken[] = [];
  let cursor = raw.indexOf(componentName) + componentName.length;
  const limit = raw.length - (raw.endsWith('/>') ? 2 : 1);
  while (cursor < limit) {
    while (/\s/.test(raw[cursor] ?? '')) cursor++;
    if (cursor >= limit) break;
    const start = cursor;
    while (cursor < limit && !/[\s=/>]/.test(raw[cursor] ?? '')) cursor++;
    const name = raw.slice(start, cursor);
    if (!name) break;
    while (/\s/.test(raw[cursor] ?? '')) cursor++;
    if (raw[cursor] !== '=') {
      attrs.push({ name, start, end: cursor, value: true });
      continue;
    }
    cursor++;
    while (/\s/.test(raw[cursor] ?? '')) cursor++;
    let value: string;
    const quote = raw[cursor];
    if (quote === '"' || quote === "'") {
      const valueStart = ++cursor;
      while (cursor < limit && raw[cursor] !== quote) cursor += raw[cursor] === '\\' ? 2 : 1;
      value = decodeAttributeValue(raw.slice(valueStart, cursor));
      cursor++;
    } else if (quote === '{') {
      const end = balancedEnd(raw, cursor, '{', '}') ?? limit;
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

function placeholder(range: SourceRange): string {
  const tag = range.block ? 'nibleaf-mdx-opaque-block' : 'nibleaf-mdx-opaque-inline';
  return `<${tag} data-source="${encodeMdxSource(range.source)}" data-name="${escapeHtmlAttribute(range.name)}"></${tag}>`;
}

function metadataAttributes(open: TagToken, close: TagToken | undefined, definition: SupportedDefinition): string {
  const attrs = parseAttributes(open.raw, open.name);
  const effective = effectiveAttributes(definition, attrs);
  const known = definition.attrs
    .map((name) => {
      const value = effective[name];
      return value === '' || value === false || value == null ? '' : ` data-${name}="${escapeHtmlAttribute(String(value))}"`;
    })
    .join('');
  return ` data-mdx-source-open="${encodeMdxSource(open.raw)}" data-mdx-source-close="${encodeMdxSource(close?.raw ?? '')}" data-mdx-source-original="${encodeMdxSource(
    JSON.stringify(effective),
  )}"${known}`;
}

/**
 * Converts MDX-only syntax into HTML that markdown-it/DOMParser can safely feed
 * to ProseMirror. Serializers restore the source metadata before persistence.
 */
function prepareMdxForEditor(source: string, blockTokens?: MarkdownBlockTokens): string {
  if (!source || (!source.includes('<') && !source.includes('{') && !/^\s*(?:import|export)\s/m.test(source))) return source;
  const mask = codeMask(source);
  // Nothing inside code is ever replaced: code is found the way the Markdown
  // parser reads it, inside blockquotes and list items too.
  const layout = markdownLayout(source, blockTokens);
  for (const fence of layout.fenced) mask.fill(1, fence.start, fence.end);
  const comments: Span[] = [];
  const scanned = scanTags(source, mask, comments);
  for (const comment of comments) mask.fill(1, comment.start, comment.end);
  // Raw HTML read as indented code stays code, unless a component holds it.
  const inIndentedCode = (at: number) => layout.indented[at] === 1;
  const codeHtml = scanned.filter((token) => token.html && inIndentedCode(token.start));
  const tokens = scanned.filter((token) => !(token.html && inIndentedCode(token.start)));
  const pairs = tagPairs(tokens);
  classifyHtml(tokens, pairs);
  let opaque = keepRawHtml(source, layout, tokens, pairs, unsupportedRanges(source, layout, tokens, pairs), [
    ...comments.map((comment) => ({ ...comment, inCode: inIndentedCode(comment.start), name: 'HTML comment' })),
    ...codeHtml
      .filter((token) => !STRUCTURED_HTML.has(token.name) && !TABLE_HTML.has(token.name) && !COMPONENT_HTML.has(token.name) && !isEditorMarkup(token))
      .map((token) => ({ start: token.start, end: token.end, inCode: true, name: token.name })),
  ]);

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

  const replacements: Array<{ start: number; end: number; value: string }> = opaque.map((range) => ({
    start: range.start,
    end: range.end,
    value: placeholder(range),
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
      ? ` data-callout="" data-variant="${escapeHtmlAttribute(
          definition.canonical === 'Callout'
            ? String(attributeValue(parseAttributes(token.raw, token.name), 'type') ?? definition.calloutVariant)
            : definition.calloutVariant,
        )}"`
      : ` data-mdx="${definition.canonical}"`;
    const open = `<${wrapper}${marker}${metadataAttributes(token, close, definition)}>`;
    replacements.push({ start: token.start, end: token.end, value: token.selfClosing ? `${open}</${wrapper}>` : open });
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

const equalSourceValue = (left: unknown, right: unknown): boolean => String(left ?? '') === String(right ?? '');

function replaceOpeningAttribute(raw: string, componentName: string, name: string, value: unknown): string {
  const attrs = parseAttributes(raw, componentName);
  const existing = attrs.find((attr) => attr.name.toLowerCase() === name.toLowerCase());
  const remove = value == null || value === '' || value === false;
  if (existing) {
    if (remove) return `${raw.slice(0, existing.start)}${raw.slice(existing.end)}`;
    const rendered =
      value === true
        ? existing.name
        : `${existing.name}="${String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}"`;
    return `${raw.slice(0, existing.start)}${rendered}${raw.slice(existing.end)}`;
  }
  if (remove) return raw;
  const insertAt = raw.search(/\/?>\s*$/);
  const rendered =
    value === true ? name : `${name}="${String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}"`;
  return insertAt < 0 ? raw : `${raw.slice(0, insertAt)} ${rendered}${raw.slice(insertAt)}`;
}

/** Reuse an author's exact opener until a visually editable prop changes. */
export function preservedOpeningTag(node: PMNode, canonical: string, attrKeys: string[], selfClosing = false): string {
  const raw = String(node.attrs.sourceOpen ?? '');
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

export const preservedClosingTag = (node: PMNode, canonical: string): string => String(node.attrs.sourceClose ?? '') || `</${canonical}>`;

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
