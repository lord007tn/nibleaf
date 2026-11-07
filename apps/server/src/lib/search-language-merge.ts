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
 * a code span) outscores the exact English title it was copied from. So:
 *
 * 1. Which hits survive the limit is decided by each hit's rank within its own
 *    language (best of every language first), so no language starves another.
 * 2. The survivors list the preferred language first, then the other
 *    languages, each in its own ranked order. Cross-language results stay
 *    available, just below.
 */
export const mergeLanguageSearchHits = <Hit extends SearchHit>(
  perLanguage: ReadonlyArray<LanguageResult<Hit>>,
  limit: number,
  preferredLanguage?: string,
): Array<Hit & { language: string }> => {
  const ranked = perLanguage.flatMap(({ language, result }) => result.hits.map((hit, rank) => ({ hit: { ...hit, language }, rank })));
  const base = (code?: string) => code?.toLowerCase().split(/[-_]/)[0];
  // Base languages compare, so a reader in `ar` matches an `ar-SA` site language.
  const preferred = (language: string) => (preferredLanguage && base(language) === base(preferredLanguage) ? 0 : 1);
  const survivors = [...ranked]
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        preferred(left.hit.language) - preferred(right.hit.language) ||
        right.hit.score - left.hit.score ||
        left.hit.language.localeCompare(right.hit.language),
    )
    .slice(0, limit);
  return survivors
    .sort(
      (left, right) =>
        preferred(left.hit.language) - preferred(right.hit.language) || left.hit.language.localeCompare(right.hit.language) || left.rank - right.rank,
    )
    .map(({ hit }) => hit);
};
