import type { ClickHouseClient } from '@clickhouse/client';
import { getClickHouseClient } from './client';
import { keys } from './keys';
import { insightsRollups } from './tables';

export const listActiveAnalyticsProjects = async (client: ClickHouseClient = getClickHouseClient('writer')) => {
  const result = await client.query({
    query: `SELECT DISTINCT tenant_id AS tenantId, project_id AS projectId FROM analytics_events
      WHERE received_at >= now() - INTERVAL 1 DAY
      AND (tenant_id, project_id) NOT IN (SELECT tenant_id, project_id FROM analytics_deletion_tombstones FINAL)`,
    format: 'JSONEachRow',
  });
  return result.json<{ tenantId: string; projectId: string }>();
};

/** Scheduled worker callers hold the tenant fence. Preserve buckets older than
 * retained raw history: deleting and refilling those would destroy history.
 * The one-day safety margin avoids replacing a partially expired UTC bucket.
 * Snapshots remain advisory until a freshness/coverage ledger is introduced;
 * insights therefore use scoped FINAL facts and report partial beyond raw TTL. */
export const refreshProjectInsightsRollups = async (
  tenantId: string,
  projectId: string,
  client: ClickHouseClient = getClickHouseClient('writer'),
  options: { writeFence?: (write: () => Promise<void>) => Promise<unknown> } = {},
) => {
  const params = {
    tenant: tenantId,
    project: projectId,
    tenant_id: tenantId,
    project_id: projectId,
    days: Math.max(1, Math.min(keys().CLICKHOUSE_RAW_RETENTION_DAYS, keys().CLICKHOUSE_CRAWLER_RETENTION_DAYS) - 1),
  };
  for (const table of insightsRollups) {
    const write = async () => {
      await client.command({
        query: `ALTER TABLE ${table.name} DELETE WHERE tenant_id = {tenant:String} AND project_id = {project:String}
        AND ${table.time} >= toDate(now() - toIntervalDay({days:UInt16}))`,
        query_params: params,
        clickhouse_settings: { mutations_sync: '1' },
      });
      await client.command({
        query: `INSERT INTO ${table.name} SELECT * FROM (${table.select}) WHERE ${table.time} >= toDate(now() - toIntervalDay({days:UInt16}))`,
        query_params: params,
        clickhouse_settings: { max_execution_time: 4 },
      });
    };
    if (options.writeFence) await options.writeFence(write);
    else await write();
  }
};
