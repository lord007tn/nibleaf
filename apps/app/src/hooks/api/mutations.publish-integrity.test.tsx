// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';
import { useReorderPages, useRollback } from './mutations';
import { queryKeys } from './query-keys';

const mocks = vi.hoisted(() => ({ reorder: vi.fn(), rollback: vi.fn(), toast: vi.fn() }));
vi.mock('@/services/api', () => ({
  api: {
    app: {
      projects: {
        ':projectId': {
          pages: { reorder: { $post: mocks.reorder } },
          deployments: { ':id': { rollback: { $post: mocks.rollback } } },
        },
      },
    },
  },
}));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('sonner', () => ({ toast: { error: mocks.toast } }));

describe('publish integrity mutations', () => {
  const client = createQueryClient();
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    vi.clearAllMocks();
    client.clear();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    client.clear();
    vi.restoreAllMocks();
  });
  const render = async () => {
    const hooks: { reorder?: ReturnType<typeof useReorderPages>; rollback?: ReturnType<typeof useRollback> } = {};
    function Probe() {
      hooks.reorder = useReorderPages('project');
      hooks.rollback = useRollback('project');
      return null;
    }
    await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(Probe))));
    return hooks;
  };
  it('localizes a reorder collision and keeps the previous list', async () => {
    const key = queryKeys.pages.all('project', 'language', 'branch');
    const pages = [{ id: 'page', parentId: null, position: 0 }];
    client.setQueryData(key, pages);
    mocks.reorder.mockResolvedValue(new Response(JSON.stringify({ error: { code: 'database:conflict' } }), { status: 409 }));
    const hooks = await render();
    await act(async () => {
      await hooks.reorder?.mutateAsync({ items: [{ id: 'page', parentId: 'group', position: 1 }] }).catch(() => undefined);
    });
    await vi.waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('editor.reorderSlugTaken'));
    expect(client.getQueryData(key)).toEqual(pages);
  });
  it('lists the exact queued rollback immediately even without an existing deployment cache', async () => {
    const queued = { id: 'restore-4', version: 4, status: 'PENDING' };
    mocks.rollback.mockResolvedValue(new Response(JSON.stringify({ data: queued }), { status: 201 }));
    const hooks = await render();
    await act(async () => {
      await hooks.rollback?.mutateAsync('version-2');
    });
    expect(client.getQueryData(queryKeys.deployments.all('project'))).toEqual([queued]);
  });
});
