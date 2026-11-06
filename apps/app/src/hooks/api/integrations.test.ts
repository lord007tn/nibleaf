// @vitest-environment jsdom

import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiResponseError } from './client-helpers';
import { integrationErrorMessage, useActivateProjectIntegration, useUpdateProjectIntegration } from './integrations';
import { queryKeys } from './query-keys';
import { integrationsQueryOptions } from './query-options';

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

describe('integration error wording', () => {
  const t = ((key: string) => `t:${key}`) as Parameters<typeof integrationErrorMessage>[0];
  const failure = (status: number, code?: string) => new ApiResponseError('English server text with internals', status, code);
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it.each([
    ['integration:credentials_invalid', 422, 't:settings.integrations.errorCredentialsInvalid'],
    ['integration:verification_failed', 502, 't:settings.integrations.errorVerificationFailed'],
    ['integration:provider_unavailable', 503, 't:settings.integrations.errorProviderUnavailable'],
    ['integration:revision_conflict', 409, 't:error.conflict'],
    ['integration:rate_limited', 429, 't:error.rateLimited'],
  ])('words %s from the code', (code, status, message) => {
    expect(integrationErrorMessage(t, failure(status, code))).toBe(message);
  });

  it('never shows the server text, falling back to the action message or the status', () => {
    expect(integrationErrorMessage(t, failure(500, 'integration:unknown'))).toBe('t:settings.integrations.actionError');
    expect(integrationErrorMessage(t, failure(403))).toBe('t:error.noPermission');
    expect(integrationErrorMessage(t, new TypeError('fetch failed'))).toBe('t:error.network');
  });
});

describe('integration queries and mutation errors', () => {
  it('keys the catalog by project and stays disabled without one', () => {
    expect(integrationsQueryOptions('project-1').queryKey).toEqual(queryKeys.integrations.all('project-1'));
    expect(typeof integrationsQueryOptions('project-1').queryFn).toBe('function');
    expect(typeof integrationsQueryOptions(undefined).queryFn).not.toBe('function');
  });

  it('toasts a failed mutation in plain words through meta.errorMessage, not the server text', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.update.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'integration:credentials_invalid', message: 'Webhook host failed DNS check' } }), {
        status: 422,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const toasted: string[] = [];
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
      mutationCache: new MutationCache({
        onError: (error, _variables, _context, mutation) => {
          const message = mutation.meta?.errorMessage;
          toasted.push(typeof message === 'function' ? message(error) : String(message));
        },
      }),
    });
    let mutate: () => Promise<unknown> = () => Promise.reject(new Error('mutation hook was not ready'));
    function Probe() {
      const update = useUpdateProjectIntegration('project-a');
      mutate = () =>
        update.mutateAsync({
          providerId: 'slack',
          body: { providerId: 'slack', label: null, expectedRevision: 1, idempotencyKey: 'update-key' },
        });
      return null;
    }
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(createElement(QueryClientProvider, { client: queryClient }, createElement(Probe))));
    await act(async () => {
      await expect(mutate()).rejects.toBeInstanceOf(ApiResponseError);
    });
    expect(toasted).toEqual(['settings.integrations.errorCredentialsInvalid']);
    act(() => root.unmount());
    container.remove();
  });
});
