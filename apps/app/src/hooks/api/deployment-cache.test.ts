import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { addressMayFollowTitle, newlyReadyDeployment, pageNeverPublished, projectPublishedChanges, syncPublishReceipt } from './deployment-cache';
import { queryKeys } from './query-keys';

const deployment = (id: string, status: 'PENDING' | 'BUILDING' | 'READY' | 'FAILED', version = 1) => ({ id, status, version });
const neverPublished = { hasBaseline: false, lastVersion: null, changes: [{ id: 'page-1', status: 'added' }] };

describe('newlyReadyDeployment', () => {
  it('ignores the first read, which only describes past publishes', () => {
    expect(newlyReadyDeployment(undefined, [deployment('d1', 'READY')])).toBeNull();
  });

  it('finds a publish that went from in flight to READY', () => {
    expect(
      newlyReadyDeployment([deployment('d2', 'BUILDING', 2), deployment('d1', 'READY')], [deployment('d2', 'READY', 2), deployment('d1', 'READY')]),
    ).toEqual(deployment('d2', 'READY', 2));
  });

  it('finds a publish a fast worker finished before it was ever listed', () => {
    expect(newlyReadyDeployment([deployment('d1', 'READY')], [deployment('d2', 'READY', 2), deployment('d1', 'READY')])?.id).toBe('d2');
  });

  it('does not treat failed or still-running publishes as live', () => {
    expect(newlyReadyDeployment([deployment('d2', 'PENDING', 2)], [deployment('d2', 'FAILED', 2)])).toBeNull();
    expect(newlyReadyDeployment([deployment('d2', 'PENDING', 2)], [deployment('d2', 'BUILDING', 2)])).toBeNull();
    expect(newlyReadyDeployment([deployment('d1', 'READY')], [deployment('d1', 'READY')])).toBeNull();
  });
});

describe('syncPublishReceipt', () => {
  it('stops treating pages as never published as soon as the first publish is READY, then refetches', () => {
    const queryClient = new QueryClient();
    const changesKey = queryKeys.deployments.changes('p1');
    queryClient.setQueryData(changesKey, { ...neverPublished, redirectIssues: [] });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    // The worker is slower than the changes refetch that followed the publish request.
    expect(syncPublishReceipt(queryClient, 'p1', [], [deployment('d1', 'PENDING')])).toBe(false);
    expect(pageNeverPublished('page-1', queryClient.getQueryData(changesKey))).toBe(true);

    expect(syncPublishReceipt(queryClient, 'p1', [deployment('d1', 'PENDING')], [deployment('d1', 'READY')])).toBe(true);
    const projected = queryClient.getQueryData<typeof neverPublished & { redirectIssues: unknown[] }>(changesKey);
    expect(projected).toEqual({ hasBaseline: true, lastVersion: 1, changes: [], redirectIssues: [] });
    expect(pageNeverPublished('page-1', projected)).toBe(false);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: changesKey });
    expect(queryClient.getQueryState(changesKey)?.isInvalidated).toBe(true);
  });

  it('leaves the cache alone while the publish is still running', () => {
    const queryClient = new QueryClient();
    const changesKey = queryKeys.deployments.changes('p1');
    queryClient.setQueryData(changesKey, neverPublished);
    syncPublishReceipt(queryClient, 'p1', [deployment('d1', 'PENDING')], [deployment('d1', 'BUILDING')]);
    expect(queryClient.getQueryData(changesKey)).toBe(neverPublished);
    expect(queryClient.getQueryState(changesKey)?.isInvalidated).toBe(false);
  });
});

describe('addressMayFollowTitle', () => {
  it('follows the title only for a page known to be unpublished', () => {
    expect(addressMayFollowTitle('page-1', neverPublished, [])).toBe(true);
    expect(addressMayFollowTitle('page-1', undefined, [])).toBe(false);
    expect(addressMayFollowTitle('page-1', projectPublishedChanges(neverPublished, 1), [])).toBe(false);
  });

  it('never follows while a publish may be making the page live', () => {
    expect(addressMayFollowTitle('page-1', neverPublished, [deployment('d1', 'PENDING')])).toBe(false);
    expect(addressMayFollowTitle('page-1', neverPublished, [deployment('d1', 'BUILDING')])).toBe(false);
    expect(addressMayFollowTitle('page-1', neverPublished, [deployment('d1', 'FAILED')])).toBe(true);
  });
});
