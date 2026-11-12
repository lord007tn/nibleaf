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

/** Lowercase HTML elements the editor has no node for. Its HTML parser drops them
 *  (and often their content), so they load as opaque blocks that save back as
 *  written, like unknown components. Elements it does structure (images, links,
 *  tables, lists, paragraphs) are not listed and keep their current handling. */
const RAW_HTML_ELEMENTS: ReadonlySet<string> = new Set([
  'iframe',
  'video',
  'audio',
  'source',
  'track',
  'object',
  'embed',
  'param',
  'picture',
  'details',
  'summary',
  'svg',
  'canvas',
  'form',
  'input',
  'select',
  'option',
  'textarea',
  'label',
  'div',
  'span',
]);

/** Markers of the editor's own HTML for the nodes it structures (div[data-callout],
 *  div[data-mdx], span[data-mdx]): such a tag is parsed as before, never kept raw. */
const EDITOR_MARKUP = /\sdata-(?:mdx|callout)[\s=/>]/;

const isRawHtml = (token: TagToken): boolean => token.html && !token.editorMarkup && RAW_HTML_ELEMENTS.has(token.name);

/** The block tokens of the editor's own Markdown parser (markdown-it), used to find code. */
type MarkdownBlockTokens = (source: string) => ReadonlyArray<{ type: string; map: [number, number] | null }>;

interface Span {
  start: number;
  end: number;
}

/** Fenced and indented code blocks as the editor's Markdown parser reads them, in
 *  every container (blockquotes, list items), as offsets into `source`. */
function markdownCodeRanges(source: string, blockTokens: MarkdownBlockTokens | undefined): { fenced: Span[]; indented: Span[] } {
  const result = { fenced: [] as Span[], indented: [] as Span[] };
  if (!blockTokens) return result;
  // markdown-it reads `\r\n` and `\r` as one line break each, as this does.
  const lineStarts = [0];
  const breaks = /\r\n?|\n/g;
  for (let match = breaks.exec(source); match; match = breaks.exec(source)) lineStarts.push(match.index + match[0].length);
  for (const token of blockTokens(source.replace(/\r\n?/g, '\n'))) {
    if (!token.map || (token.type !== 'fence' && token.type !== 'code_block')) continue;
    const span = { start: lineStarts[token.map[0]] ?? source.length, end: lineStarts[token.map[1]] ?? source.length };
    (token.type === 'fence' ? result.fenced : result.indented).push(span);
  }
  return result;
}

/** `<!-- … -->` comments outside code. */
function htmlComments(source: string, mask: Uint8Array): Span[] {
  const comments: Span[] = [];
  for (let i = source.indexOf('<!--'); i >= 0; i = source.indexOf('<!--', i + 1)) {
    if (mask[i]) continue;
    const close = source.indexOf('-->', i + 4);
    if (close < 0) break;
    comments.push({ start: i, end: close + 3 });
    i = close + 2;
  }
  return comments;
}

const lineBounds = (source: string, at: number): Span => {
  const end = source.indexOf('\n', at);
  return { start: source.lastIndexOf('\n', at - 1) + 1, end: end < 0 ? source.length : end };
};

/** A range written at the start of its own lines with a blank line (or the document
 *  edge) on each side: the layout the editor writes a component's children in, so
 *  an opaque block there saves back byte for byte. */
function isolated(source: string, range: Span): boolean {
  const first = lineBounds(source, range.start);
  const last = lineBounds(source, range.end);
  if (first.start !== range.start || source.slice(range.end, last.end).trim() !== '') return false;
  const before = first.start === 0 || source.slice(lineBounds(source, first.start - 1).start, first.start).trim() === '';
  const after = last.end >= source.length || source.slice(last.end, lineBounds(source, last.end + 1).end).trim() === '';
  return before && after;
}

/**
 * Where raw HTML must be kept as one opaque range. Inside an HTML element the
 * editor structures (a raw `<table>`, `<p>`), the outermost such element is kept
 * whole: the editor would otherwise rewrite it in its own HTML. Inside a supported
 * component, raw HTML stays a child when it is inline or sits in the component's
 * usual block layout; otherwise (an indented block, or read as indented code) the
 * nearest component that does is kept whole. Returns null for code outside any component.
 */
function rawHtmlRange(
  source: string,
  raw: Span,
  inCode: boolean,
  containers: Array<Span & { name: string; html: boolean }>,
): (Span & { name: string }) | null {
  let current: Span & { name: string } = { ...raw, name: '' };
  let code = inCode;
  const encloses = (outer: Span, inner: Span) =>
    outer.start <= inner.start && outer.end >= inner.end && (outer.start !== inner.start || outer.end !== inner.end);
  for (;;) {
    const html = containers.filter((container) => container.html && encloses(container, current)).sort((a, b) => a.start - b.start)[0];
    if (html) {
      current = html;
      code = false;
      continue;
    }
    const block = source.slice(current.start, current.end).includes('\n') || isWholeLine(source, current.start, current.end);
    if (!code && (!block || isolated(source, current))) break;
    const component = containers.filter((container) => !container.html && encloses(container, current)).sort((a, b) => b.start - a.start)[0];
    if (!component) break;
    current = component;
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

/** Scan for JSX component tags and, with `html`, lowercase HTML tags too. */
function scanTags(source: string, mask = codeMask(source), html = false): TagToken[] {
  const tokens: TagToken[] = [];
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '<' || mask[i]) continue;
    let cursor = i + 1;
    const closing = source[cursor] === '/';
    if (closing) cursor++;
    const rest = source.slice(cursor);
    const nameMatch = /^[A-Z][A-Za-z0-9_.:-]*/.exec(rest) ?? (html ? /^[a-z][a-z0-9]*/.exec(rest) : null);
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
    for (; cursor < source.length; cursor++) {
      const char = source[cursor] ?? '';
      if (quote) {
        if (escaped) escaped = false;
        else if (char === '\\' && escapes) escaped = true;
        else if (char === quote) quote = '';
        continue;
      }
      if (char === '"' || char === "'" || (char === '`' && (!isHtml || braces > 0))) {
        quote = char;
        escapes = !isHtml || braces > 0;
      } else if (char === '{') braces++;
      else if (char === '}') braces = Math.max(0, braces - 1);
      else if (char === '>' && braces === 0) break;
    }
    if (source[cursor] !== '>') continue;
    const raw = source.slice(i, cursor + 1);
    tokens.push({ start: i, end: cursor + 1, name, raw, closing, selfClosing: !closing && /\/\s*>$/.test(raw), html: isHtml });
    i = cursor;
  }
  return tokens;
}

function tagPairs(tokens: TagToken[]): Map<number, number> {
  const pairs = new Map<number, number>();
  const stack: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;
    if (!token.closing && !token.selfClosing) {
      stack.push(i);
      continue;
    }
    if (!token.closing) continue;
    for (let s = stack.length - 1; s >= 0; s--) {
      const openIndex = stack[s];
      const open = openIndex == null ? undefined : tokens[openIndex];
      if (open?.name === token.name) {
        pairs.set(openIndex as number, i);
        stack.splice(s, 1);
        break;
      }
    }
  }
  return pairs;
}

const isWholeLine = (source: string, start: number, end: number): boolean => {
  const lineStart = source.lastIndexOf('\n', start - 1) + 1;
  const nextNewline = source.indexOf('\n', end);
  const lineEnd = nextNewline < 0 ? source.length : nextNewline;
  return source.slice(lineStart, start).trim() === '' && source.slice(end, lineEnd).trim() === '';
};

function unsupportedRanges(source: string, tokens: TagToken[], pairs: Map<number, number>): SourceRange[] {
  const ranges: SourceRange[] = [];
  let coveredUntil = -1;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token || token.start < coveredUntil) continue;
    if (token.html ? !isRawHtml(token) : SUPPORTED_MDX_COMPONENTS[token.name.toLowerCase()] || HTML_ELEMENT_ALIASES.has(token.name)) continue;
    if (token.closing) {
      ranges.push({ start: token.start, end: token.end, source: token.raw, name: token.name, block: isWholeLine(source, token.start, token.end) });
      continue;
    }
    const closeIndex = pairs.get(i);
    const close = closeIndex == null ? undefined : tokens[closeIndex];
    const end = close?.end ?? token.end;
    ranges.push({
      start: token.start,
      end,
      source: source.slice(token.start, end),
      name: token.name,
      block: source.slice(token.start, end).includes('\n') || isWholeLine(source, token.start, end),
    });
    coveredUntil = end;
  }
  return ranges;
}

const sourceRange = (source: string, span: Span, name: string): SourceRange => {
  const text = source.slice(span.start, span.end);
  return { ...span, source: text, name, block: text.includes('\n') || isWholeLine(source, span.start, span.end) };
};

/** Add raw HTML (comments, and HTML read as indented code inside a component) to
 *  the opaque ranges, widening any raw HTML range to what keeps it byte for byte
 *  (see rawHtmlRange). Ranges inside a wider one are dropped. */
function keepRawHtml(
  source: string,
  tokens: TagToken[],
  pairs: Map<number, number>,
  opaque: SourceRange[],
  extra: Array<Span & { inCode: boolean }>,
): SourceRange[] {
  const containers: Array<Span & { name: string; html: boolean }> = [];
  for (const [openIndex, closeIndex] of pairs) {
    const open = tokens[openIndex];
    const close = tokens[closeIndex];
    if (!open || !close) continue;
    const container = open.html
      ? !open.editorMarkup && !RAW_HTML_ELEMENTS.has(open.name)
      : Boolean(SUPPORTED_MDX_COMPONENTS[open.name.toLowerCase()]) && !HTML_ELEMENT_ALIASES.has(open.name);
    if (container) containers.push({ start: open.start, end: close.end, name: open.name, html: open.html });
  }
  const covered = (span: Span) => opaque.some((range) => range.start <= span.start && range.end >= span.end);
  const candidates = [
    ...opaque.filter((range) => /^[a-z]/.test(range.name)).map((range) => ({ ...range, inCode: false })),
    ...extra.filter((span) => !covered(span)),
  ];
  const kept = [...opaque];
  for (const candidate of candidates) {
    const range = rawHtmlRange(source, candidate, candidate.inCode, containers);
    if (range) kept.push(sourceRange(source, range, range.name || 'HTML comment'));
  }
  const unique = kept.filter((range, index) => kept.findIndex((other) => other.start === range.start && other.end === range.end) === index);
  return unique.filter((range) => !unique.some((other) => other !== range && other.start <= range.start && other.end >= range.end));
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
  // Nothing inside code is ever replaced: fenced code is found the way the
  // Markdown parser reads it, inside blockquotes and list items too.
  const code = markdownCodeRanges(source, blockTokens);
  for (const fence of code.fenced) mask.fill(1, fence.start, fence.end);
  const inIndentedCode = (at: number) => code.indented.some((range) => at >= range.start && at < range.end);
  const comments = htmlComments(source, mask);
  for (const comment of comments) mask.fill(1, comment.start, comment.end);
  const scanned = scanTags(source, mask, true);
  // Raw HTML read as indented code stays code, unless a component holds it.
  const codeHtml = scanned.filter((token) => token.html && inIndentedCode(token.start));
  const tokens = scanned.filter((token) => !(token.html && inIndentedCode(token.start)));
  const pairs = tagPairs(tokens);
  for (const [index, token] of tokens.entries()) {
    if (!token.html || token.closing || !EDITOR_MARKUP.test(token.raw)) continue;
    token.editorMarkup = true;
    const close = tokens[pairs.get(index) ?? -1];
    if (close) close.editorMarkup = true;
  }
  let opaque = keepRawHtml(source, tokens, pairs, unsupportedRanges(source, tokens, pairs), [
    ...comments.map((comment) => ({ ...comment, inCode: inIndentedCode(comment.start) })),
    ...codeHtml
      .filter((token) => isRawHtml(token) && !EDITOR_MARKUP.test(token.raw))
      .map((token) => ({ start: token.start, end: token.end, inCode: true })),
  ]);

  // MDX ESM and standalone expressions are also explicit opaque nodes. Braces
  // inside JSX tags were consumed by scanTags and are excluded here.
  const occupied = [...opaque, ...tokens.filter((token) => !token.html || isRawHtml(token)).map((token) => ({ start: token.start, end: token.end }))];
  const overlaps = (start: number, end: number) => occupied.some((range) => start < range.end && end > range.start);
  const containsPosition = (position: number) => occupied.some((range) => position >= range.start && position < range.end);
  let offset = 0;
  for (const lineWithBreak of source.match(/.*(?:\n|$)/g) ?? []) {
    if (!lineWithBreak) continue;
    const line = lineWithBreak.endsWith('\n') ? lineWithBreak.slice(0, -1) : lineWithBreak;
    if (!mask[offset] && /^\s*(?:import|export)\s/.test(line) && !overlaps(offset, offset + line.length)) {
      const moduleRange = { start: offset, end: offset + line.length, source: line, name: 'MDX module', block: true };
      opaque.push(moduleRange);
      occupied.push(moduleRange);
    }
    offset += lineWithBreak.length;
  }
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '{' || mask[i] || containsPosition(i)) continue;
    const end = balancedEnd(source, i, '{', '}');
    if (!end) continue;
    // A standalone expression owns any JSX nested inside it. Replace the whole
    // expression once, rather than exposing punctuation around smaller atoms.
    opaque = opaque.filter((range) => !(range.start >= i && range.end <= end));
    opaque.push({ start: i, end, source: source.slice(i, end), name: 'Expression', block: isWholeLine(source, i, end) });
    occupied.push({ start: i, end });
    i = end - 1;
  }

  const replacements: Array<{ start: number; end: number; value: string }> = opaque.map((range) => ({
    start: range.start,
    end: range.end,
    value: placeholder(range),
  }));
  const opaqueCoverage = (start: number) => opaque.some((range) => start >= range.start && start < range.end);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token || token.html || opaqueCoverage(token.start)) continue;
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

  replacements.sort((a, b) => b.start - a.start || b.end - a.end);
  let output = source;
  let lastStart = source.length + 1;
  for (const replacement of replacements) {
    if (replacement.end > lastStart) continue;
    output = `${output.slice(0, replacement.start)}${replacement.value}${output.slice(replacement.end)}`;
    lastStart = replacement.start;
  }
  return output;
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
