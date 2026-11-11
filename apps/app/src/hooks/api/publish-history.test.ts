import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/api', () => ({ api: {} }));

import { publishHistoryDetailQueryOptions, publishHistoryQueryOptions } from './publish-history';
import { queryKeys } from './query-keys';

const row = (version: number, status: string) => ({ id: `dep-${version}`, version, status });

describe('publish history queries', () => {
  it('lives under the site’s deployments key, so every publish and rollback refreshes it', () => {
    const prefix = queryKeys.deployments.all('site-1');
    expect(publishHistoryQueryOptions('site-1').queryKey.slice(0, prefix.length)).toEqual(prefix);
    expect(publishHistoryDetailQueryOptions('site-1', 'dep-1').queryKey.slice(0, prefix.length)).toEqual(prefix);
  });

  it('pages back by the version cursor until the server says there is no more', () => {
    const { getNextPageParam } = publishHistoryQueryOptions('site-1');
    const next = (nextCursor: number | null) => getNextPageParam({ items: [], nextCursor, live: null }, [], undefined, [undefined]);
    expect(next(6)).toBe(6);
    expect(next(null)).toBeUndefined();
  });

  it('re-reads while an attempt is queued or building, and stops once all have settled', () => {
    const interval = publishHistoryQueryOptions('site-1').refetchInterval as (query: unknown) => number | false;
    const withRows = (rows: object[]) => ({ state: { data: { pages: [{ items: rows }] } } });
    expect(interval(withRows([row(3, 'BUILDING'), row(2, 'READY')]))).toBeGreaterThan(0);
    expect(interval(withRows([row(3, 'PENDING')]))).toBeGreaterThan(0);
    expect(interval(withRows([row(3, 'FAILED'), row(2, 'READY')]))).toBe(false);
    const detailInterval = publishHistoryDetailQueryOptions('site-1', 'dep-3').refetchInterval as (query: unknown) => number | false;
    expect(detailInterval({ state: { data: { deployment: row(3, 'BUILDING') } } })).toBeGreaterThan(0);
    expect(detailInterval({ state: { data: { deployment: row(3, 'READY') } } })).toBe(false);
  });
});
