import type { AnalyticsInsightsQuery } from '@nibleaf/validators';

const INSIGHTS_PRESETS = ['24h', '7d', '30d', '90d'] as const;
export type InsightsPreset = (typeof INSIGHTS_PRESETS)[number];
type InsightsRange = InsightsPreset | 'custom';

/** The analytics filters as they live in the URL. Defaults (30 days, compare on)
 * are left out so a plain `/analytics` link and a shared default view match. */
export interface InsightsSearch {
  range?: InsightsRange;
  from?: string;
  to?: string;
  compare?: 'none';
}

const DEFAULT_INSIGHTS_RANGE: InsightsPreset = '30d';
const MAX_CUSTOM_DAYS = 366;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const isPreset = (value: unknown): value is InsightsPreset => INSIGHTS_PRESETS.includes(value as InsightsPreset);

const isIsoDay = (value: unknown): value is string => typeof value === 'string' && ISO_DAY.test(value) && !Number.isNaN(Date.parse(value));

/** Why a custom range is rejected, or null when it is valid. */
export function customRangeError(from: string, to: string): 'missing' | 'order' | 'tooLong' | null {
  if (!(isIsoDay(from) && isIsoDay(to))) return 'missing';
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (days < 0) return 'order';
  if (days >= MAX_CUSTOM_DAYS) return 'tooLong';
  return null;
}

/** Route `validateSearch`: unknown or invalid values fall back to the defaults
 * instead of throwing, so a hand-edited or stale link still opens. */
export function validateInsightsSearch(search: Record<string, unknown>): InsightsSearch {
  const compare = search.compare === 'none' ? ({ compare: 'none' } as const) : {};
  if (search.range === 'custom' && isIsoDay(search.from) && isIsoDay(search.to) && customRangeError(search.from, search.to) === null) {
    return { range: 'custom', from: search.from, to: search.to, ...compare };
  }
  if (isPreset(search.range) && search.range !== DEFAULT_INSIGHTS_RANGE) return { range: search.range, ...compare };
  return compare;
}

/** The API query for the current URL filters, in the viewer's timezone. */
export function toInsightsQuery(search: InsightsSearch, timezone: string): AnalyticsInsightsQuery {
  const compare = search.compare === 'none' ? 'none' : 'previous';
  if (search.range === 'custom' && search.from && search.to) return { range: 'custom', from: search.from, to: search.to, timezone, compare };
  return { range: isPreset(search.range) ? search.range : DEFAULT_INSIGHTS_RANGE, timezone, compare };
}

/** `YYYY-MM-DD` for a local calendar day (date inputs speak local days, not UTC). */
export function localIsoDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The search params that carry the filters across section links (drops section-only params like `path`). */
export function filterSearch(search: InsightsSearch): InsightsSearch {
  return validateInsightsSearch(search as Record<string, unknown>);
}
