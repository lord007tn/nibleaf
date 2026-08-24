// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useActivateProjectAddon, useUpdateProjectAddon } from './mutations';
import { queryKeys } from './query-keys';
import type { ProjectAddon } from './types';

const mocks = vi.hoisted(() => ({
  activate: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/services/api', () => ({
  api: {
    app: {
      projects: {
        ':projectId': {
          addons: {
            ':addonId': {
              $patch: mocks.update,
              activate: { $post: mocks.activate },
              deactivate: { $post: vi.fn() },
            },
          },
        },
      },
    },
  },
}));

const conflictResponse = () =>
  new Response(JSON.stringify({ error: { code: 'addon:revision_conflict', message: 'The add-on changed.' } }), {
    status: 409,
    headers: { 'content-type': 'application/json' },
  });

describe('add-on mutation conflict recovery', () => {
  const projectId = 'project-a';
  const addonId = 'feedback';
  let container: HTMLDivElement;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div');
    document.body.append(container);
    mocks.activate.mockResolvedValue(conflictResponse());
    mocks.update.mockResolvedValue(conflictResponse());
  });

  afterEach(() => {
    container.remove();
    vi.clearAllMocks();
  });

  it.each(['update', 'activate'] as const)('invalidates detail and list caches before surfacing an %s revision conflict', async (action) => {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    let mutate: () => Promise<ProjectAddon> = () => Promise.reject(new Error('mutation hook was not ready'));

    function Probe() {
      const update = useUpdateProjectAddon(projectId);
      const activate = useActivateProjectAddon(projectId);
      mutate = () =>
        action === 'update'
          ? update.mutateAsync({ addonId, body: { expectedRevision: 1, config: { placement: 'after-content', presentation: 'compact' } } })
          : activate.mutateAsync({ addonId, expectedRevision: 1 });
      return null;
    }

    const root = createRoot(container);
    await act(async () => root.render(createElement(QueryClientProvider, { client: queryClient }, createElement(Probe))));
    await act(async () => {
      await expect(mutate()).rejects.toMatchObject({ code: 'addon:revision_conflict' });
    });

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.addons.detail(projectId, addonId),
      exact: true,
      refetchType: 'all',
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.addons.all(projectId), exact: true, refetchType: 'all' });
    expect(invalidate).toHaveBeenCalledTimes(2);
    act(() => root.unmount());
  });
});
