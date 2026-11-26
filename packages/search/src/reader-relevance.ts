import { lightStemArabicToken, normalizeArabicSearchText } from './arabic';
import { cleanSearchText } from './hybrid';
import { foldSearchText, type SearchTokenizerLanguage } from './tokenizer';

/** Whole normalized words, with Arabic inflections retaining light stemming.
 * Words get the retrieval tokenizer's normalization (Orama's accent folding),
 * so relevance accepts exactly the candidates retrieval matched: `cafe` finds
 * `Café`. Only the term sets are folded; titles and snippets keep the original. */
export const readerSearchTerms = (value: string, language?: SearchTokenizerLanguage): Set<string> => {
  const words = new Set(foldSearchText(normalizeArabicSearchText(value), language).match(/[\p{L}\p{M}\p{N}_]+/gu) ?? []);
  return new Set([...words].map((term) => (/^[\u0621-\u063a\u0641-\u064a]+$/u.test(term) ? lightStemArabicToken(term) : term)));
};

export const readerSearchFields = (
  doc: { title: string; headings: string; description: string; content: string },
  language?: SearchTokenizerLanguage,
) =>
  [
    { value: doc.title, weight: 4 },
    { value: doc.headings, weight: 3 },
    { value: doc.description, weight: 1.5 },
    { value: doc.content, weight: 1 },
  ].map(({ value, weight }) => ({ terms: readerSearchTerms(cleanSearchText(value), language), weight }));

const readerTermScore = (term: string, fields: ReturnType<typeof readerSearchFields>): number => {
  let best = 0;
  for (const field of fields) {
    if (field.terms.has(term)) best = Math.max(best, field.weight);
    else if (term.length >= 3 && [...field.terms].some((word) => word.startsWith(term))) best = Math.max(best, field.weight * 0.75);
  }
  return best;
};

export const readerRelevanceScore = (query: ReadonlySet<string>, fields: ReturnType<typeof readerSearchFields>): number => {
  if (query.size === 0) return 0;
  let covered = 0;
  let score = 0;
  for (const term of query) {
    const best = readerTermScore(term, fields);
    if (best > 0) covered += 1;
    score += best;
  }
  return (score / query.size) * (covered / query.size);
};

/** Letters in a word: code points, so a character outside the Basic
 * Multilingual Plane (two UTF-16 units) counts once (#831). */
const letterCount = (word: string): number => {
  let count = 0;
  for (const _ of word) count += 1;
  return count;
};

/** Linear one-edit check over letters (code points), without allocating a
 * Levenshtein matrix: inserting, deleting or replacing one astral character is
 * one edit, not two (#831). */
const oneEditApart = (left: string, right: string): boolean => {
  // One letter changes the UTF-16 length by at most 2: most words are ruled out before counting.
  if (Math.abs(left.length - right.length) > 2) return false;
  const leftLetters = letterCount(left);
  const rightLetters = letterCount(right);
  if (Math.abs(leftLetters - rightLetters) > 1) return false;
  let edits = 0;
  let l = 0;
  let r = 0;
  while (l < left.length && r < right.length) {
    const a = left.codePointAt(l) ?? 0;
    const b = right.codePointAt(r) ?? 0;
    const aWidth = a > 0xff_ff ? 2 : 1;
    const bWidth = b > 0xff_ff ? 2 : 1;
    if (a === b) {
      l += aWidth;
      r += bWidth;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (leftLetters >= rightLetters) l += aWidth;
    if (rightLetters >= leftLetters) r += bWidth;
  }
  return edits + (l < left.length || r < right.length ? 1 : 0) <= 1;
};

/** Typo-only candidates must cover every query word; only words of 5+ letters
 * (code points, after normalization and Arabic light stemming) may use one
 * insertion, deletion or substitution. Lexical hits keep their lane. */
export const readerTypoRelevanceScore = (query: ReadonlySet<string>, fields: ReturnType<typeof readerSearchFields>): number => {
  if (query.size === 0) return 0;
  let score = 0;
  let typo = false;
  for (const term of query) {
    let best = readerTermScore(term, fields);
    if (best === 0 && letterCount(term) >= 5) {
      for (const field of fields) {
        for (const word of field.terms) {
          if (!oneEditApart(term, word)) continue;
          best = Math.max(best, field.weight * 0.5);
          break;
        }
      }
      typo ||= best > 0;
    }
    if (best === 0) return 0;
    score += best;
  }
  return typo ? score / query.size : 0;
};

/** One exact body term scores 1; half a two-term query in body scores 0.25.
 * Retain body matches for short queries while dropping weak multiword tails. */
export const readerRelevanceFloor = (best: number): number => Math.max(0.5, best * 0.2);
