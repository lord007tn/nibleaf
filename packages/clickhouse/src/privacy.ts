import type { ClickHouseClient } from '@clickhouse/client';
import { getClickHouseClient } from './client';

export const deleteProjectAnalytics = async (
  tenantId: string,
  projectId: string,
  client: ClickHouseClient = getClickHouseClient('writer'),
): Promise<void> => {
  const params = { tenant_id: tenantId, project_id: projectId };
  await client.insert({
    table: 'analytics_deletion_tombstones',
    format: 'JSONEachRow',
    values: [{ tenant_id: tenantId, project_id: projectId, deleted_at: new Date().toISOString(), reason: 'privacy_deletion' }],
  });
  await Promise.all([
    client.command({
      query: 'ALTER TABLE analytics_events DELETE WHERE tenant_id = {tenant_id:String} AND project_id = {project_id:String}',
      query_params: params,
      clickhouse_settings: { mutations_sync: '1' },
    }),
    client.command({
      query: 'ALTER TABLE analytics_sensitive_queries DELETE WHERE tenant_id = {tenant_id:String} AND project_id = {project_id:String}',
      query_params: params,
      clickhouse_settings: { mutations_sync: '1' },
    }),
    client.command({
      query: 'ALTER TABLE analytics_daily DELETE WHERE tenant_id = {tenant_id:String} AND project_id = {project_id:String}',
      query_params: params,
      clickhouse_settings: { mutations_sync: '1' },
    }),
    client.command({
      query: 'ALTER TABLE analytics_search_daily DELETE WHERE tenant_id = {tenant_id:String} AND project_id = {project_id:String}',
      query_params: params,
      clickhouse_settings: { mutations_sync: '1' },
    }),
    client.command({
      query: 'ALTER TABLE analytics_hourly DELETE WHERE tenant_id = {tenant_id:String} AND project_id = {project_id:String}',
      query_params: params,
      clickhouse_settings: { mutations_sync: '1' },
    }),
    client.command({
      query: 'ALTER TABLE analytics_search_hourly DELETE WHERE tenant_id = {tenant_id:String} AND project_id = {project_id:String}',
      query_params: params,
      clickhouse_settings: { mutations_sync: '1' },
    }),
  ]);
};

/** Rebuild one project's projections from deduplicated raw facts. Run while
 * relational reads remain authoritative; delete + refill is intentionally not
 * presented as an atomic ClickHouse operation. */
export const rebuildProjectAnalyticsRollups = async (
  tenantId: string,
  projectId: string,
  client: ClickHouseClient = getClickHouseClient('writer'),
): Promise<void> => {
  const queryParams = { tenant_id: tenantId, project_id: projectId };
  for (const table of ['analytics_daily', 'analytics_search_daily', 'analytics_hourly', 'analytics_search_hourly']) {
    await client.command({
      query: `ALTER TABLE ${table} DELETE WHERE tenant_id = {tenant_id:String} AND project_id = {project_id:String}`,
      query_params: queryParams,
      clickhouse_settings: { mutations_sync: '1' },
    });
  }
  await client.command({
    query: `INSERT INTO analytics_daily
      SELECT toDate(occurred_at) AS day, tenant_id, project_id, event_name, path, language, device, referrer_domain,
        uniqCombined64State(event_id) AS event_ids, uniqCombined64State(session_hash) AS sessions
      FROM analytics_events FINAL
      WHERE tenant_id = {tenant_id:String} AND project_id = {project_id:String}
        AND (tenant_id, project_id) NOT IN (SELECT tenant_id, project_id FROM analytics_deletion_tombstones FINAL)
      GROUP BY day, tenant_id, project_id, event_name, path, language, device, referrer_domain`,
    query_params: queryParams,
  });
  await client.command({
    query: `INSERT INTO analytics_search_daily
      SELECT toDate(occurred_at), tenant_id, project_id, event_id, received_at, event_name, provider, model, cache_status, no_answer_reason,
        latency_ms, latency_known, result_count, prompt_tokens, completion_tokens, cost_micros, prompt_tokens_known, completion_tokens_known, cost_micros_known
      FROM analytics_events FINAL
      WHERE tenant_id = {tenant_id:String} AND project_id = {project_id:String}
        AND (tenant_id, project_id) NOT IN (SELECT tenant_id, project_id FROM analytics_deletion_tombstones FINAL)
        AND (event_name LIKE 'search_%' OR event_name LIKE 'answer_%' OR event_name LIKE 'citation_%')`,
    query_params: queryParams,
  });
  await client.command({
    query: `INSERT INTO analytics_hourly
      SELECT toStartOfHour(occurred_at) AS hour, tenant_id, project_id, event_name, path, language, device, referrer_domain,
        uniqCombined64State(event_id) AS event_ids, uniqCombined64State(session_hash) AS sessions
      FROM analytics_events FINAL
      WHERE tenant_id = {tenant_id:String} AND project_id = {project_id:String}
        AND (tenant_id, project_id) NOT IN (SELECT tenant_id, project_id FROM analytics_deletion_tombstones FINAL)
      GROUP BY hour, tenant_id, project_id, event_name, path, language, device, referrer_domain`,
    query_params: queryParams,
  });
  await client.command({
    query: `INSERT INTO analytics_search_hourly
      SELECT toStartOfHour(occurred_at), tenant_id, project_id, event_id, received_at, event_name, provider, model, cache_status, no_answer_reason,
        latency_ms, latency_known, result_count, prompt_tokens, completion_tokens, cost_micros, prompt_tokens_known, completion_tokens_known, cost_micros_known
      FROM analytics_events FINAL
      WHERE tenant_id = {tenant_id:String} AND project_id = {project_id:String}
        AND (tenant_id, project_id) NOT IN (SELECT tenant_id, project_id FROM analytics_deletion_tombstones FINAL)
        AND (event_name LIKE 'search_%' OR event_name LIKE 'answer_%' OR event_name LIKE 'citation_%')`,
    query_params: queryParams,
  });
};

export interface ExportedAnalyticsEvent {
  eventId: string;
  occurredAt: string;
  receivedAt: string;
  eventName: string;
  source: string;
  consentState: string;
  path: string;
  language: string;
  country: string;
  device: string;
  resultCount: number;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  costMicros: number | null;
}

/** Content-free data-subject/project export. Raw search terms, query hashes,
 * session hashes, answer content, and credentials are intentionally excluded. */
export const exportProjectAnalytics = async (
  tenantId: string,
  projectId: string,
  options: { limit?: number; before?: string } = {},
  client: ClickHouseClient = getClickHouseClient('reader'),
): Promise<ExportedAnalyticsEvent[]> => {
  const limit = Math.min(100_000, Math.max(1, options.limit ?? 10_000));
  const result = await client.query({
    query: `SELECT
      toString(event_id) AS eventId,
      toString(occurred_at) AS occurredAt,
      toString(received_at) AS receivedAt,
      event_name AS eventName,
      source,
      consent_state AS consentState,
      path,
      language,
      country,
      device,
      result_count AS resultCount,
      latency_ms AS latencyMs,
      if(prompt_tokens_known = 1, prompt_tokens, NULL) AS promptTokens,
      if(completion_tokens_known = 1, completion_tokens, NULL) AS completionTokens,
      if(cost_micros_known = 1, cost_micros, NULL) AS costMicros
    FROM analytics_events FINAL
    WHERE tenant_id = {tenant_id:String}
      AND project_id = {project_id:String}
      AND (tenant_id, project_id) NOT IN (SELECT tenant_id, project_id FROM analytics_deletion_tombstones FINAL)
      AND occurred_at < parseDateTime64BestEffort({before:String})
    ORDER BY occurred_at DESC, event_id DESC
    LIMIT {limit:UInt32}`,
    query_params: {
      tenant_id: tenantId,
      project_id: projectId,
      before: options.before ?? new Date(Date.now() + 60_000).toISOString(),
      limit,
    },
    format: 'JSONEachRow',
  });
  return result.json<ExportedAnalyticsEvent>();
};
