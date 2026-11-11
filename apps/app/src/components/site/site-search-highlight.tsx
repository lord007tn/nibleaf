import { lightStemArabicToken } from '@nibleaf/search/arabic';

// Close to normalizeArabicSearchText in @nibleaf/search, so the words search
// matched on the server are the words highlighted here (e.g. "الغاء" marks
// "إلغاء"): diacritics (tashkeel) and tatweel drop out, alef forms fold to ا,
// alef maqsura ى to ي, and taa marbuta ة to ه (readers type either at a word's end).
const ARABIC_MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/;
const ARABIC_LETTER = /[ء-يٱ-ۓ]/;
const ARABIC_WORD = /^[ء-غف-يٱؐ-ًؚ-ٰٟۖ-ۭـ]+$/u;

/** One character, folded for matching ('' for marks that matching ignores). */
const foldSearchChar = (char: string): string =>
  ARABIC_MARKS.test(char)
    ? ''
    : char
        .replace(/[آأإٱ]/, 'ا')
        .replace('ى', 'ي')
        .replace('ة', 'ه')
        .toLowerCase();

export interface HighlightPart {
  /** Offset of this part in the original text (stable React key). */
  start: number;
  value: string;
  marked: boolean;
}

/**
 * Splits `text` into plain and matched parts for the query's words (two or more
 * characters each), case-insensitively and with Arabic folded. The parts are
 * slices of the original text, so the reader sees exactly what was published.
 */
export function highlightParts(text: string, query: string): HighlightPart[] {
  const tokens = [
    ...new Set(
      query
        .trim()
        .split(/\s+/)
        .map((token) => [...token].map(foldSearchChar).join('')),
    ),
  ].filter((token) => token.length >= 2);
  if (!text || tokens.length === 0) return text ? [{ start: 0, value: text, marked: false }] : [];
  // Fold the text while remembering which original character each folded one came from.
  let folded = '';
  const origin: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    for (const char of foldSearchChar(text[index] ?? '')) {
      folded += char;
      origin.push(index);
    }
  }
  const ranges: Array<[number, number]> = [];
  // Match whole prose words through the same conservative stemmer used by
  // retrieval, retaining their original UTF-16 offsets and diacritics.
  const stems = new Set(tokens.map(lightStemArabicToken));
  for (const word of text.matchAll(/[\p{L}\p{M}\p{N}_+.#@:/\\-]+/gu)) {
    if (!ARABIC_WORD.test(word[0])) continue;
    if (stems.has(lightStemArabicToken(word[0]))) ranges.push([word.index, word.index + word[0].length]);
  }
  for (const token of tokens) {
    for (let at = folded.indexOf(token); at !== -1; at = folded.indexOf(token, at + token.length)) {
      let start = origin[at] ?? 0;
      let end = (origin[at + token.length - 1] ?? text.length - 1) + 1;
      // Keep trailing diacritics with their letter.
      while (end < text.length && ARABIC_MARKS.test(text[end] ?? '')) end += 1;
      // Arabic letters join: a mark inside a word (اشتراك in الاشتراك) would break the
      // lam-alef ligature and letter joining, so Arabic matches cover the whole word.
      if (ARABIC_LETTER.test(text[start] ?? '')) {
        while (start > 0 && (ARABIC_LETTER.test(text[start - 1] ?? '') || ARABIC_MARKS.test(text[start - 1] ?? ''))) start -= 1;
        while (end < text.length && (ARABIC_LETTER.test(text[end] ?? '') || ARABIC_MARKS.test(text[end] ?? ''))) end += 1;
      }
      ranges.push([start, end]);
    }
  }
  if (ranges.length === 0) return [{ start: 0, value: text, marked: false }];
  ranges.sort((left, right) => left[0] - right[0]);
  const parts: HighlightPart[] = [];
  let cursor = 0;
  for (const [rangeStart, rangeEnd] of ranges) {
    if (rangeEnd <= cursor) continue;
    const from = Math.max(rangeStart, cursor);
    if (from > cursor) parts.push({ start: cursor, value: text.slice(cursor, from), marked: false });
    parts.push({ start: from, value: text.slice(from, rangeEnd), marked: true });
    cursor = rangeEnd;
  }
  if (cursor < text.length) parts.push({ start: cursor, value: text.slice(cursor), marked: false });
  return parts;
}

/**
 * Wraps occurrences of the query's words in <mark> so matches stand out. Titles
 * and snippets render as plain text nodes: markup in them (a stray `<b>` or
 * `<script>` in a snippet) shows as text and never becomes HTML.
 */
export function Highlight({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map(({ start, value, marked }) =>
        marked ? (
          <mark key={start} className="rounded-[3px] bg-primary/15 px-px font-semibold text-inherit">
            {value}
          </mark>
        ) : (
          <span key={start}>{value}</span>
        ),
      )}
    </>
  );
}
