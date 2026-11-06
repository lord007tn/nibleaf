// @vitest-environment jsdom

import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';
import { useMarkNotificationsRead } from './mutations';
import { queryKeys } from './query-keys';
import type { NotificationItem, NotificationList } from './types';

const mocks = vi.hoisted(() => ({ read: vi.fn(), toast: vi.fn() }));

vi.mock('@/services/api', () => ({ api: { app: { notifications: { read: { $post: mocks.read } } } } }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
// The shared client toasts each failed mutation's `meta.errorMessage`.
vi.mock('sonner', () => ({ toast: { error: mocks.toast } }));

const item = (id: string, readAt: string | null = null): NotificationItem => ({
  id,
  projectId: null,
  type: 'comment',
  title: `Notification ${id}`,
  body: null,
  href: null,
  readAt,
  createdAt: '2026-11-01T00:00:00.000Z',
});
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('useMarkNotificationsRead', () => {
  const listKey = queryKeys.notifications.list();
  const countKey = queryKeys.notifications.unreadCount();
  let container: HTMLDivElement;
  let queryClient: QueryClient;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div');
    document.body.append(container);
    queryClient = createQueryClient();
    queryClient.setQueryData<NotificationList>(listKey, {
      items: [item('n1'), item('n2'), item('n3', '2026-11-02T00:00:00.000Z')],
      nextCursor: null,
    });
    queryClient.setQueryData(countKey, { count: 2 });
  });

  afterEach(() => {
    container.remove();
    vi.clearAllMocks();
  });

  async function render() {
    const hooks: { markRead?: ReturnType<typeof useMarkNotificationsRead> } = {};
    function Probe() {
      hooks.markRead = useMarkNotificationsRead();
      return null;
    }
    const root = createRoot(container);
    await act(async () => root.render(createElement(QueryClientProvider, { client: queryClient }, createElement(Probe))));
    return { hooks, root };
  }

  /** Start a mark-read whose server answer the test releases later. */
  async function startMarking(hooks: { markRead?: ReturnType<typeof useMarkNotificationsRead> }, body: { ids?: string[]; all?: boolean }) {
    let answer: (response: Response) => void = () => undefined;
    mocks.read.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        answer = resolve;
      }),
    );
    let pending: Promise<unknown> = Promise.resolve();
    await act(async () => {
      pending = hooks.markRead?.mutateAsync(body).catch(() => undefined) ?? pending;
    });
    return {
      respond: async (response: Response) =>
        act(async () => {
          answer(response);
          await pending;
        }),
    };
  }

  const readIds = () =>
    queryClient
      .getQueryData<NotificationList>(listKey)
      ?.items.filter((entry) => entry.readAt !== null)
      .map((entry) => entry.id);

  it('marks one row read and lowers the bell count at once', async () => {
    const { hooks, root } = await render();
    const marking = await startMarking(hooks, { ids: ['n1'] });

    expect(readIds()).toEqual(['n1', 'n3']);
    expect(queryClient.getQueryData(countKey)).toEqual({ count: 1 });

    await marking.respond(json(200, { data: { updated: 1 } }));
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
    act(() => root.unmount());
  });

  it('marks everything read at once and rolls back when the server refuses', async () => {
    const { hooks, root } = await render();
    const marking = await startMarking(hooks, { all: true });

    expect(readIds()).toEqual(['n1', 'n2', 'n3']);
    expect(queryClient.getQueryData(countKey)).toEqual({ count: 0 });

    await marking.respond(json(500, { error: { message: 'Internal error' } }));
    expect(readIds()).toEqual(['n3']);
    expect(queryClient.getQueryData(countKey)).toEqual({ count: 2 });
    act(() => root.unmount());
  });

  const failure = () => json(500, { error: { message: 'Internal error' } });
  const count = () => queryClient.getQueryData<{ count: number }>(countKey)?.count;

  it('keeps a later row read when an earlier overlapping write fails, and reports each failure', async () => {
    const { hooks, root } = await render();
    const first = await startMarking(hooks, { ids: ['n1'] });
    const second = await startMarking(hooks, { ids: ['n2'] });
    expect(readIds()).toEqual(['n1', 'n2', 'n3']);
    expect(count()).toBe(0);

    await first.respond(failure());
    // Only the failed row comes back; the other write is still in flight, so nothing is refetched yet.
    expect(readIds()).toEqual(['n2', 'n3']);
    expect(count()).toBe(1);
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(false);
    await vi.waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1));

    await second.respond(failure());
    expect(readIds()).toEqual(['n3']);
    expect(count()).toBe(2);
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
    await vi.waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(2));
    expect(mocks.toast).toHaveBeenLastCalledWith('notifications.markReadError');
    act(() => root.unmount());
  });

  it('never leaves an unread row hidden when a row and "Mark all read" both fail', async () => {
    const { hooks, root } = await render();
    const row = await startMarking(hooks, { ids: ['n1'] });
    const all = await startMarking(hooks, { all: true });
    expect(readIds()).toEqual(['n1', 'n2', 'n3']);
    expect(count()).toBe(0);

    // The row fails, but "Mark all read" still covers it.
    await row.respond(failure());
    expect(readIds()).toEqual(['n1', 'n2', 'n3']);
    expect(count()).toBe(0);

    // Neither write succeeded: the inbox and the badge match the server again, even before a refetch.
    await all.respond(failure());
    expect(readIds()).toEqual(['n3']);
    expect(count()).toBe(2);
    act(() => root.unmount());
  });

  it('keeps rows a finished write made read when an older overlapping write fails', async () => {
    const { hooks, root } = await render();
    const row = await startMarking(hooks, { ids: ['n1'] });
    const all = await startMarking(hooks, { all: true });

    await all.respond(json(200, { data: { updated: 2 } }));
    expect(readIds()).toEqual(['n1', 'n2', 'n3']);
    expect(count()).toBe(0);

    await row.respond(failure());
    expect(readIds()).toEqual(['n1', 'n2', 'n3']);
    expect(count()).toBe(0);
    act(() => root.unmount());
  });
});
