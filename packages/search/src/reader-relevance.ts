import { lightStemArabicToken, normalizeArabicSearchText } from './arabic';
import { cleanSearchText } from './hybrid';

/** Whole normalized words only; edit-distance neighbors are not evidence that
 * a published page covers a keyword. Arabic inflections retain light stemming. */
export const readerSearchTerms = (value: string): Set<string> => {
  const words = new Set(
    normalizeArabicSearchText(value)
      .toLowerCase()
      .match(/[\p{L}\p{M}\p{N}_]+/gu) ?? [],
  );
  return new Set([...words].map((term) => (/^[\u0621-\u063a\u0641-\u064a]+$/u.test(term) ? lightStemArabicToken(term) : term)));
};

export const readerSearchFields = (doc: { title: string; headings: string; description: string; content: string }) =>
  [
    { value: doc.title, weight: 4 },
    { value: doc.headings, weight: 3 },
    { value: doc.description, weight: 1.5 },
    { value: doc.content, weight: 1 },
  ].map(({ value, weight }) => ({ terms: readerSearchTerms(cleanSearchText(value)), weight }));

export const readerRelevanceScore = (query: ReadonlySet<string>, fields: ReturnType<typeof readerSearchFields>): number => {
  if (query.size === 0) return 0;
  let covered = 0;
  let score = 0;
  for (const term of query) {
    let best = 0;
    for (const field of fields) {
      if (field.terms.has(term)) best = Math.max(best, field.weight);
      // Preserve typeahead completion for real word prefixes, without fuzzy
      // substitutions or substring matches inside an unrelated word.
      else if (term.length >= 3 && [...field.terms].some((word) => word.startsWith(term))) best = Math.max(best, field.weight * 0.75);
    }
    if (best > 0) covered += 1;
    score += best;
  }
  return (score / query.size) * (covered / query.size);
};

/** One exact body term scores 1; half a two-term query in body scores 0.25.
 * Retain body matches for short queries while dropping weak multiword tails. */
export const readerRelevanceFloor = (best: number): number => Math.max(0.5, best * 0.2);
