import type { ClickHouseClient } from '@clickhouse/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidateInsightsCache, withInsightsCache } from './cache';
import { resolveInsightsMeta } from './period';

describe('scoped insights cache', () => {
  const query = vi.fn();
  const scope = {
    tenantId: 'cache-tenant',
    projectId: 'cache-project',
    visibility: 'visible' as const,
    meta: resolveInsightsMeta({ range: '7d', timezone: 'UTC', compare: 'none' }),
    client: { query } as unknown as ClickHouseClient,
  };
  beforeEach(() => {
    invalidateInsightsCache(scope.tenantId, scope.projectId);
    query.mockReset().mockResolvedValue({ json: async () => [{ deleted: 0, lastEventAt: '2026-11-06T00:00:00.000Z' }] });
  });
  it('reuses results while checking erasure/freshness and isolates tenants', async () => {
    const load = vi.fn(async () => ({ meta: scope.meta, count: 42 }));
    await withInsightsCache(scope, 'overview/7d', load);
    const cached = await withInsightsCache(scope, 'overview/7d', load);
    expect(load).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledOnce();
    expect(cached.meta.lastEventAt).toBe('2026-11-06T00:00:00.000Z');
    await withInsightsCache({ ...scope, tenantId: 'another' }, 'overview/7d', load);
    expect(load).toHaveBeenCalledTimes(2);
  });
  it('never caches unavailable responses and bypasses erased scopes', async () => {
    const load = vi.fn(async () => ({ meta: { ...scope.meta, availability: 'unavailable' as const } }));
    await withInsightsCache(scope, 'search', load);
    await withInsightsCache(scope, 'search', load);
    expect(load).toHaveBeenCalledTimes(2);
    const available = vi.fn(async () => ({ meta: scope.meta }));
    await withInsightsCache(scope, 'overview', available);
    query.mockResolvedValue({ json: async () => [{ deleted: 1, lastEventAt: null }] });
    await withInsightsCache(scope, 'overview', available);
    expect(available).toHaveBeenLastCalledWith(expect.objectContaining({ preflight: { deleted: true, lastEventAt: null } }));
  });
});
