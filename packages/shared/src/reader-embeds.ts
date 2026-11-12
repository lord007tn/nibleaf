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
import { parseVideoUrl, parseWebUrl } from './video-embeds';

/** The reader element the rewrite emits. */
export const READER_EMBED_TAG = 'mdxembed';

/** A longer tag is left alone (and the sanitizer drops the iframe). */
const MAX_TAG_LENGTH = 4096;
const MAX_TITLE_LENGTH = 300;
const MAX_TEXT_LENGTH = 2048;
const OPENER = '<iframe';
const VIDEO_OPENER = '<video';
const CLOSER = '</iframe';

const isSpace = (char: string | undefined): boolean => char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f';
/** Ends an attribute name. */
const ENDS_NAME = new Set([' ', '\t', '\n', '\r', '\f', '/', '>', '=', '<', '"', "'", '{']);

/** The entities an attribute value is likely to hold, decoded once; the output is re-escaped. */
const ENTITY = /&(?:amp|quot|apos|lt|gt|#39);/g;
const ENTITIES: Readonly<Record<string, string>> = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&#39;': "'" };
const decode = (value: string): string => value.replace(ENTITY, (entity) => ENTITIES[entity] ?? entity);
const escapeAttribute = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

type Scan = { end: number; attributes: Map<string, string> };

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
  while (index < limit) {
    const char = text[index];
    if (char === '>') return { end: index + 1, attributes };
    if (char === '<') return null;
    if (isSpace(char) || char === '/') {
      index++;
      continue;
    }
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

/** Where an immediately following `</iframe>` ends (only whitespace between), else `from`. */
const afterCloser = (text: string, from: number): number => {
  let index = from;
  while (index < text.length && isSpace(text[index])) index++;
  if (text.slice(index, index + CLOSER.length).toLowerCase() !== CLOSER) return from;
  index += CLOSER.length;
  while (index < text.length && isSpace(text[index])) index++;
  return text[index] === '>' ? index + 1 : from;
};

const clip = (value: string | undefined, length: number): string => (value ?? '').replace(/\s+/g, ' ').trim().slice(0, length);

/** The reader element for one iframe's attributes. */
const readerEmbedElement = (attributes: ReadonlyMap<string, string>): string => {
  const src = clip(attributes.get('src'), MAX_TEXT_LENGTH);
  const title = clip(attributes.get('title'), MAX_TITLE_LENGTH);
  const titled = title ? ` title="${escapeAttribute(title)}"` : '';
  const video = parseVideoUrl(src);
  if (video) {
    const start = video.start ? ` start="${video.start}"` : '';
    return `<${READER_EMBED_TAG} provider="${video.provider}" videoid="${video.id}"${start}${titled}></${READER_EMBED_TAG}>`;
  }
  if (!src) return '';
  const url = parseWebUrl(src);
  if (url?.protocol === 'https:') return `<${READER_EMBED_TAG} href="${escapeAttribute(url.href)}"${titled}></${READER_EMBED_TAG}>`;
  return `<${READER_EMBED_TAG} text="${escapeAttribute(src)}"${titled}></${READER_EMBED_TAG}>`;
};

/** A tag's text on one line: each run of whitespace becomes one space. */
const oneLine = (tag: string): string => tag.replace(/\s+/g, ' ');

/**
 * Rewrite every complete `<iframe …>` (with an adjacent `</iframe>`, if any) in
 * prose, and put every complete `<video …>` opener on one line: written over
 * several lines (Mintlify's form), its lone `>` line would start a blockquote and
 * the video would render as text. The sanitizer decides what a video keeps.
 */
export const rewriteReaderEmbeds = (text: string): string => {
  if (!text.includes('<')) return text;
  let output = '';
  let kept = 0;
  for (let at = text.indexOf('<'); at >= 0; at = text.indexOf('<', at + 1)) {
    const iframe = opens(text, at, OPENER);
    if (!iframe && !opens(text, at, VIDEO_OPENER)) continue;
    const tag = readTag(text, at + (iframe ? OPENER : VIDEO_OPENER).length);
    if (!tag) continue;
    const end = iframe ? afterCloser(text, tag.end) : tag.end;
    output += text.slice(kept, at) + (iframe ? readerEmbedElement(tag.attributes) : oneLine(text.slice(at, end)));
    kept = end;
    at = end - 1;
  }
  return output + text.slice(kept);
};
