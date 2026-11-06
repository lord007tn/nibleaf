import type { ClickHouseClient } from '@clickhouse/client';
import { getClickHouseClient } from './client';
import { invalidateInsightsCache } from './insights/cache';
import { ANALYTICS_PROJECT_TABLES } from './tables';

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
  invalidateInsightsCache(tenantId, projectId);
  await Promise.all(
    ANALYTICS_PROJECT_TABLES.filter((table) => !table.preserve).map((table) =>
      client.command({
        query: `ALTER TABLE ${table.name} DELETE WHERE tenant_id = {tenant_id:String} AND project_id = {project_id:String}`,
        query_params: params,
        clickhouse_settings: { mutations_sync: '1' },
      }),
    ),
  );
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
  for (const table of ANALYTICS_PROJECT_TABLES) {
    if (!table.rebuild) continue;
    await client.command({
      query: `ALTER TABLE ${table.name} DELETE WHERE tenant_id = {tenant_id:String} AND project_id = {project_id:String}`,
      query_params: queryParams,
      clickhouse_settings: { mutations_sync: '1' },
    });
    await client.command({ query: `INSERT INTO ${table.name} ${table.rebuild}`, query_params: queryParams });
  }
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
 * session hashes, answer content, and credentials are intentionally excluded.
 * Derived snapshots in ANALYTICS_PROJECT_TABLES are explicitly excluded:
 * analytics_project_activity (only a project freshness timestamp) is also excluded.
 * The watermark has no TTL: the newest receipt must survive all fact retention.
 * The export is an event audit, not a snapshot download. Performance samples,
 * crawler attribution and derived aggregates are intentionally omitted. Sensitive queries and
 * permanent deletion tombstones remain excluded to avoid exposing search text
 * or stable visit hashes. No new table introduces separate subject data. */
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
