import type { ClickHouseClient } from '@clickhouse/client';
import { getClickHouseClient } from '../client';
import { keys } from '../keys';
import { type InsightsProjectStatus, readInsightsProjectStatus } from './cache';
import { localMidnight } from './period';
import type { InsightsMeta, SearchTermsVisibility } from './types';

export const SEARCH_TERM_VISIBILITY_THRESHOLD = 2;

export interface InsightsScope {
  tenantId: string;
  projectId: string;
  meta: InsightsMeta;
  visibility: SearchTermsVisibility;
  titles?: ReadonlyMap<string, string>;
  client?: ClickHouseClient;
  preflight?: InsightsProjectStatus | null;
}

export class InsightsReader {
  readonly scope: InsightsScope;
  readonly client: ClickHouseClient;
  readonly params: Record<string, unknown>;
  readonly bucket: string;
  readonly facts: string;
  readonly human: string;

  constructor(scope: InsightsScope) {
    this.scope = { ...scope, meta: { ...scope.meta } };
    this.client = scope.client ?? getClickHouseClient();
    this.params = {
      tenant: scope.tenantId,
      project: scope.projectId,
      timezone: scope.meta.timezone,
      from: scope.meta.current.from,
      to: scope.meta.current.to,
      start: scope.meta.previous?.from ?? scope.meta.current.from,
      show_terms: scope.visibility === 'visible' ? 1 : 0,
      k: SEARCH_TERM_VISIBILITY_THRESHOLD,
    };
    this.bucket =
      scope.meta.granularity === 'hour'
        ? `formatDateTime(toStartOfHour(toTimeZone(occurred_at, {timezone:String})), '%FT%H:%iZ', 'UTC')`
        : `formatDateTime(toTimeZone(occurred_at, {timezone:String}), '%F')`;
    this.facts = `SELECT *, occurred_at >= parseDateTime64BestEffort({from:String}) AS current
      FROM analytics_events FINAL WHERE tenant_id = {tenant:String} AND project_id = {project:String}
      AND occurred_at >= parseDateTime64BestEffort({start:String}) AND occurred_at < parseDateTime64BestEffort({to:String})`;
    this.human = `${this.facts} AND actor_type = 'human'`;
  }

  async ready(): Promise<boolean> {
    if (this.scope.preflight === null) throw new Error('Analytics preflight unavailable');
    const status = this.scope.preflight ?? (await readInsightsProjectStatus(this.scope));
    this.scope.meta.lastEventAt = status.deleted ? null : status.lastEventAt;
    return !status.deleted;
  }

  rows<T>(query: string, extra: Record<string, unknown> = {}): Promise<T[]> {
    return this.client
      .query({
        query,
        query_params: { ...this.params, ...extra },
        format: 'JSONEachRow',
        clickhouse_settings: { output_format_json_quote_64bit_integers: 0, prefer_column_name_to_alias: 1 },
      })
      .then((result) => result.json<T>());
  }

  /** Fill counts only inside known raw coverage. Hour keys are UTC instants so
   * repeated local DST hours remain distinct; daily steps use local midnights. */
  grid<T extends object>(
    rows: (NoInfer<T> & { bucket: string })[],
    empty: T,
    period: 'current' | 'previous' = 'current',
    actor: 'human' | 'crawler' = 'human',
  ): (T & { bucket: string })[] {
    const range = this.scope.meta[period];
    if (!range || !this.covered(period, actor)) return [];
    const points = new Map(rows.map((row) => [row.bucket, row]));
    const result: (T & { bucket: string })[] = [];
    const dateKey = (instant: number) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: this.scope.meta.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(instant));
    const nextDay = (bucket: string) => new Date(Date.parse(bucket) + 86_400_000).toISOString().slice(0, 10);
    const hourStart = (value: number) => {
      const parts = new Intl.DateTimeFormat('en', { timeZone: this.scope.meta.timezone, minute: 'numeric', second: 'numeric' }).formatToParts(
        new Date(value),
      );
      const part = (type: string) => Number(parts.find((item) => item.type === type)?.value ?? 0);
      return value - part('minute') * 60_000 - part('second') * 1000 - (value % 1000);
    };
    const bucketCount = (from: string, to: string) =>
      this.scope.meta.granularity === 'hour'
        ? Math.ceil((Date.parse(to) - hourStart(Date.parse(from))) / 3_600_000)
        : (Date.parse(dateKey(Date.parse(to) - 1)) - Date.parse(dateKey(Date.parse(from)))) / 86_400_000 + 1;
    const other = this.scope.meta[period === 'current' ? 'previous' : 'current'];
    // Equal rolling durations can touch different numbers of local dates at a
    // DST boundary. Pad the shorter edge with a zero-overlap calendar bucket so
    // all real buckets survive and comparison indices remain calendar offsets.
    const count = Math.max(bucketCount(range.from, range.to), other ? bucketCount(other.from, other.to) : 0);
    let instant = Date.parse(range.from);
    if (this.scope.meta.granularity === 'hour') instant = hourStart(instant);
    for (let index = 0; index < count; index += 1) {
      const bucket = this.scope.meta.granularity === 'hour' ? `${new Date(instant).toISOString().slice(0, 16)}Z` : dateKey(instant);
      result.push(points.get(bucket) ?? { ...empty, bucket });
      instant = this.scope.meta.granularity === 'hour' ? instant + 3_600_000 : localMidnight(nextDay(bucket), this.scope.meta.timezone);
    }
    return result;
  }

  title(path: string): string | null {
    return this.scope.titles?.get(path.replace(/^\//u, '')) ?? this.scope.titles?.get(path) ?? null;
  }

  covered(period: 'current' | 'previous', actor: 'human' | 'crawler' = 'human'): boolean {
    const range = this.scope.meta[period];
    if (!range) return false;
    const config = keys();
    const days = actor === 'crawler' ? config.CLICKHOUSE_CRAWLER_RETENTION_DAYS : config.CLICKHOUSE_RAW_RETENTION_DAYS;
    return Date.parse(range.from) >= Date.parse(this.scope.meta.generatedAt) - days * 86_400_000;
  }

  meta(incomplete = false): InsightsMeta {
    const config = keys();
    const oldest = Date.parse(this.scope.meta.previous?.from ?? this.scope.meta.current.from);
    const retention = Math.min(config.CLICKHOUSE_RAW_RETENTION_DAYS, config.CLICKHOUSE_CRAWLER_RETENTION_DAYS);
    return { ...this.scope.meta, availability: incomplete || oldest < Date.now() - retention * 86_400_000 ? 'partial' : 'complete' };
  }
}

/** The docs page a crawler request was for: "/guide.md" (Markdown variant) and
 * "guide" are the same page, so reports group them together. Machine files
 * (llms.txt, robots.txt…) are filtered separately by crawled_resource. */
export const CRAWLED_PAGE = "replaceRegexpAll(path, '^/+|[.]md$', '')";

export const ratio = (numerator: number, denominator: number): number | null => (denominator > 0 ? numerator / denominator : null);
