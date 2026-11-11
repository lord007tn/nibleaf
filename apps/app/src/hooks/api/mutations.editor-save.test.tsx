// @vitest-environment jsdom
import { onlineManager, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';
import { useCreatePage, useUpdatePage } from './mutations';
import { queryKeys } from './query-keys';
import { pageQueryOptions, pagesQueryOptions } from './query-options';
import type { Page, PageNode } from './types';

const mocks = vi.hoisted(() => ({ patch: vi.fn(), post: vi.fn(), toast: vi.fn() }));
vi.mock('@/services/api', () => ({ api: { app: { projects: { ':projectId': { pages: { $post: mocks.post, ':id': { $patch: mocks.patch } } } } } } }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('sonner', () => ({ toast: { error: mocks.toast } }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});
const page = { id: 'a', title: 'Old', content: 'body', updatedAt: 'revision-1', path: '/old', slug: 'old' };
const json = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
async function mount() {
  const client = createQueryClient();
  const container = document.createElement('div');
  const root = createRoot(container);
  let hooks!: { update: ReturnType<typeof useUpdatePage>; create: ReturnType<typeof useCreatePage> };
  function Probe() {
    hooks = { update: useUpdatePage('p'), create: useCreatePage('p') };
    return null;
  }
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    ),
  );
  return {
    client,
    hooks: () => hooks,
    close: () => {
      act(() => root.unmount());
      client.clear();
    },
  };
}
it('AUTH-15: autosave updates detail and list rows from the response without page refetches', async () => {
  const probe = await mount();
  const counts = { lists: 0, detail: 0, changes: 0 };
  const watch = (key: readonly unknown[], kind: keyof typeof counts, data: unknown) => {
    probe.client.setQueryData(key, data);
    const observer = new QueryObserver(probe.client, {
      queryKey: key,
      queryFn: async () => {
        counts[kind]++;
        return data;
      },
      staleTime: Number.POSITIVE_INFINITY,
    });
    return observer.subscribe(() => undefined);
  };
  const stops = [
    watch(queryKeys.pages.all('p'), 'lists', [page]),
    watch(queryKeys.pages.all('p', 'en'), 'lists', [page]),
    watch(queryKeys.pages.detail('p', 'a'), 'detail', page),
    watch(queryKeys.deployments.changes('p'), 'changes', {}),
  ];
  const saved = { ...page, title: 'New', content: 'new body', updatedAt: 'revision-2', addressChanged: false };
  mocks.patch.mockResolvedValue(json(saved));
  await act(async () => {
    await probe.hooks().update.mutateAsync({ pageId: 'a', body: { title: 'New', content: 'new body' } });
  });
  console.log('AUTH-15 measured queryFn refetches', counts, 'PATCH', mocks.patch.mock.calls.length);
  expect(counts.lists).toBe(0);
  expect(counts.detail).toBe(0);
  expect(probe.client.getQueryData(queryKeys.pages.detail('p', 'a'))).toEqual(saved);
  expect(probe.client.getQueryData(queryKeys.pages.all('p'))).toEqual([expect.objectContaining({ title: 'New', updatedAt: 'revision-2' })]);
  stops.forEach((stop) => {
    stop();
  });
  probe.close();
});
it('AUTH-07: failed creation reports a localized error without phantom rows or pending state', async () => {
  const probe = await mount();
  probe.client.setQueryData(queryKeys.pages.all('p'), [page]);
  mocks.post.mockRejectedValue(new Error('Server refused'));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await act(async () => {
    await probe
      .hooks()
      .create.mutateAsync({ title: 'New', languageId: 'en' })
      .catch(() => undefined);
  });
  await vi.waitFor(() => expect(probe.hooks().create.isPending).toBe(false));
  expect(probe.client.getQueryData(queryKeys.pages.all('p'))).toEqual([page]);
  await vi.waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('editor.createFailed'));
  probe.close();
});

it('AUTH-16: offline autosaves reject instead of remaining paused and pending', async () => {
  const probe = await mount();
  onlineManager.setOnline(false);
  mocks.patch.mockRejectedValue(new TypeError('Failed to fetch'));
  try {
    await act(async () => {
      await expect(probe.hooks().update.mutateAsync({ pageId: 'a', body: { content: 'offline draft' } })).rejects.toThrow('Failed to fetch');
    });
    await vi.waitFor(() => expect(probe.hooks().update.isPending).toBe(false));
    expect(probe.hooks().update.isPaused).toBe(false);
  } finally {
    onlineManager.setOnline(true);
    probe.close();
  }
});

/** A promise resolved from the test, to order responses. */
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const at = (minute: number) => new Date(Date.UTC(2026, 10, 11, 12, minute)).toISOString();

it('a save response that arrives after a newer one never puts back older page data', async () => {
  const probe = await mount();
  const original = { ...page, title: 'Original', updatedAt: at(0) };
  probe.client.setQueryData(queryKeys.pages.detail('p', 'a'), original);
  probe.client.setQueryData(queryKeys.pages.all('p'), [original]);
  const autosave = deferred<Response>();
  const rename = deferred<Response>();
  mocks.patch.mockReturnValueOnce(autosave.promise).mockReturnValueOnce(rename.promise);
  let first!: Promise<unknown>;
  let second!: Promise<unknown>;
  await act(async () => {
    first = probe.hooks().update.mutateAsync({ pageId: 'a', body: { content: 'typed' } });
    second = probe.hooks().update.mutateAsync({ pageId: 'a', body: { title: 'Renamed' } });
  });
  // The rename (revision 3) lands first, then the earlier autosave (revision 2).
  await act(async () => {
    rename.resolve(json({ ...original, title: 'Renamed', updatedAt: at(3), addressChanged: false }));
    await second;
  });
  await act(async () => {
    autosave.resolve(json({ ...original, content: 'typed', updatedAt: at(2), addressChanged: false }));
    await first;
  });
  expect(probe.client.getQueryData(queryKeys.pages.detail('p', 'a'))).toMatchObject({ title: 'Renamed', updatedAt: at(3) });
  expect(probe.client.getQueryData(queryKeys.pages.all('p'))).toEqual([expect.objectContaining({ title: 'Renamed', updatedAt: at(3) })]);
  probe.close();
});

it('a page list or page read that started before a save and resolves after it keeps the saved data', async () => {
  const probe = await mount();
  // Only the fields the cache logic reads; the rest of a page is irrelevant here.
  const original = { ...page, title: 'Original', updatedAt: at(0) } as unknown as Page & PageNode;
  probe.client.setQueryData(pagesQueryOptions('p').queryKey, [original]);
  probe.client.setQueryData(pageQueryOptions('p', 'a').queryKey, original);
  const listRead = deferred<(typeof original)[]>();
  const pageRead = deferred<typeof original>();
  const lists = new QueryObserver(probe.client, { ...pagesQueryOptions('p'), queryFn: () => listRead.promise, staleTime: 0 });
  const detail = new QueryObserver(probe.client, { ...pageQueryOptions('p', 'a'), queryFn: () => pageRead.promise, staleTime: 0 });
  const stops = [lists.subscribe(() => undefined), detail.subscribe(() => undefined)];
  // Both reads are in flight (with the old revision) when the save completes.
  const reads = [lists.refetch(), detail.refetch()];
  mocks.patch.mockResolvedValue(json({ ...original, title: 'Saved', updatedAt: at(1), addressChanged: false }));
  await act(async () => {
    await probe.hooks().update.mutateAsync({ pageId: 'a', body: { title: 'Saved' } });
  });
  await act(async () => {
    listRead.resolve([original]);
    pageRead.resolve(original);
    await Promise.all(reads);
  });
  expect(probe.client.getQueryData(pagesQueryOptions('p').queryKey)).toEqual([expect.objectContaining({ title: 'Saved', updatedAt: at(1) })]);
  expect(probe.client.getQueryData(pageQueryOptions('p', 'a').queryKey)).toMatchObject({ title: 'Saved', updatedAt: at(1) });
  expect(probe.client.getQueryState(pagesQueryOptions('p').queryKey)?.isInvalidated).toBe(false);
  // A genuinely newer read still wins.
  await act(async () => {
    const newer = deferred<(typeof original)[]>();
    lists.setOptions({ ...pagesQueryOptions('p'), queryFn: () => newer.promise, staleTime: 0 });
    const refetch = lists.refetch();
    newer.resolve([{ ...original, title: 'Elsewhere', updatedAt: at(5) }]);
    await refetch;
  });
  expect(probe.client.getQueryData(pagesQueryOptions('p').queryKey)).toEqual([expect.objectContaining({ title: 'Elsewhere' })]);
  stops.forEach((stop) => {
    stop();
  });
  probe.close();
});
