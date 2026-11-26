import type { AnalyticsInsightsQuery } from '@nibleaf/validators';
import { DEFAULT_INSIGHTS_RANGE, type InsightsSearch, isPreset, validateInsightsSearch } from './filters';

// Apart from filters.ts: route validateSearch can't be code-split, so filters.ts
// is in every page's first load (published docs included); this mapping is only
// needed by the analytics sections and their route loaders, which load lazily.

/** The API query for the current URL filters, in the viewer's timezone. */
export function toInsightsQuery(search: InsightsSearch, timezone: string): AnalyticsInsightsQuery {
  const compare = search.compare === 'none' ? 'none' : 'previous';
  if (search.range === 'custom' && search.from && search.to) return { range: 'custom', from: search.from, to: search.to, timezone, compare };
  return { range: isPreset(search.range) ? search.range : DEFAULT_INSIGHTS_RANGE, timezone, compare };
}

/** The viewer's IANA timezone; every insights query is bucketed in it. */
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * The API query for a route's raw search params: the same validation and
 * mapping `useInsightsFilters` applies, so an analytics route loader prefetches
 * exactly the entry its section then reads. Prefetching is browser-only, so the
 * browser timezone is the one the section uses too.
 */
export function insightsQueryForSearch(search: Record<string, unknown>): AnalyticsInsightsQuery {
  return toInsightsQuery(validateInsightsSearch(search), browserTimezone());
}
