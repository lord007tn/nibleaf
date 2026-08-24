// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useActivateProjectIntegration, useUpdateProjectIntegration } from './integrations';
import { queryKeys } from './query-keys';

const mocks = vi.hoisted(() => ({
  activate: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@/services/api', () => ({
  api: {
    app: {
      projects: {
        ':projectId': {
          integrations: {
            ':providerId': {
              $patch: mocks.update,
              activate: { $post: mocks.activate },
            },
          },
        },
      },
    },
  },
}));

const errorResponse = (code: string) =>
  new Response(JSON.stringify({ error: { code, message: 'The integration changed.' } }), {
    status: 409,
    headers: { 'content-type': 'application/json' },
  });

describe('integration mutation conflict recovery', () => {
  const projectId = 'project-a';
  let container: HTMLDivElement;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div');
    document.body.append(container);
  });

  afterEach(() => {
    container.remove();
    vi.clearAllMocks();
  });

  it.each(['update', 'activate'] as const)('refreshes integration caches before surfacing an %s revision conflict', async (action) => {
    mocks.update.mockResolvedValue(errorResponse('integration:revision_conflict'));
    mocks.activate.mockResolvedValue(errorResponse('integration:revision_conflict'));
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    let mutate: () => Promise<unknown> = () => Promise.reject(new Error('mutation hook was not ready'));

    function Probe() {
      const update = useUpdateProjectIntegration(projectId);
      const activate = useActivateProjectIntegration(projectId);
      mutate = () =>
        action === 'update'
          ? update.mutateAsync({
              providerId: 'slack',
              body: { providerId: 'slack', label: 'Alerts', expectedRevision: 1, idempotencyKey: 'update-key' },
            })
          : activate.mutateAsync({ providerId: 'slack', body: { expectedRevision: 1, idempotencyKey: 'activate-key' } });
      return null;
    }

    const root = createRoot(container);
    await act(async () => root.render(createElement(QueryClientProvider, { client: queryClient }, createElement(Probe))));
    await act(async () => {
      await expect(mutate()).rejects.toMatchObject({ code: 'integration:revision_conflict' });
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.integrations.all(projectId), exact: true, refetchType: 'all' });
    expect(invalidate).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  it('does not invalidate caches for unrelated mutation errors', async () => {
    mocks.activate.mockResolvedValue(errorResponse('integration:inactive'));
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    let mutate: () => Promise<unknown> = () => Promise.reject(new Error('mutation hook was not ready'));

    function Probe() {
      const activate = useActivateProjectIntegration(projectId);
      mutate = () => activate.mutateAsync({ providerId: 'slack', body: { expectedRevision: 1, idempotencyKey: 'activate-key' } });
      return null;
    }

    const root = createRoot(container);
    await act(async () => root.render(createElement(QueryClientProvider, { client: queryClient }, createElement(Probe))));
    await act(async () => {
      await expect(mutate()).rejects.toMatchObject({ code: 'integration:inactive' });
    });

    expect(invalidate).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});
