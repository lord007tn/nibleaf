import { getClickHouseClient } from '../client';
import { clickHouseReadsEnabled, keys } from '../keys';
import type { InsightsScope } from './reader';
import type { InsightsMeta } from './types';

export interface InsightsProjectStatus {
  deleted: boolean;
  lastEventAt: string | null;
}

export const readInsightsProjectStatus = async (scope: InsightsScope): Promise<InsightsProjectStatus> => {
  const result = await (scope.client ?? getClickHouseClient()).query({
    query: `SELECT (SELECT count() FROM analytics_deletion_tombstones FINAL WHERE tenant_id = {tenant:String} AND project_id = {project:String}) AS deleted,
      formatDateTime(maxOrNull(received_at), '%FT%T.%fZ', 'UTC') AS lastEventAt
      FROM analytics_events FINAL WHERE tenant_id = {tenant:String} AND project_id = {project:String} AND actor_type = 'human'`,
    query_params: { tenant: scope.tenantId, project: scope.projectId },
    format: 'JSONEachRow',
  });
  const row = (await result.json<{ deleted: number; lastEventAt: string | null }>())[0];
  return { deleted: Number(row?.deleted ?? 0) > 0, lastEventAt: row?.lastEventAt ?? null };
};

const cache = new Map<string, { tenantId: string; projectId: string; expires: number; value: { meta: InsightsMeta } }>();
const ttlMs = 30_000;

export const invalidateInsightsCache = (tenantId: string, projectId: string): void => {
  for (const [key, entry] of cache) if (entry.tenantId === tenantId && entry.projectId === projectId) cache.delete(key);
};

/** Called by server actions after authorization and current privacy settings.
 * Cache hits still perform the single erasure/freshness preflight. This keeps
 * erasure immediate across API/worker processes, without a distributed cache
 * invalidation race. Query failures are never retained. */
export const withInsightsCache = async <T extends { meta: InsightsMeta }>(
  scope: InsightsScope,
  normalizedKey: string,
  load: (scope: InsightsScope) => Promise<T>,
): Promise<T> => {
  if (!clickHouseReadsEnabled(keys().ANALYTICS_MODE)) return load(scope);
  const key = JSON.stringify([scope.tenantId, scope.projectId, scope.visibility, normalizedKey]);
  const entry = cache.get(key);
  if (entry && entry.expires > Date.now()) {
    try {
      const status = await readInsightsProjectStatus(scope);
      if (status.deleted) {
        invalidateInsightsCache(scope.tenantId, scope.projectId);
        return load({ ...scope, preflight: status });
      }
      cache.delete(key);
      cache.set(key, entry);
      // Every entry is loaded using this exact endpoint/query key. Return a copy
      // so response enrichment cannot mutate another request's cached result.
      return { ...structuredClone(entry.value), meta: { ...entry.value.meta, lastEventAt: status.lastEventAt } } as T;
    } catch {
      return load({ ...scope, preflight: null });
    }
  }
  if (entry) cache.delete(key);
  const value = await load(scope);
  if (value.meta.availability === 'complete' || value.meta.availability === 'partial') {
    cache.set(key, { tenantId: scope.tenantId, projectId: scope.projectId, expires: Date.now() + ttlMs, value: structuredClone(value) });
    if (cache.size > 128) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
  }
  return value;
};
