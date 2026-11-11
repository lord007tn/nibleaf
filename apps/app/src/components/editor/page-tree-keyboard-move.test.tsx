/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { PageNode } from '@/hooks/api';
import { useReorderPages } from '@/hooks/api/mutations';
import { queryKeys } from '@/hooks/api/query-keys';
import { PageTreeDndProvider, SortablePageTree } from './sortable-page-tree';

const mocks = vi.hoisted(() => ({ reorder: vi.fn(), toast: vi.fn() }));
vi.mock('@/services/api', () => ({ api: { app: { projects: { ':projectId': { pages: { reorder: { $post: mocks.reorder } } } } } } }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

it('shows a keyboard nest through the real reorder cache immediately and rolls back with caller feedback on failure', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const queryKey = queryKeys.pages.all('project', undefined, 'branch');
  const pages = [
    { id: 'start', title: 'Quickstart', position: 0, parentId: null },
    { id: 'config', title: 'Configuration', position: 1, parentId: null },
  ].map((page) => ({
    ...page,
    kind: 'PAGE',
    languageId: 'en',
    path: page.id,
    slug: page.id,
    icon: null,
    hidden: false,
    description: null,
    updatedAt: '',
  })) as PageNode[];
  client.setQueryData(queryKey, pages);
  let fail: (response: Response) => void = vi.fn();
  mocks.reorder.mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        fail = resolve;
      }),
  );
  const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const measured = this.closest<HTMLElement>('[data-sortable-page-id]') ?? this.querySelector<HTMLElement>('[data-sortable-page-id]');
    const top = measured?.dataset.sortablePageId === 'config' ? 32 : 0;
    return { x: 0, y: top, top, bottom: top + 32, left: 0, right: 300, width: 300, height: 32, toJSON: () => ({}) };
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const noop = vi.fn();
  function Tree() {
    const { data = [] } = useQuery({ queryKey, queryFn: async () => pages, enabled: false });
    const reorder = useReorderPages('project');
    return (
      <PageTreeDndProvider
        pages={data}
        languages={[{ id: 'en', label: 'English', collapsed: false }]}
        dir="ltr"
        onMove={(items) => reorder.mutate({ items }, { onError: mocks.toast })}
      >
        <SortablePageTree languageId="en" activeId="config" onSelect={noop} onAddChild={noop} onSettings={noop} />
      </PageTreeDndProvider>
    );
  }
  const key = async (target: Element, value: string) =>
    act(async () => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: value, code: value === ' ' ? 'Space' : value, bubbles: true, cancelable: true }));
    });
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Tree />
        </QueryClientProvider>,
      ),
    );
    const row = () => container.querySelector<HTMLElement>('[role="treeitem"][data-page-id="config"]') as HTMLElement;
    const handle = row().querySelector('[data-drag-handle]') as HTMLElement;
    await act(async () => handle.focus());
    await key(handle, ' ');
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    await key(handle, 'ArrowRight');
    await key(handle, ' ');
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(mocks.reorder).toHaveBeenCalledOnce();
    expect(client.getQueryData<PageNode[]>(queryKey)?.find((page) => page.id === 'config')?.parentId).toBe('start');
    expect(row().getAttribute('aria-level')).toBe('2');
    await act(async () => {
      fail(new Response(JSON.stringify({ error: { code: 'database:conflict' } }), { status: 409 }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(client.getQueryData(queryKey)).toEqual(pages);
    expect(row().getAttribute('aria-level')).toBe('1');
    expect(mocks.toast).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    client.clear();
    rectSpy.mockRestore();
  }
});
