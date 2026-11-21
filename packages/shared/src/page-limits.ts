/** The largest page body a write may store, in UTF-8 bytes (2 MiB). Editor
 *  saves, MCP writes, import and Git sync share it: public `.md`/llms output and
 *  exports are built from page content. */
export const MAX_PAGE_CONTENT_BYTES = 2 * 1024 * 1024;

/** Bounded synchronous Markdown parsing for the reader and publish checks. */
export const MARKDOWN_PARSE_LIMITS = {
  pageBytes: 512 * 1024,
  lineCharacters: 16 * 1024,
  syntaxMarkers: 1024,
  nesting: 64,
} as const;

export type MarkdownParseLimit = keyof typeof MARKDOWN_PARSE_LIMITS;

const MARKDOWN_OPENERS = '[({';
const MARKDOWN_CLOSERS = '])}';
const MARKDOWN_SYNTAX = '[](){}<>`*_~!#-|+\\';
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

/** Conservative checks on source spelling. The byte cap bounds the scan and
 * per-line limits catch dense syntax before Markdown tries to parse it. */
export const markdownParseLimit = (source: string): MarkdownParseLimit | null => {
  if (exceedsUtf8Bytes(source, MARKDOWN_PARSE_LIMITS.pageBytes)) return 'pageBytes';
  const nestedBlockStart = /[ \t]*(?:>|(?:[-*+]|\d{1,9}[.)])[ \t]+)/y;
  for (const line of source.split(/\r\n?|\n/)) {
    if (line.length > MARKDOWN_PARSE_LIMITS.lineCharacters) return 'lineCharacters';
    nestedBlockStart.lastIndex = 0;
    let blocks = 0;
    while (nestedBlockStart.test(line)) if (++blocks > MARKDOWN_PARSE_LIMITS.nesting) return 'nesting';
    let markers = 0;
    let depth = 0;
    for (const char of line) {
      if (MARKDOWN_OPENERS.includes(char)) {
        if (++depth > MARKDOWN_PARSE_LIMITS.nesting) return 'nesting';
      } else if (MARKDOWN_CLOSERS.includes(char) && depth) depth--;
      if (MARKDOWN_SYNTAX.includes(char) && ++markers > MARKDOWN_PARSE_LIMITS.syntaxMarkers) return 'syntaxMarkers';
    }
  }
  const tags: string[] = [];
  for (const [raw, slash, tag] of source.matchAll(/<(\/?)([a-z][\w.-]*)(?=[ \t\r\n/>])[^<>]*>/gi)) {
    const name = tag?.toLowerCase() ?? '';
    if (slash) {
      const matched = tags.lastIndexOf(name);
      if (matched >= 0) tags.length = matched;
    } else if (!raw.endsWith('/>') && !VOID_TAGS.has(name)) {
      tags.push(name);
      if (tags.length > MARKDOWN_PARSE_LIMITS.nesting) return 'nesting';
    }
  }
  return null;
};

const utf8Width = (code: number) => (code <= 0x7f ? 1 : code <= 0x7_ff ? 2 : code <= 0xff_ff ? 3 : 4);

/** Count UTF-8 bytes only up to the limit. Even a huge single line fails early.
 * Unpaired UTF-16 surrogates encode as a three-byte replacement character. */
export function exceedsUtf8Bytes(text: string, limit: number): boolean {
  // Every UTF-16 code unit encodes to at least one byte.
  if (text.length > limit) return true;
  let bytes = 0;
  for (const char of text) {
    bytes += utf8Width(char.codePointAt(0) ?? 0);
    if (bytes > limit) return true;
  }
  return false;
}

function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (const char of text) bytes += utf8Width(char.codePointAt(0) ?? 0);
  return bytes;
}

/**
 * The UTF-8 size of `next` when writing it must be refused, otherwise null.
 *
 * Content over the cap is refused only when it is also larger than the
 * `stored` body. Pages saved before the cap existed may be larger than it, and
 * an edit that shrinks one must always succeed, even while the result is still
 * over the cap, so its owner is never locked out. A create has no stored body:
 * anything over the cap is refused. Content under the cap costs one bounded
 * scan; `stored` is only measured, up to the new size, when `next` is over it.
 * `limit` is the cap (tests pass a small one to exercise the rule cheaply).
 */
export function oversizedPageContent(next: string, stored?: string, limit = MAX_PAGE_CONTENT_BYTES): number | null {
  if (!exceedsUtf8Bytes(next, limit)) return null;
  const bytes = utf8ByteLength(next);
  // `stored` holding at least as many bytes means this write does not grow it.
  if (stored !== undefined && exceedsUtf8Bytes(stored, bytes - 1)) return null;
  return bytes;
}
