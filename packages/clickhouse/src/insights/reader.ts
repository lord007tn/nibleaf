import type { ClickHouseClient } from '@clickhouse/client';
import { getClickHouseClient } from '../client';
import { keys } from '../keys';
import { type InsightsProjectStatus, readInsightsProjectStatus } from './cache';
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
    this.bucket = `formatDateTime(toTimeZone(occurred_at, {timezone:String}), '${scope.meta.granularity === 'hour' ? '%FT%H:00' : '%F'}')`;
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

export const ratio = (numerator: number, denominator: number): number | null => (denominator > 0 ? numerator / denominator : null);
