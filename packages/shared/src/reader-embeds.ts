/**
 * The reader's handling of authored `<iframe>`s, applied by `normalizeMdxBlocks`
 * to prose (never code) before the HTML parser and sanitizer see the page. The
 * sanitizer allows no iframe, so this is the only way one renders:
 *  - an allowlisted video (`./video-embeds`) becomes `<mdxembed provider videoid
 *    start title>`, the reader's click-to-load player; every other attribute is
 *    dropped;
 *  - any other https address becomes `<mdxembed href title>`, a link card;
 *  - anything else (http, a relative path, `javascript:`, `data:`, an
 *    unparsable address) becomes `<mdxembed text title>`, shown as plain text.
 * The reader's renderer validates these attributes again, so a hand-written
 * `<mdxembed>` can't do more than an iframe can. A `<video>` opener is only put
 * on one line (see `rewriteReaderEmbeds`).
 *
 * One forward scan: a tag's attributes are read until its `>`, and the read
 * stops at the next `<` or after MAX_TAG_LENGTH characters, so no character is
 * read by two openers' scans. A tag that doesn't end that way (a value holding
 * `<`, say) is left as written, and the sanitizer drops the iframe. The only
 * regular expressions run on one attribute value or one tag's text, with no
 * nested or overlapping quantifiers.
 */
import { parseVideoUrl, parseWebUrl, type VideoEmbed } from './video-embeds';

/** The reader element the rewrite emits. */
export const READER_EMBED_TAG = 'mdxembed';

/** A longer tag is left alone (and the sanitizer drops the iframe). */
const MAX_TAG_LENGTH = 4096;
const MAX_TITLE_LENGTH = 300;
const MAX_TEXT_LENGTH = 2048;
const OPENER = '<iframe';
const VIDEO_OPENER = '<video';
const CLOSER = '</iframe';
const VIDEO_CLOSER = '</video';

const isSpace = (char: string | undefined): boolean => char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f';
/** Ends an attribute name. */
const ENDS_NAME = new Set([' ', '\t', '\n', '\r', '\f', '/', '>', '=', '<', '"', "'", '{']);

/** The entities an attribute value is likely to hold, decoded once; the output is re-escaped. */
const ENTITY = /&(?:amp|quot|apos|lt|gt|#39);/g;
const ENTITIES: Readonly<Record<string, string>> = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&#39;': "'" };
const decode = (value: string): string => value.replace(ENTITY, (entity) => ENTITIES[entity] ?? entity);
const escapeAttribute = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** A tag read to its `>`: where it ends, its attributes, and whether it ended with `/>`. */
type Scan = { end: number; attributes: Map<string, string>; selfClosing: boolean };

/** A quoted value from `start` (the opening quote): its text and the index after the closing quote. */
const quoted = (text: string, start: number, limit: number): { value: string; end: number } | null => {
  const quote = text[start];
  for (let index = start + 1; index < limit; index++) {
    const char = text[index];
    if (char === quote) return { value: text.slice(start + 1, index), end: index + 1 };
    if (char === '<') return null;
  }
  return null;
};

/** A JSX expression value from `start` (its `{`): a lone string literal's text, else empty. */
const expression = (text: string, start: number, limit: number): { value: string; end: number } | null => {
  let depth = 0;
  for (let index = start; index < limit; index++) {
    const char = text[index];
    if (char === '<') return null;
    if (char === '"' || char === "'" || char === '`') {
      const literal = quoted(text, index, limit);
      if (!literal) return null;
      index = literal.end - 1;
    } else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) {
      const inner = text.slice(start + 1, index).trim();
      const first = inner[0];
      const lone = (first === '"' || first === "'" || first === '`') && inner.length > 1 && inner.at(-1) === first;
      return { value: lone ? inner.slice(1, -1) : '', end: index + 1 };
    }
  }
  return null;
};

/** The attributes of a tag whose name ends at `from`, up to its `>`; null when
 *  the tag doesn't end before the next `<` or within MAX_TAG_LENGTH. */
const readTag = (text: string, from: number): Scan | null => {
  const attributes = new Map<string, string>();
  const limit = Math.min(text.length, from + MAX_TAG_LENGTH);
  let index = from;
  // Whether the last thing read was a lone `/` (only whitespace since), so `/>` ends a self-closing tag.
  let slash = false;
  while (index < limit) {
    const char = text[index];
    if (char === '>') return { end: index + 1, attributes, selfClosing: slash };
    if (char === '<') return null;
    if (isSpace(char) || char === '/') {
      if (char === '/') slash = true;
      index++;
      continue;
    }
    slash = false;
    if (char === '{') {
      // A JSX spread (`{...props}`): read past it, keep nothing.
      const spread = expression(text, index, limit);
      if (!spread) return null;
      index = spread.end;
      continue;
    }
    if (char === '"' || char === "'" || char === '=') return null;
    const nameStart = index;
    while (index < limit && !ENDS_NAME.has(text[index] ?? '')) index++;
    const name = text.slice(nameStart, index).toLowerCase();
    let next = index;
    while (next < limit && isSpace(text[next])) next++;
    if (text[next] !== '=') {
      if (!attributes.has(name)) attributes.set(name, '');
      continue;
    }
    next++;
    while (next < limit && isSpace(text[next])) next++;
    const opening = text[next];
    let value: { value: string; end: number } | null;
    if (opening === '"' || opening === "'") value = quoted(text, next, limit);
    else if (opening === '{') value = expression(text, next, limit);
    else {
      let end = next;
      while (end < limit && !isSpace(text[end]) && text[end] !== '>' && text[end] !== '<') end++;
      value = end > next ? { value: text.slice(next, end), end } : null;
    }
    if (!value) return null;
    if (!attributes.has(name)) attributes.set(name, decode(value.value));
    index = value.end;
  }
  return null;
};

/** Whether a tag named by `opener` (`<iframe`, any case) opens at `at`. */
const opens = (text: string, at: number, opener: string): boolean => {
  if (text.slice(at, at + opener.length).toLowerCase() !== opener) return false;
  const after = text[at + opener.length];
  return isSpace(after) || after === '>' || after === '/';
};

/**
 * Finds `</iframe …>` closers (or another element's, any case) at or after a
 * position, for positions that only grow: the last answer is reused while it
 * still lies ahead, and a new search starts after it, so each character is read
 * once per scan.
 */
const closerFinder = (text: string, closer = CLOSER) => {
  let found = -2; // not searched yet
  let searchedFrom = 0;
  /** Where the first closer at or after `from` ends (past its `>`), or -1 when none follows. */
  return (from: number): number => {
    if (found === -1 && from >= searchedFrom) return -1;
    if (found >= from) return found;
    searchedFrom = from;
    for (let at = text.indexOf('</', from); at >= 0; at = text.indexOf('</', at + 2)) {
      if (text.slice(at, at + closer.length).toLowerCase() !== closer) continue;
      let index = at + closer.length;
      while (index < text.length && isSpace(text[index])) index++;
      if (text[index] !== '>') continue;
      found = index + 1;
      return found;
    }
    found = -1;
    return -1;
  };
};

/**
 * Finds blank lines (a line of only spaces and tabs) at or after a position, for
 * positions that only grow, the same way as `closerFinder`: each character is
 * read once per scan. Answers the index of the newline that ends the last line
 * before the blank one.
 */
const blankLineFinder = (text: string) => {
  let found = -2; // not searched yet
  let searchedFrom = 0;
  return (from: number): number => {
    if (found === -1 && from >= searchedFrom) return -1;
    if (found >= from) return found;
    searchedFrom = from;
    for (let at = text.indexOf('\n', from); at >= 0; ) {
      let index = at + 1;
      while (index < text.length && (text[index] === ' ' || text[index] === '\t' || text[index] === '\r')) index++;
      if (text[index] === '\n') {
        found = at;
        return found;
      }
      at = text.indexOf('\n', index);
    }
    found = -1;
    return -1;
  };
};

const clip = (value: string | undefined, length: number): string => (value ?? '').replace(/\s+/g, ' ').trim().slice(0, length);

/**
 * How the reader shows an iframe with this `src`: an allowlisted provider's
 * click-to-load player, a link card for any other https address, or the
 * address as plain text. Null without an address (the reader shows nothing).
 * The editor previews an iframe with the same answer.
 */
export type ReaderEmbedSource = { kind: 'video'; video: VideoEmbed } | { kind: 'link'; url: URL } | { kind: 'text'; text: string };

export const readerEmbedSource = (value: string | undefined): ReaderEmbedSource | null => {
  const src = clip(value, MAX_TEXT_LENGTH);
  const video = parseVideoUrl(src);
  if (video) return { kind: 'video', video };
  if (!src) return null;
  const url = parseWebUrl(src);
  return url?.protocol === 'https:' ? { kind: 'link', url } : { kind: 'text', text: src };
};

/** The reader element for one iframe's attributes. */
const readerEmbedElement = (attributes: ReadonlyMap<string, string>): string => {
  const source = readerEmbedSource(attributes.get('src'));
  const title = clip(attributes.get('title'), MAX_TITLE_LENGTH);
  const titled = title ? ` title="${escapeAttribute(title)}"` : '';
  if (!source) return '';
  if (source.kind === 'video') {
    const { video } = source;
    const start = video.start ? ` start="${video.start}"` : '';
    return `<${READER_EMBED_TAG} provider="${video.provider}" videoid="${video.id}"${start}${titled}></${READER_EMBED_TAG}>`;
  }
  if (source.kind === 'link') return `<${READER_EMBED_TAG} href="${escapeAttribute(source.url.href)}"${titled}></${READER_EMBED_TAG}>`;
  return `<${READER_EMBED_TAG} text="${escapeAttribute(source.text)}"${titled}></${READER_EMBED_TAG}>`;
};

/** A tag's text on one line: each run of whitespace becomes one space. */
const oneLine = (tag: string): string => tag.replace(/\s+/g, ' ');

/**
 * Rewrite every complete `<iframe …>…</iframe>` (or self-closing `<iframe … />`)
 * in prose, and put every complete `<video …>` opener on one line: written over
 * several lines (Mintlify's form), its lone `>` line would start a blockquote and
 * the video would render as text. The sanitizer decides what a video keeps.
 *
 * What sits between an iframe's tags is never shown (a browser reads it as text
 * and doesn't render it), so it is dropped with the iframe: a link in it must not
 * start to render. The closer must end before the next blank line, in the
 * opener's own Markdown block. An iframe without one is left as written, as on
 * main: the sanitizer drops that tag alone, and the blocks after it render.
 */
export const rewriteReaderEmbeds = (text: string): string => {
  if (!text.includes('<')) return text;
  const closerEnd = closerFinder(text);
  const blankLine = blankLineFinder(text);
  let output = '';
  let kept = 0;
  for (let at = text.indexOf('<'); at >= 0; at = text.indexOf('<', at + 1)) {
    const iframe = opens(text, at, OPENER);
    if (!iframe && !opens(text, at, VIDEO_OPENER)) continue;
    const tag = readTag(text, at + (iframe ? OPENER : VIDEO_OPENER).length);
    if (!tag) continue;
    let end = tag.end;
    if (iframe && !tag.selfClosing) {
      end = closerEnd(tag.end);
      const blank = blankLine(tag.end);
      // A closer past a blank line belongs to a later block: this iframe has none.
      if (end >= 0 && blank >= 0 && end > blank) end = -1;
    }
    if (end < 0) continue;
    output += text.slice(kept, at) + (iframe ? readerEmbedElement(tag.attributes) : oneLine(text.slice(at, end)));
    kept = end;
    at = end - 1;
  }
  return output + text.slice(kept);
};

/** An authored `<iframe>` or `<video>` as the reader reads it (see `scanAuthoredEmbeds`). */
export interface AuthoredEmbed {
  kind: 'iframe' | 'video';
  /** Where the opener's `<` is. */
  start: number;
  /** Just past the opener's `>`. */
  openEnd: number;
  /** Just past the closer's `>` (the opener's, when self-closing); `openEnd` when not closed. */
  end: number;
  /** False for an opener with no closer in its own Markdown block. */
  closed: boolean;
  /** Attribute names lowercased, values decoded; the first of a repeated name wins. */
  attributes: ReadonlyMap<string, string>;
}

/**
 * Every `<iframe>` and `<video>` in `text` that the reader reads, in order, with
 * the same rules as `rewriteReaderEmbeds`: an opener it can't read is skipped,
 * and a closer counts only when it ends before the next blank line. A `<video>`
 * runs to its `</video>` under the same rule, so its `<source>` and `<track>`
 * children are part of it. The editor opens each closed one as a block that
 * saves back as written.
 *
 * Linear like the rewrite: each tag read stops at the next `<` or after
 * MAX_TAG_LENGTH characters, and the closer and blank-line finders only search
 * forward. The caller skips code.
 */
export const scanAuthoredEmbeds = (text: string): AuthoredEmbed[] => {
  const found: AuthoredEmbed[] = [];
  if (!text.includes('<')) return found;
  const iframeCloser = closerFinder(text);
  const videoCloser = closerFinder(text, VIDEO_CLOSER);
  const blankLine = blankLineFinder(text);
  for (let at = text.indexOf('<'); at >= 0; at = text.indexOf('<', at + 1)) {
    const iframe = opens(text, at, OPENER);
    if (!iframe && !opens(text, at, VIDEO_OPENER)) continue;
    const tag = readTag(text, at + (iframe ? OPENER : VIDEO_OPENER).length);
    if (!tag) continue;
    let end = tag.end;
    if (!tag.selfClosing) {
      end = (iframe ? iframeCloser : videoCloser)(tag.end);
      const blank = blankLine(tag.end);
      if (end >= 0 && blank >= 0 && end > blank) end = -1;
    }
    const closed = end >= 0;
    found.push({ kind: iframe ? 'iframe' : 'video', start: at, openEnd: tag.end, end: closed ? end : tag.end, closed, attributes: tag.attributes });
    at = (closed ? end : tag.end) - 1;
  }
  return found;
};
