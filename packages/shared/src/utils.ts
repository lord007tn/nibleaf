import { fencedMarkdownLines } from './markdown-code';

/** Longest slug we emit. Page titles are capped at 200 characters, so anything
 *  longer can only come from pathological input (import paths joined with '-'). */
const MAX_SLUG_LENGTH = 200;

/** Vocalisation marks that are optional in running text and never belong in a
 *  URL: Arabic tashkeel (U+064B–U+065F, U+0670), Quranic annotation marks,
 *  tatweel (U+0640), and Hebrew niqqud/cantillation. Other scripts' combining
 *  marks (Devanagari vowel signs, Thai tone marks…) spell the word and stay. */
const OPTIONAL_MARKS =
  /[\u0640\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/gu;
const UNICODE_SLUG_CHAR = /^[\p{L}\p{N}\p{M}]$/u;
/** Invisible format characters (ZWNJ inside Persian words, ZWJ, bidi marks):
 *  dropped without splitting the word. */
const FORMAT_CHAR = /^\p{Cf}$/u;

export interface SlugifyOptions {
  /** Keep letters, digits, and combining marks from every script — for page
   *  slugs, which are percent-encoded in URLs. Off by default: hostnames
   *  (project slugs) and storage keys must stay ASCII. */
  unicode?: boolean;
}

/** Turn a free-form string into a url-safe slug: lowercase, letters and digits
 *  kept, every other run collapsed to a single '-', trimmed, capped. The result
 *  is deterministic and idempotent (`slugify(slugify(x)) === slugify(x)`). */
export const slugify = (value: string, options?: SlugifyOptions): string => {
  const unicode = options?.unicode === true;
  const source = unicode ? value.normalize('NFC').replace(OPTIONAL_MARKS, '') : value;
  let slug = '';
  let length = 0;
  let separatorPending = false;
  for (const char of source.toLowerCase().trim()) {
    const code = char.charCodeAt(0);
    const isAsciiLetter = code >= 97 && code <= 122;
    const isDigit = code >= 48 && code <= 57;
    if (isAsciiLetter || isDigit || (unicode && UNICODE_SLUG_CHAR.test(char))) {
      const separator = separatorPending && slug ? '-' : '';
      if (length + separator.length + 1 > MAX_SLUG_LENGTH) {
        break;
      }
      slug += separator + char;
      length += separator.length + 1;
      separatorPending = false;
    } else if (slug && !(unicode && FORMAT_CHAR.test(char))) {
      separatorPending = true;
    }
  }
  return slug;
};

/** Slug for content that lives in a URL path (page slugs): keeps Arabic, Hebrew,
 *  CJK, Indic… letters so an Arabic title gets an Arabic slug instead of the
 *  'page' fallback. Latin input slugs exactly like `slugify`. */
export const slugifyUnicode = (value: string): string => slugify(value, { unicode: true });

const trimEdgeSlashes = (value: string): string => {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === '/') {
    start += 1;
  }
  while (end > start && value[end - 1] === '/') {
    end -= 1;
  }
  return value.slice(start, end);
};

/** Join a parent path and a slug into a full doc path (no leading/trailing slash). */
export const joinPath = (parentPath: string | null | undefined, slug: string): string => {
  const base = trimEdgeSlashes(parentPath ?? '');
  return base ? `${base}/${slug}` : slug;
};

/** Strip Markdown links to their labels and remove Markdown images. This
 * single-pass parser handles balanced inline destinations; malformed
 * markup is preserved instead of inviting regex backtracking on user content. */
export const stripMarkdownLinks = (value: string): string => {
  let output = '';
  let cursor = 0;
  while (cursor < value.length) {
    const image = value[cursor] === '!' && value[cursor + 1] === '[';
    const link = value[cursor] === '[';
    if (!image && !link) {
      output += value[cursor];
      cursor += 1;
      continue;
    }

    const markerStart = cursor;
    const labelStart = cursor + (image ? 2 : 1);
    let labelEnd = labelStart;
    while (labelEnd < value.length && value[labelEnd] !== ']') {
      labelEnd += 1;
    }
    if (labelEnd >= value.length || value[labelEnd + 1] !== '(') {
      output += value.slice(markerStart, Math.min(labelEnd + 1, value.length));
      cursor = Math.min(labelEnd + 1, value.length);
      continue;
    }

    let destinationEnd = labelEnd + 2;
    let depth = 1;
    while (destinationEnd < value.length) {
      if (value[destinationEnd] === '\\') {
        destinationEnd += 2;
        continue;
      }
      if (value[destinationEnd] === '(') depth += 1;
      if (value[destinationEnd] === ')') depth -= 1;
      if (depth === 0) break;
      destinationEnd += 1;
    }
    if (destinationEnd >= value.length) {
      output += value.slice(markerStart);
      break;
    }

    if (!image) {
      output += value.slice(labelStart, labelEnd);
    }
    cursor = destinationEnd + 1;
  }
  return output;
};

/** Shared plain text for reader metadata, structured data and AI summaries. */
export const markdownToPlainText = (markdown: string): string => {
  const lines = markdown.split(/\r?\n/u);
  const code = fencedMarkdownLines(lines);
  const prose = lines.filter((line, index) => !code[index] && !(line.includes('---') && /^[\s:|-]+$/u.test(line))).join('\n');
  return stripMarkdownLinks(
    prose
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/^\s*\[[^\]\n]+\]:\s+\S+.*$/gm, ' ')
      .replace(/!\[[^\]\n]*\]\[[^\]\n]*\]/g, ' ')
      .replace(/\[([^\]\n]+)\]\[[^\]\n]*\]/g, '$1'),
  )
    .replace(/<\/?[A-Za-z][^>]*>/g, ' ')
    .replace(/\[!\w+\]/gi, ' ')
    .replace(/!\[[^\]\n]*\]/g, ' ')
    .replace(/\[([^\]\n]+)\]/g, '$1')
    .replace(/\\([-+*.])/g, '$1')
    .replace(/^\s*(?:>\s*)*(?:#{1,6}\s+|[-+*]\s*\d+-\s*|[-+*]\s+|\d+[.)]\s+)/gm, '')
    .replace(/[*`~]/g, '')
    .replace(/(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])/gu, '')
    .replace(/[|>]/g, ' ')
    .replace(
      /&(?:amp|lt|gt|quot|apos|nbsp);/g,
      (entity) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' })[entity] ?? entity,
    )
    .replace(/\s+/g, ' ')
    .trim();
};

/** Word-boundary summary, counting graphemes so Arabic marks and emoji stay whole. */
export const excerpt = (markdown: string, max = 160): string => {
  const text = markdownToPlainText(markdown);
  if (!Number.isFinite(max)) return text;
  if (max <= 0) return '';
  const graphemes: string[] = [];
  let truncated = false;
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
    if (graphemes.length >= max) {
      truncated = true;
      break;
    }
    graphemes.push(segment);
  }
  if (!truncated) return text;
  const cut = graphemes.slice(0, max - 1).join('');
  const boundary = cut.lastIndexOf(' ');
  const head = boundary >= cut.length / 2 ? cut.slice(0, boundary) : cut;
  return `${head.replace(/[\s,;:،؛]+$/u, '')}…`;
};

/** Pluralise a noun against a count. */
export const plural = (count: number, noun: string, suffix = 's'): string => `${count} ${noun}${count === 1 ? '' : suffix}`;
