import MarkdownIt from 'markdown-it';
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs';
import type Token from 'markdown-it/lib/token.mjs';
import { type DefaultTreeAdapterTypes, parseFragment } from 'parse5';
import { readerSanitizeSchema } from './reader-sanitize';

const ACTIVE_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed']);
const RAW_TEXT_TAGS = new Set(['textarea', 'title', 'xmp', 'noembed', 'noframes', 'plaintext', 'noscript']);
const dangerousUrl = (value: string): boolean => {
  const address = Array.from(value.toLowerCase())
    .filter((character) => character.charCodeAt(0) > 32 && character.charCodeAt(0) !== 127)
    .join('');
  return address.startsWith('javascript:') || address.startsWith('vbscript:') || address.startsWith('data:');
};

// The reader's hast-util-sanitize protocol check, using its actual schema.
const readerAllowsUrl = (value: string, property: string): boolean => {
  const protocols = readerSanitizeSchema.protocols?.[property];
  if (!protocols?.length) return true;
  const colon = value.indexOf(':');
  if (
    colon < 0 ||
    ['/', '?', '#'].some((delimiter) => {
      const at = value.indexOf(delimiter);
      return at >= 0 && at < colon;
    })
  )
    return true;
  return protocols.some((protocol) => value.slice(0, colon) === protocol);
};

// Only short, unambiguous ordinary labels bypass href-only protocols. Images,
// references, escapes, code and long/nested ambiguity go through the parser.
const isPlainLinkLabel = (source: string, end: number): boolean => {
  let depth = 1;
  for (let at = end - 1; at >= Math.max(0, end - 128); at--) {
    const character = source[at];
    if (character === '\\' || character === '`') return false;
    if (character === ']') depth++;
    if (character === '[') {
      if (source[at - 1] === '\\') return false;
      if (--depth === 0) return source[at - 1] !== '!';
    }
  }
  return false;
};

/** Conservative linear preflight, not an HTML filter. A positive result is
 * always checked by the real Markdown/HTML parsers below. Ordinary formatting
 * tags and http(s)/relative links do not need that work. */
export const mayHaveActiveExportHtml = (source: string): boolean => {
  const outside = /[<&\]]|\bon/gi;
  const inside = /[<>&:"'\]]|\bon/gi;
  let cursor = 0;
  let inTag = false;
  let quote = '';
  for (;;) {
    const candidates = inTag ? inside : outside;
    candidates.lastIndex = cursor;
    const match = candidates.exec(source);
    if (!match) break;
    cursor = candidates.lastIndex;
    const at = match.index;
    const character = source[at];
    if (character === '<') {
      let end = at + 1;
      while (source[end] === '/' || source[end] === ' ' || source[end] === '\t' || source[end] === '\n' || source[end] === '\r') end++;
      const start = end;
      while (end < source.length) {
        const code = source.charCodeAt(end) | 32;
        if (code < 97 || code > 122) break;
        end++;
      }
      const name = source.slice(start, end).toLowerCase();
      if (!inTag && name && (start === at + 1 || (start === at + 2 && source[at + 1] === '/'))) {
        inTag = true;
        quote = '';
      }
      if (ACTIVE_TAGS.has(name) || (source[end] === ':' && name !== 'http' && name !== 'https')) return true;
      cursor = end;
    } else if (character === '>') {
      if (!quote) inTag = false;
    } else if (character === '"' || character === "'") {
      if (inTag && (!quote || quote === character)) quote = quote ? '' : character;
    } else if (character === '&') {
      // Numeric references can encode any part of a scheme. Named colon and
      // whitespace references can hide its delimiter or split its letters.
      const entity = source.slice(at + 1, at + 9).toLowerCase();
      if (entity.startsWith('#') || entity.startsWith('colon;') || entity.startsWith('tab;') || entity.startsWith('newline;')) return true;
    } else if (character === ']') {
      if (source[at + 1] !== '(' && source[at + 1] !== ':') continue;
      let start = at + 2;
      while (source[start] === ' ' || source[start] === '\t' || source[start] === '\n' || source[start] === '\r') start++;
      if (source[start] === '<') start++;
      let end = start;
      while (end < source.length && !'/?#()<>[] \t\n\r'.includes(source[end] ?? '') && source[end] !== ':') end++;
      if (source[end] === ':') {
        const scheme = source.slice(start, end).toLowerCase();
        if (
          scheme !== 'http' &&
          scheme !== 'https' &&
          !(source[at + 1] === '(' && readerAllowsUrl(`${scheme}:`, 'href') && isPlainLinkLabel(source, at))
        )
          return true;
      }
    } else if (character === ':') {
      if (!inTag || source[at - 1] === ']') continue; // Destinations were checked at their opener.
      let start = at;
      while (start > 0) {
        const code = source.charCodeAt(start - 1) | 32;
        if (
          (code >= 97 && code <= 122) ||
          (code >= 48 && code <= 57) ||
          source.charCodeAt(start - 1) <= 32 ||
          source.charCodeAt(start - 1) === 127 ||
          '+-.'.includes(source[start - 1] ?? '')
        )
          start--;
        else break;
      }
      if (dangerousUrl(source.slice(start, at + 1))) return true;
    } else {
      // Only this branch handles the case-insensitive `on` candidate. Skip its
      // remaining letters once, so repeated prefixes cannot cause rescanning.
      const previous = source.charCodeAt(at - 1) | 32;
      if (
        (previous >= 97 && previous <= 122) ||
        (previous >= 48 && previous <= 57) ||
        source[at - 1] === '_' ||
        source[at - 1] === '.' ||
        source[at - 1] === '-'
      )
        continue;
      if (inTag && !quote) return true;
      let end = at + 2;
      while (end < source.length) {
        const code = source.charCodeAt(end) | 32;
        if (code < 97 || code > 122) break;
        end++;
      }
      cursor = end;
      while (source[end] === ' ' || source[end] === '\t' || source[end] === '\r' || source[end] === '\n') end++;
      if (source[end] === '=') return true;
    }
  }
  return false;
};

interface Destination {
  source: string;
  from: number;
  to: number;
  wholeSource: boolean;
}
interface InlineLocation {
  state: StateInline;
  pos: number;
  labelEnd: number;
}
interface RenderSpan {
  token: Token;
  from: number;
  to: number;
  positions: number[];
}

interface ParseContext {
  wholeSource: boolean;
  destinations: Map<string, Map<number, Destination>>;
  latest?: Destination;
}
// The parser configuration and hooks are immutable between synchronous calls.
// Per-document positions remain in the parse context and weak token maps.
let parsing: ParseContext | undefined;
const markdown = new MarkdownIt({ html: true });
markdown.core.ruler.after('block', 'export_url_positions', () => {
  if (parsing) parsing.wholeSource = false;
});
const boundaryTokens = new WeakSet<Token>();
const BaseBlockState = markdown.block.State;
markdown.block.State = class extends BaseBlockState {
  override push(type: string, tag: string, nesting: Token['nesting']): Token {
    const token = super.push(type, tag, nesting);
    if (type !== 'html_block' || this.line >= this.lineMax || this.isEmpty(this.line)) return token;
    // html_block has advanced line, but its container state is still in
    // scope. Ask the paragraph rules whether the next block interrupts text.
    const parent = this.parentType;
    this.parentType = 'paragraph';
    const indented = (this.sCount[this.line] ?? 0) - this.blkIndent > 3;
    const terminates = !indented && this.md.block.ruler.getRules('paragraph').some((rule) => rule(this, this.line, this.lineMax, true));
    this.parentType = parent;
    const next = this.src.slice((this.bMarks[this.line] ?? 0) + (this.tShift[this.line] ?? 0), this.eMarks[this.line]).trim();
    // A dash-only rule would become a setext underline after HTML is text.
    const setext = next.length > 0 && Array.from(next).every((character) => character === '-');
    if (!terminates || setext) boundaryTokens.add(token);
    return token;
  }
};
const locations = new WeakMap<Token, InlineLocation>();
const BaseState = markdown.inline.State;
markdown.inline.State = class extends BaseState {
  override push(type: string, tag: string, nesting: Token['nesting']): Token {
    const token = super.push(type, tag, nesting);
    if (type === 'html_inline' || type === 'link_open' || type === 'image')
      locations.set(token, { state: this, pos: this.pos, labelEnd: this.posMax });
    return token;
  }
};
const parseDestination = markdown.helpers.parseLinkDestination;
markdown.helpers.parseLinkDestination = (text: string, from: number, max: number) => {
  const result = parseDestination(text, from, max);
  if (result.ok && parsing) {
    parsing.latest = { source: text, from, to: result.pos, wholeSource: parsing.wholeSource };
    let entries = parsing.destinations.get(text);
    if (!entries) {
      entries = new Map();
      parsing.destinations.set(text, entries);
    }
    entries.set(from, parsing.latest);
  }
  return result;
};

/** One Markdown parse, using the guard's renderer. Only unsafe rendered spans
 * are edited; original prose, MDX policy and all code tokens stay untouched. */
export const escapeDisallowedExportHtml = (source: string): string => {
  if (!mayHaveActiveExportHtml(source)) return source;
  const input = source.replaceAll('\r\n', '\n').replaceAll('\r', '\n').replaceAll('\0', '\uFFFD');
  const urlDecisions = new Map<string, Map<string, boolean>>();
  const allowsUrl = (value: string, property: string) => {
    let decisions = urlDecisions.get(property);
    if (!decisions) {
      decisions = new Map();
      urlDecisions.set(property, decisions);
    }
    let allowed = decisions.get(value);
    if (allowed === undefined) {
      allowed = readerAllowsUrl(value, property);
      decisions.set(value, allowed);
    }
    return allowed;
  };
  const context: ParseContext = { wholeSource: true, destinations: new Map() };
  const destinations = context.destinations;
  const referenceDestinations = new Map<string, Destination>();
  const references = new Proxy<Record<string, { href: string; title: string }>>(
    {},
    {
      set(target, key, value: { href: string; title: string }) {
        if (typeof key !== 'string') return false;
        target[key] = value;
        if (context.latest) referenceDestinations.set(key, context.latest);
        return true;
      },
    },
  );
  const env = { references };
  const previous = parsing;
  parsing = context;
  let tokens: Token[];
  try {
    tokens = markdown.parse(input, env);
  } finally {
    parsing = previous;
  }
  // Candidates in actual code tokens need no source maps or HTML render.
  // This uses the same one Markdown parse as the safety pass below.
  const inspect = [...tokens];
  let needsHtml = false;
  while (inspect.length) {
    const token = inspect.pop();
    if (!token) continue;
    if ((token.type === 'html_block' || token.type === 'html_inline') && mayHaveActiveExportHtml(token.content)) {
      needsHtml = true;
      break;
    }
    if (token.type === 'link_open' || token.type === 'image') {
      const property = token.type === 'image' ? 'src' : 'href';
      if (!allowsUrl(token.attrGet(property) ?? '', property)) {
        needsHtml = true;
        break;
      }
    }
    if (token.children) for (const child of token.children) inspect.push(child);
  }
  if (!needsHtml) return source;
  const offsets: number[] = [];
  for (let at = 0; input !== source && at < source.length; at++) {
    offsets.push(at);
    const character = source[at];
    if (character === '\r' && source[at + 1] === '\n') at++;
  }
  if (input !== source) offsets.push(source.length);
  const originalOffset = (at: number) => (input === source ? Math.min(at, source.length) : (offsets[at] ?? source.length));
  const lines = input.split('\n');
  const lineStarts = [0];
  for (const line of lines) lineStarts.push((lineStarts.at(-1) ?? 0) + line.length + 1);
  const lineCursors = new Uint32Array(lines.length);
  let tableDepth = 0;
  const tableLines = new Map<number, { text: string; positions: number[] }>();
  const positionsFor = (content: string, map: [number, number]): number[] => {
    const positions: number[] = [];
    let lineAt = map[0];
    for (const line of content.split('\n')) {
      const raw = lines[lineAt] ?? '';
      let row = tableLines.get(lineAt);
      if (tableDepth && !row && raw.includes('\\|')) {
        const text: string[] = [];
        const positions: number[] = [];
        for (let at = 0; at < raw.length; at++) {
          if (raw[at] === '\\' && raw[at + 1] === '|') continue;
          text.push(raw[at] ?? '');
          positions.push((lineStarts[lineAt] ?? 0) + at);
        }
        positions.push((lineStarts[lineAt] ?? 0) + raw.length);
        row = { text: text.join(''), positions };
        tableLines.set(lineAt, row);
      }
      const original = tableDepth && row ? row.text : raw;
      const sourceAt = (at: number) => originalOffset(tableDepth && row ? (row.positions[at] ?? input.length) : (lineStarts[lineAt] ?? 0) + at);
      let leading = 0;
      while (line[leading] === ' ' || line[leading] === '\t') leading++;
      let cursor = original.indexOf(line, lineCursors[lineAt] ?? 0);
      if (cursor >= 0) {
        for (let at = 0; at < line.length; at++) positions.push(sourceAt(cursor + at));
        cursor += line.length;
      } else {
        cursor = lineCursors[lineAt] ?? 0;
        const tail = original.indexOf(line.slice(leading), cursor);
        let leadingAt = tail >= 0 ? tail : cursor;
        let columns = leading;
        while (leadingAt > cursor && columns > 0 && [' ', '\t'].includes(original[leadingAt - 1] ?? '')) {
          columns -= original[leadingAt - 1] === '\t' ? 4 : 1;
          leadingAt--;
        }
        if (tail >= 0) cursor = tail;
        for (let at = 0; at < line.length; at++) {
          if (at < leading) {
            positions.push(sourceAt(leadingAt));
            continue;
          }
          const found = original.indexOf(line[at] ?? '', cursor);
          if (found >= 0) cursor = found;
          positions.push(sourceAt(cursor));
          if (found >= 0) cursor++;
        }
      }
      lineCursors[lineAt] = cursor;
      positions.push(sourceAt(original.length));
      lineAt++;
    }
    positions.length = content.length;
    return positions;
  };

  const chunks: string[] = [];
  const spans: RenderSpan[] = [];
  let length = 0;
  let map: [number, number] = [0, lines.length];
  // This is markdown-it's render/renderInline loop with output offsets recorded.
  const frames = [{ tokens, at: 0, positions: [] as number[] }];
  while (frames.length) {
    const frame = frames.at(-1);
    if (!frame) break;
    const token = frame.tokens[frame.at++];
    if (!token) {
      frames.pop();
      continue;
    }
    if (token.type === 'table_open') tableDepth++;
    if (token.type === 'table_close') tableDepth--;
    if (token.map) map = token.map;
    if (token.type === 'inline') {
      frames.push({ tokens: token.children ?? [], at: 0, positions: positionsFor(token.content, token.map ?? map) });
      continue;
    }
    const rule = markdown.renderer.rules[token.type];
    const attributes = token.attrs;
    // Reference destinations/titles may be shared by many links. Their values
    // cannot change HTML parsing, so do not expand them in the analysis render.
    if (token.type === 'link_open' || token.type === 'image')
      token.attrs = attributes?.map(([name, value]) => [name, name === 'href' || name === 'src' ? '#' : name === 'title' ? '' : value]) ?? null;
    const value = rule
      ? rule(frame.tokens, frame.at - 1, markdown.options, env, markdown.renderer)
      : markdown.renderer.renderToken(frame.tokens, frame.at - 1, markdown.options);
    token.attrs = attributes;
    let positions = frame.positions;
    if (token.type === 'html_block') positions = positionsFor(token.content, token.map ?? map);
    if (token.type === 'html_block' || token.type === 'html_inline' || token.type === 'link_open' || token.type === 'image')
      spans.push({ token, from: length, to: length + value.length, positions });
    chunks.push(value);
    length += value.length;
  }
  const html = chunks.join('');
  const owners = new Int32Array(html.length);
  for (const [index, span] of spans.entries()) owners.fill(index + 1, span.from, span.to);
  const unsafe = new Int32Array(html.length + 1);
  const mark = (from: number, to: number) => {
    unsafe[from] = (unsafe[from] ?? 0) + 1;
    unsafe[to] = (unsafe[to] ?? 0) - 1;
  };
  const pending: DefaultTreeAdapterTypes.Node[] = [parseFragment(html, { sourceCodeLocationInfo: true })];
  while (pending.length) {
    const node = pending.pop();
    if (!node) continue;
    if ('tagName' in node && node.sourceCodeLocation) {
      const location = node.sourceCodeLocation;
      const span = spans[(owners[location.startOffset] ?? 0) - 1];
      const unsafeAttributes = node.attrs.some(
        ({ name, value }) => name.startsWith('on') || (['href', 'src', 'xlink:href'].includes(name) && dangerousUrl(value)),
      );
      if (ACTIVE_TAGS.has(node.tagName) || (RAW_TEXT_TAGS.has(node.tagName) && unsafeAttributes))
        mark(location.startOffset, location.endOffset > location.startOffset ? location.endOffset : html.length);
      else if (unsafeAttributes) mark(location.startOffset, location.startTag?.endOffset ?? location.endOffset);
      else if (span && ['link_open', 'image'].includes(span.token.type)) {
        const property = span.token.type === 'image' ? 'src' : 'href';
        if (!allowsUrl(span.token.attrGet(property) ?? '', property)) mark(location.startOffset, location.startTag?.endOffset ?? location.endOffset);
      }
    }
    if ('childNodes' in node) for (const child of node.childNodes) pending.push(child);
  }
  let depth = 0;
  let count = 0;
  for (let at = 0; at < unsafe.length; at++) {
    depth += unsafe[at] ?? 0;
    unsafe[at] = count;
    if (depth > 0) count++;
  }
  if (!count) return source;
  const escaped = new Uint8Array(source.length);
  const replacements = new Map<number, number>();
  const boundaries = new Map<number, string>();
  for (const span of spans) {
    if (unsafe[span.from] === unsafe[span.to]) continue;
    const { token, positions } = span;
    const info = locations.get(token);
    if (token.type === 'html_block' || token.type === 'html_inline') {
      const start = token.type === 'html_block' ? 0 : (info?.pos ?? 0);
      const markLiteral = (at: number) => {
        const from = positions[start + at];
        if (from !== undefined) escaped[from] = source[from] === '<' ? 1 : source.charCodeAt(from);
      };
      // An HTML token was literal on main. Keep it literal after its opener
      // becomes text: do not expose links, code, MDX or new block containers.
      let lineStart = 0;
      for (let at = 0; at < token.content.length; at++) {
        const character = token.content[at] ?? '';
        if ('<[`~\\*_{'.includes(character)) markLiteral(at);
        if (at !== lineStart) continue;
        let first = at;
        let indent = 0;
        while (token.content[first] === ' ' || token.content[first] === '\t') {
          indent += token.content[first] === '\t' ? 4 : 1;
          first++;
        }
        if (indent >= 4) markLiteral(at);
        const marker = token.content[first];
        if (marker && '>+-#='.includes(marker)) markLiteral(first);
        let end = first;
        while (end < first + 9 && (token.content[end] ?? '') >= '0' && (token.content[end] ?? '') <= '9') end++;
        if (end > first && (token.content[end] === '.' || token.content[end] === ')') && [' ', '\t', '\n', ''].includes(token.content[end + 1] ?? ''))
          markLiteral(end);
        const newline = token.content.indexOf('\n', at);
        lineStart = newline < 0 ? token.content.length : newline + 1;
      }
      if (boundaryTokens.has(token) && token.content.endsWith('\n')) {
        const newline = positions[token.content.length - 1];
        const lastLine = token.content.lastIndexOf('\n', token.content.length - 2) + 1;
        const first = positions[lastLine];
        if (newline !== undefined && first !== undefined) {
          const physicalStart = source.lastIndexOf('\n', first - 1) + 1;
          const prefix = Array.from(source.slice(physicalStart, first), (character) =>
            character === '>' || character === ' ' || character === '\t' ? character : ' ',
          ).join('');
          const ending = source[newline] === '\r' && source[newline + 1] === '\n' ? '\r\n' : source[newline];
          if (ending) boundaries.set(newline + ending.length, prefix + ending);
        }
      }
      continue;
    }
    const property = token.type === 'image' ? 'src' : 'href';
    if (!info || allowsUrl(token.attrGet(property) ?? '', property)) continue;
    if (token.markup === 'autolink') {
      escaped[positions[info.pos] ?? source.length] = 1;
      continue;
    }
    const start = token.type === 'image' ? info.pos : info.pos - 1;
    const labelEnd = token.type === 'image' ? markdown.helpers.parseLinkLabel(info.state, start + 1, false) : info.labelEnd;
    let at = labelEnd + 1;
    let destination: Destination | undefined;
    if (info.state.src[at] === '(') {
      at++;
      while ([' ', '\t', '\n'].includes(info.state.src[at] ?? '')) at++;
      destination = destinations.get(info.state.src)?.get(at);
    } else {
      const labelStart = start + (token.type === 'image' ? 2 : 1);
      let label = info.state.src.slice(labelStart, labelEnd);
      if (info.state.src[at] === '[') {
        const end = markdown.helpers.parseLinkLabel(info.state, at, false);
        if (end >= 0) label = info.state.src.slice(at + 1, end) || label;
      }
      destination = referenceDestinations.get(markdown.utils.normalizeReference(label));
    }
    if (!destination) throw new Error('Missing parsed export link destination');
    const from = destination.wholeSource ? originalOffset(destination.from) : positions[destination.from];
    const last = destination.wholeSource ? originalOffset(destination.to - 1) : positions[destination.to - 1];
    if (from !== undefined && last !== undefined) replacements.set(from, last + 1);
  }
  const output: string[] = [];
  let cursor = 0;
  for (let at = 0; at < source.length; at++) {
    const boundary = boundaries.get(at);
    if (boundary !== undefined) {
      output.push(source.slice(cursor, at), boundary);
      cursor = at;
    }
    const end = replacements.get(at);
    if (end !== undefined) {
      output.push(source.slice(cursor, at), '#');
      cursor = end;
      at = end - 1;
    } else if (escaped[at]) {
      output.push(source.slice(cursor, at), escaped[at] === 1 ? '&lt;' : `&#${source.charCodeAt(at)};`);
      cursor = at + 1;
    }
  }
  output.push(source.slice(cursor));
  return output.join('');
};
