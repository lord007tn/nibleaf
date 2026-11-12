/*
 * Inline text of an answer, for right-to-left readers. An Arabic answer keeps the
 * English names, code, paths and links of the docs it cites; inside right-to-left
 * text, the punctuation and numbers around them reorder unless each is laid out
 * as its own left-to-right island. Every scan here is linear: answers are short,
 * but they come from a model.
 */

/** Hebrew, Arabic, Syriac, Thaana, NKo and the Arabic presentation forms. */
const isRtl = (code: number) => (code >= 0x05_90 && code <= 0x08_ff) || (code >= 0xfb_1d && code <= 0xfd_ff) || (code >= 0xfe_70 && code <= 0xfe_ff);
const isLatin = (code: number) => (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
const isSpace = (code: number) => code === 32 || code === 9 || code === 10 || code === 13 || code === 0xa0;

const has = (text: string, test: (code: number) => boolean) => {
  for (let index = 0; index < text.length; index += 1) if (test(text.charCodeAt(index))) return true;
  return false;
};

/** A label with Latin letters and no right-to-left ones (a button or menu name,
 * "Settings → Custom domain"): laid out left to right wherever it appears. */
export const isLeftToRightLabel = (text: string): boolean => has(text, isLatin) && !has(text, isRtl);

/** Punctuation that belongs to the sentence around a link or path, not to it. */
const OPENING = new Set(['(', '[', '«', '"', "'", '“', '‘']);
const CLOSING = new Set(['.', ',', '،', '؛', ';', ':', '!', '?', '؟', ')', ']', '»', '"', "'", '”', '’']);

/** A word that reads left to right as a whole: a URL, a path, an email address
 * or a dotted name (`docs.example.com`, `config.json`), with no right-to-left letters. */
const isLeftToRightToken = (word: string): boolean => {
  if (word.length < 3 || has(word, isRtl) || !has(word, isLatin)) return false;
  if (word.includes('://') || word.includes('@')) return true;
  if (word.charCodeAt(0) === 47 && word.length > 1) return true;
  const dot = word.indexOf('.');
  return dot > 0 && dot < word.length - 1;
};

export type InlineSegment = { text: string; leftToRight: boolean };

/** Splits text into plain runs and left-to-right islands (links, paths, emails,
 * dotted names), keeping each island's surrounding punctuation in the plain text. */
export const leftToRightIslands = (text: string): InlineSegment[] => {
  const segments: InlineSegment[] = [];
  let plain = '';
  let index = 0;
  while (index < text.length) {
    if (isSpace(text.charCodeAt(index))) {
      plain += text[index];
      index += 1;
      continue;
    }
    let end = index;
    while (end < text.length && !isSpace(text.charCodeAt(end))) end += 1;
    let start = index;
    let stop = end;
    while (start < stop && OPENING.has(text[start] ?? '')) start += 1;
    while (stop > start && CLOSING.has(text[stop - 1] ?? '')) stop -= 1;
    const core = text.slice(start, stop);
    if (isLeftToRightToken(core)) {
      plain += text.slice(index, start);
      if (plain) segments.push({ text: plain, leftToRight: false });
      segments.push({ text: core, leftToRight: true });
      plain = text.slice(stop, end);
    } else plain += text.slice(index, end);
    index = end;
  }
  if (plain) segments.push({ text: plain, leftToRight: false });
  return segments;
};

/** The longest word kept on one line with the citation after it; a longer one
 * (a long link) may still break, so it never overflows a narrow panel. */
const MAX_GLUED_WORD = 40;

/** Text before a citation, split into what may wrap and its last word (with its
 * punctuation), which stays with the citation. The space before the citation goes:
 * the citation keeps its own margin. `word` is empty when there is none to keep. */
export const splitLastWord = (text: string): { head: string; word: string } => {
  let end = text.length;
  while (end > 0 && isSpace(text.charCodeAt(end - 1))) end -= 1;
  let start = end;
  while (start > 0 && !isSpace(text.charCodeAt(start - 1))) start -= 1;
  if (end - start > MAX_GLUED_WORD) return { head: text, word: '' };
  return { head: text.slice(0, start), word: text.slice(start, end) };
};
