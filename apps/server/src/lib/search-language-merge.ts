import type { SearchHit } from '@nibleaf/search';

interface LanguageResult<Hit> {
  language: string;
  result: { hits: readonly Hit[] };
}

/**
 * Merge per-language search results into one list.
 *
 * Each language is searched in its own index, so raw scores do not compare
 * across languages: a term that is rare in the Arabic index (a CLI flag inside
 * a code span) outscores the exact English title it was copied from. So hits
 * are ordered by their rank within their own language, never by raw score:
 *
 * 1. The preferred language (the reader's, matched exactly: `pt-BR` is not
 *    `pt-PT`) fills the list first.
 * 2. A small share, `max(1, floor(limit / 4))`, stays reserved for the other
 *    languages when they have hits, spread across them by rank so each shows
 *    while the share allows. One slot always stays for the preferred language.
 * 3. Whatever the preferred language cannot fill goes to the others too.
 *
 * The preferred hits come first, then the others, grouped by language.
 */
export const mergeLanguageSearchHits = <Hit extends SearchHit>(
  perLanguage: ReadonlyArray<LanguageResult<Hit>>,
  limit: number,
  preferredLanguage?: string,
): Array<Hit & { language: string }> => {
  const ranked = perLanguage.flatMap(({ language, result }) => result.hits.map((hit, rank) => ({ hit: { ...hit, language }, rank })));
  const preferred = ranked.filter(({ hit }) => hit.language === preferredLanguage);
  // The other languages, best of each first, so a short share still reaches every language.
  const others = ranked
    .filter(({ hit }) => hit.language !== preferredLanguage)
    .sort((left, right) => left.rank - right.rank || right.hit.score - left.hit.score || left.hit.language.localeCompare(right.hit.language));
  const reserve = preferred.length === 0 ? 0 : Math.min(others.length, Math.max(1, Math.floor(limit / 4)), Math.max(0, limit - 1));
  const keptPreferred = preferred.slice(0, Math.max(0, limit - reserve));
  const keptOthers = others
    .slice(0, Math.max(0, limit - keptPreferred.length))
    .sort((left, right) => left.hit.language.localeCompare(right.hit.language) || left.rank - right.rank);
  return [...keptPreferred, ...keptOthers].map(({ hit }) => hit);
};
