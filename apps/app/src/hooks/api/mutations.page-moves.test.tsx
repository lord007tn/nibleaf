/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useReorderPages } from './mutations';
import { queryKeys } from './query-keys';
import type { PageNode } from './types';

const mocks = vi.hoisted(() => ({ reorder: vi.fn() }));
vi.mock('@/services/api', () => ({ api: { app: { projects: { ':projectId': { pages: { reorder: { $post: mocks.reorder } } } } } } }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const key = queryKeys.pages.all('project', undefined, 'branch');
const original = [
  { id: 'group', parentId: null, position: 0, title: 'Group' },
  { id: 'first', parentId: null, position: 1, title: 'First' },
  { id: 'second', parentId: null, position: 2, title: 'Second' },
].map((page) => ({ ...page, branchId: 'branch', languageId: 'en', slug: page.id, path: page.id, kind: 'PAGE', icon: null, description: null, hidden: false, updatedAt: '2026-11-11T00:00:00Z' })) as PageNode[];
const move = (id: string) => ({ items: [{ id, parentId: 'group', position: 0 }] });
const rejected = () => new Response(JSON.stringify({ error: { code: 'database:conflict' } }), { status: 409 });
let root: ReturnType<typeof createRoot>;
let client: QueryClient;
const requests: Array<(response: Response) => void> = [];
async function render() {
  vi.clearAllMocks();
  requests.length = 0;
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(key, original);
  const hooks: Array<ReturnType<typeof useReorderPages>> = [];
  mocks.reorder.mockImplementation(() => new Promise<Response>((resolve) => requests.push(resolve)));
  function Probe() {
    hooks[0] = useReorderPages('project');
    hooks[1] = useReorderPages('project');
    return null;
  }
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>));
  return hooks;
}
const flush = async () => act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
afterEach(async () => {
  for (const resolve of requests) resolve(rejected());
  await flush();
  await act(async () => root?.unmount());
  client?.clear();
  document.body.replaceChildren();
});

it('council P1: overlapping rejected moves serialize and finish at server truth', async () => {
  const hooks = await render();
  let first: Promise<unknown> | undefined;
  let second: Promise<unknown> | undefined;
  await act(async () => { first = hooks[0]?.mutateAsync(move('first')).catch(() => undefined); });
  await flush();
  await act(async () => { second = hooks[1]?.mutateAsync(move('second')).catch(() => undefined); });
  await flush();
  const simultaneousRequests = requests.length;
  await act(async () => { requests[0]?.(rejected()); });
  await flush();
  await act(async () => { requests[1]?.(rejected()); await Promise.all([first, second]); });
  expect(client.getQueryData(key)).toEqual(original);
  expect(simultaneousRequests).toBe(1);
});

it('council P1: rollback keeps an authoritative refetch that landed during a pending move', async () => {
  const hooks = await render();
  let pending: Promise<unknown> | undefined;
  await act(async () => { pending = hooks[0]?.mutateAsync(move('first')).catch(() => undefined); });
  await flush();
  const current = original.map((page) => page.id === 'first' ? { ...page, parentId: 'other-group', position: 4, title: 'A newer server title' } : page);
  await act(async () => { await client.fetchQuery({ queryKey: key, queryFn: async () => current }); });
  await act(async () => { requests[0]?.(rejected()); await pending; });
  expect(client.getQueryData(key)).toEqual(current);
});

it('council P1: rollback only owns unchanged optimistic structure fields, preserving other cached edits', async () => {
  const hooks = await render();
  let pending: Promise<unknown> | undefined;
  await act(async () => { pending = hooks[0]?.mutateAsync(move('first')).catch(() => undefined); });
  await flush();
  client.setQueryData<PageNode[]>(key, (pages) => pages?.map((page) => page.id === 'first' ? { ...page, title: 'New title', position: 7 } : page));
  await act(async () => { requests[0]?.(rejected()); await pending; });
  expect(client.getQueryData<PageNode[]>(key)?.find((page) => page.id === 'first')).toMatchObject({ parentId: null, position: 7, title: 'New title' });
});

it('council P1: every reorder observer sees a pending move for the project', async () => {
  const hooks = await render();
  await act(async () => { void hooks[0]?.mutateAsync(move('first')).catch(() => undefined); });
  await flush();
  expect(hooks[1]?.isPending).toBe(true);
});
