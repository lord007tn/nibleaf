import type { AlternativesRoundup, Comparison } from './comparison-data';

export type ComparisonDataKey =
  | 'gitbookAlternatives'
  | 'mintlifyAlternatives'
  | 'readmeAlternatives'
  | 'nibleafVsDocusaurus'
  | 'nibleafVsGitbook'
  | 'nibleafVsMintlify';

/** Keep the source-heavy comparison registry out of the shared router entry.
 * Explicit property selection avoids a variable import/glob that would eagerly
 * pull unrelated route modules into every public navigation. */
export async function loadComparisonData(key: ComparisonDataKey): Promise<AlternativesRoundup | Comparison> {
  const catalog = await import('./comparison-data');
  return catalog[key];
}
