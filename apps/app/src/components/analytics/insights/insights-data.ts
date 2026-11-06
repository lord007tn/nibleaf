import type { AiVisibilityInsights, CrawlerCategory, FeedbackInsights, InsightsAvailability, SeriesPoint } from '@/hooks/api/analytics';

/* Pure data helpers for the insights sections (kept out of component files). */

/** What a section can show, derived once from the query state. */
export interface InsightsState {
  loading: boolean;
  /** null while the first response is loading. */
  availability: InsightsAvailability | null;
  /** True when figures are unknown (unavailable, not configured or a failed request). */
  unknown: boolean;
  /** Newest human event ever received for the project; null = none yet, undefined = not known. */
  lastEventAt?: string | null;
}

export function insightsState(query: {
  isPending: boolean;
  isError: boolean;
  data?: { meta: { availability: InsightsAvailability; lastEventAt?: string | null } };
}): InsightsState {
  if (query.isError && !query.data) return { loading: false, availability: 'unavailable', unknown: true };
  if (query.isPending || !query.data) return { loading: true, availability: null, unknown: false };
  const { availability, lastEventAt } = query.data.meta;
  return { loading: false, availability, unknown: availability === 'unavailable' || availability === 'not_configured', lastEventAt };
}

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/** fresh: data arrived within a day · stale: nothing for over a day · never: no reader ever · unknown: not reported. */
export function dataFreshness(lastEventAt: string | null | undefined, now = Date.now()): 'fresh' | 'stale' | 'never' | 'unknown' {
  if (lastEventAt === undefined) return 'unknown';
  if (lastEventAt === null) return 'never';
  const at = Date.parse(lastEventAt);
  if (Number.isNaN(at)) return 'unknown';
  return now - at > STALE_AFTER_MS ? 'stale' : 'fresh';
}

export type TrendRow = { bucket: string } & Record<string, number | string | null>;

/** Rows for a current series with the previous period overlaid point-by-point (same position in the period). */
export function alignWithPrevious(current: SeriesPoint[], previous: SeriesPoint[]): TrendRow[] {
  return current.map((point, index) => ({ bucket: point.bucket, current: point.value, previous: previous[index]?.value ?? null }));
}

/** Rows for several series that share the same buckets. */
export function mergeSeries(series: Array<{ key: string; points: SeriesPoint[] }>): TrendRow[] {
  const rows = new Map<string, TrendRow>();
  for (const { key, points } of series) {
    for (const point of points) {
      const row: TrendRow = rows.get(point.bucket) ?? { bucket: point.bucket };
      row[key] = point.value;
      rows.set(point.bucket, row);
    }
  }
  return [...rows.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
}

/** Five chart series: the three AI kinds, classic search engines, and everything else. */
export const CHART_GROUPS = ['ai_training', 'ai_search', 'ai_assistant', 'search_engine', 'other'] as const;
type ChartGroup = (typeof CHART_GROUPS)[number];
const chartGroup = (category: CrawlerCategory): ChartGroup =>
  (CHART_GROUPS as readonly string[]).includes(category) ? (category as ChartGroup) : 'other';

/** Sum the per-category series into the five chart groups, bucket by bucket. */
export function groupCrawlerSeries(series: AiVisibilityInsights['crawlerSeries']) {
  const grouped = new Map<ChartGroup, Map<string, number>>();
  for (const { category, points } of series) {
    const group = chartGroup(category);
    const buckets = grouped.get(group) ?? new Map<string, number>();
    for (const point of points) buckets.set(point.bucket, (buckets.get(point.bucket) ?? 0) + point.value);
    grouped.set(group, buckets);
  }
  return [...grouped.entries()].map(([key, buckets]) => ({ key, points: [...buckets.entries()].map(([bucket, value]) => ({ bucket, value })) }));
}

type FeedbackPage = FeedbackInsights['pages'][number];

/** Worst first: lowest helpful rate, then most "not helpful" votes; pages without votes last. */
export function sortWorstFirst(pages: FeedbackPage[]): FeedbackPage[] {
  return [...pages].sort((a, b) => {
    if (a.helpfulRate === null || b.helpfulRate === null) return a.helpfulRate === null ? (b.helpfulRate === null ? 0 : 1) : -1;
    return a.helpfulRate - b.helpfulRate || b.notHelpful - a.notHelpful;
  });
}
