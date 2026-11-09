import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { addressMayFollowTitle, newlyReadyDeployment, pageNeverPublished, pagePublishState, syncPublishReceipt } from './deployment-cache';
import { queryKeys } from './query-keys';

const deployment = (id: string, status: 'PENDING' | 'BUILDING' | 'READY' | 'FAILED', version = 1) => ({ id, status, version });
const neverPublished = { hasBaseline: false, lastVersion: null, changes: [{ id: 'page-1', status: 'added' }] };
/** page-1 is live; page-2 was edited after the worker captured the publish's pages. */
const editedAfterSnapshot = { hasBaseline: true, lastVersion: 2, changes: [{ id: 'page-2', status: 'modified' }], redirectIssues: [] };
type Pending = typeof editedAfterSnapshot;

const deferred = <T>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

/** A screen showing publish state: an active observer of the pending-changes query. */
const watchPendingChanges = (queryClient: QueryClient, queryFn: () => Promise<Pending>) => {
  const observer = new QueryObserver(queryClient, {
    queryKey: queryKeys.deployments.changes('p1'),
    queryFn,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  return observer.subscribe(() => undefined);
};

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
    // The pre-publish answer is gone: the page is no longer "never published", and its address stops following the title.
    expect(queryClient.getQueryData(changesKey)).toBeUndefined();
    expect(pageNeverPublished('page-1', queryClient.getQueryData(changesKey))).toBe(false);
    expect(addressMayFollowTitle('page-1', queryClient.getQueryData(changesKey), [])).toBe(false);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.deployments.latest('p1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.projects.all(), exact: true });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.projects.detail('p1'), exact: true });
  });

  it('re-reads the site when the first list read shows a live publish the site has not counted yet', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const detailKey = queryKeys.projects.detail('p1');
    // The site was read just before the starter's first publish went live.
    queryClient.setQueryData(detailKey, { id: 'p1', readyPublishes: 0 });
    expect(syncPublishReceipt(queryClient, 'p1', undefined, [deployment('d1', 'READY')])).toBe(false);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: detailKey, exact: true });

    // Already counted, or nothing live: no extra read.
    invalidate.mockClear();
    queryClient.setQueryData(detailKey, { id: 'p1', readyPublishes: 1 });
    syncPublishReceipt(queryClient, 'p1', undefined, [deployment('d1', 'READY')]);
    queryClient.setQueryData(detailKey, { id: 'p1', readyPublishes: 0 });
    syncPublishReceipt(queryClient, 'p1', undefined, [deployment('d1', 'FAILED')]);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('never hides an edit saved after the published snapshot: state is unknown until the server answers', async () => {
    const queryClient = new QueryClient();
    const changesKey = queryKeys.deployments.changes('p1');
    queryClient.setQueryData(changesKey, editedAfterSnapshot);
    const answer = deferred<Pending>();
    const unsubscribe = watchPendingChanges(queryClient, () => answer.promise);

    syncPublishReceipt(queryClient, 'p1', [deployment('d2', 'BUILDING', 2)], [deployment('d2', 'READY', 2)]);
    // While the server re-checks, nothing claims page-2 (or any page) is published.
    expect(pagePublishState('page-2', queryClient.getQueryData(changesKey))).toBeNull();
    await vi.waitFor(() => expect(queryClient.getQueryState(changesKey)?.fetchStatus).toBe('fetching'));

    // The server still lists the later edit as unpublished.
    answer.resolve(editedAfterSnapshot);
    await vi.waitFor(() => expect(queryClient.getQueryData(changesKey)).toEqual(editedAfterSnapshot));
    expect(pagePublishState('page-2', queryClient.getQueryData(changesKey))).toBe('unpublished');
    expect(pagePublishState('page-1', queryClient.getQueryData(changesKey))).toBe('published');
    unsubscribe();
  });

  it('never claims Published when the re-check after READY fails', async () => {
    const queryClient = new QueryClient();
    const changesKey = queryKeys.deployments.changes('p1');
    queryClient.setQueryData(changesKey, editedAfterSnapshot);
    const unsubscribe = watchPendingChanges(queryClient, () => Promise.reject(new Error('offline')));

    syncPublishReceipt(queryClient, 'p1', [deployment('d2', 'BUILDING', 2)], [deployment('d2', 'READY', 2)]);
    await vi.waitFor(() => expect(queryClient.getQueryState(changesKey)?.status).toBe('error'));
    expect(queryClient.getQueryData(changesKey)).toBeUndefined();
    expect(pagePublishState('page-2', queryClient.getQueryData(changesKey))).toBeNull();
    unsubscribe();
  });

  it('ignores a pre-publish answer that was still in flight when the publish went live', async () => {
    const queryClient = new QueryClient();
    const changesKey = queryKeys.deployments.changes('p1');
    const stale = deferred<Pending>();
    const fresh = deferred<Pending>();
    const answers = [stale.promise, fresh.promise];
    const unsubscribe = watchPendingChanges(queryClient, () => answers.shift() ?? fresh.promise);
    expect(queryClient.getQueryState(changesKey)?.fetchStatus).toBe('fetching');

    syncPublishReceipt(queryClient, 'p1', [deployment('d1', 'PENDING')], [deployment('d1', 'READY')]);
    stale.resolve({ ...editedAfterSnapshot, hasBaseline: false, changes: [{ id: 'page-1', status: 'added' }] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queryClient.getQueryData(changesKey)).toBeUndefined();

    fresh.resolve(editedAfterSnapshot);
    await vi.waitFor(() => expect(queryClient.getQueryData(changesKey)).toEqual(editedAfterSnapshot));
    unsubscribe();
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

describe('pagePublishState', () => {
  it('says nothing until the pending-changes answer is known', () => {
    expect(pagePublishState('page-1', undefined)).toBeNull();
  });

  it('calls a page unpublished before the first publish or while it has changes', () => {
    expect(pagePublishState('page-1', neverPublished)).toBe('unpublished');
    expect(pagePublishState('page-2', editedAfterSnapshot)).toBe('unpublished');
    expect(pagePublishState('page-1', editedAfterSnapshot)).toBe('published');
  });
});

describe('addressMayFollowTitle', () => {
  it('follows the title only for a page known to be unpublished', () => {
    expect(addressMayFollowTitle('page-1', neverPublished, [])).toBe(true);
    expect(addressMayFollowTitle('page-1', undefined, [])).toBe(false);
    expect(addressMayFollowTitle('page-1', { hasBaseline: true, lastVersion: 1, changes: [] }, [])).toBe(false);
  });

  it('never follows while a publish may be making the page live', () => {
    expect(addressMayFollowTitle('page-1', neverPublished, [deployment('d1', 'PENDING')])).toBe(false);
    expect(addressMayFollowTitle('page-1', neverPublished, [deployment('d1', 'BUILDING')])).toBe(false);
    expect(addressMayFollowTitle('page-1', neverPublished, [deployment('d1', 'FAILED')])).toBe(true);
  });
});
