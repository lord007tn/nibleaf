// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDeleteComment, useResolveComment } from './mutations';
import { queryKeys } from './query-keys';
import type { Comment } from './types';

const mocks = vi.hoisted(() => ({ patch: vi.fn(), remove: vi.fn() }));

vi.mock('@/services/api', () => ({
  api: { app: { projects: { ':projectId': { comments: { ':id': { $patch: mocks.patch, $delete: mocks.remove } } } } } },
}));

const projectId = 'project-a';
const comment = (id: string, resolved = false): Comment => ({
  id,
  body: `Comment ${id}`,
  resolved,
  createdAt: '2026-01-01T00:00:00.000Z',
  user: { id: 'user-a', name: 'Mei', image: null },
});
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('comment mutations update every cached list optimistically', () => {
  let container: HTMLDivElement;
  let queryClient: QueryClient;
  // The site-wide list and the page's own list hold the same comment.
  const siteKey = queryKeys.comments.all(projectId);
  const pageKey = queryKeys.comments.all(projectId, 'page-1');

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div');
    document.body.append(container);
    queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
    queryClient.setQueryData(siteKey, [comment('c1'), comment('c2')]);
    queryClient.setQueryData(pageKey, [comment('c1')]);
  });

  afterEach(() => {
    container.remove();
    vi.clearAllMocks();
  });

  async function render() {
    const hooks: { resolve?: ReturnType<typeof useResolveComment>; remove?: ReturnType<typeof useDeleteComment> } = {};
    function Probe() {
      hooks.resolve = useResolveComment(projectId);
      hooks.remove = useDeleteComment(projectId);
      return null;
    }
    const root = createRoot(container);
    await act(async () => root.render(createElement(QueryClientProvider, { client: queryClient }, createElement(Probe))));
    return { hooks, root };
  }

  it('shows a resolve at once in every list and rolls it back when the server refuses', async () => {
    let refuse: (response: Response) => void = () => undefined;
    mocks.patch.mockReturnValue(
      new Promise<Response>((resolve) => {
        refuse = resolve;
      }),
    );
    const { hooks, root } = await render();

    let pending: Promise<unknown> = Promise.resolve();
    await act(async () => {
      pending = hooks.resolve?.mutateAsync({ id: 'c1', resolved: true }).catch(() => undefined) ?? pending;
    });
    expect(queryClient.getQueryData<Comment[]>(siteKey)?.[0]?.resolved).toBe(true);
    expect(queryClient.getQueryData<Comment[]>(pageKey)?.[0]?.resolved).toBe(true);

    await act(async () => {
      refuse(json(403, { error: { message: 'Forbidden' } }));
      await pending;
    });
    expect(queryClient.getQueryData<Comment[]>(siteKey)?.[0]?.resolved).toBe(false);
    expect(queryClient.getQueryData<Comment[]>(pageKey)?.[0]?.resolved).toBe(false);
    act(() => root.unmount());
  });

  it('removes a deleted comment from every list and restores it on failure', async () => {
    let fail: (response: Response) => void = () => undefined;
    mocks.remove.mockReturnValue(
      new Promise<Response>((resolve) => {
        fail = resolve;
      }),
    );
    const { hooks, root } = await render();

    let pending: Promise<unknown> = Promise.resolve();
    await act(async () => {
      pending = hooks.remove?.mutateAsync('c1').catch(() => undefined) ?? pending;
    });
    expect(queryClient.getQueryData<Comment[]>(siteKey)?.map((item) => item.id)).toEqual(['c2']);
    expect(queryClient.getQueryData<Comment[]>(pageKey)).toEqual([]);

    await act(async () => {
      fail(json(500, { error: { message: 'Internal error' } }));
      await pending;
    });
    expect(queryClient.getQueryData<Comment[]>(siteKey)?.map((item) => item.id)).toEqual(['c1', 'c2']);
    expect(queryClient.getQueryData<Comment[]>(pageKey)?.map((item) => item.id)).toEqual(['c1']);
    act(() => root.unmount());
  });
});
