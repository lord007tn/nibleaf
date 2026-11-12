import { CancelledError, QueryClient, queryOptions } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import { createQueryClient, isClientError, loadRouteData, prefetchRouteData, shouldRetry } from './query-client';

const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { error: toastError } }));

import { syncDashboardSession } from './session-cache';
import { getSessionGeneration } from './session-generation';

const apiError = (status: number) => new ApiResponseError('failed', status);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('query client defaults', () => {
  it.each([false, true])('only schedules cache collection in the browser (browser: %s)', async (browser) => {
    vi.stubGlobal('window', browser ? {} : undefined);
    vi.useFakeTimers();
    const client = createQueryClient();
    await client.fetchQuery({ queryKey: ['shutdown'], queryFn: async () => 'cached' });
    expect(client.getQueryData(['shutdown'])).toBe('cached');
    expect(vi.getTimerCount()).toBe(browser ? 1 : 0);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(client.getQueryData(['shutdown'])).toBe(browser ? undefined : 'cached');
    client.clear();
  });

  it('never retries 4xx answers, retries network and 5xx failures twice', () => {
    for (const status of [400, 401, 403, 404, 409, 422, 429]) {
      expect(isClientError(apiError(status))).toBe(true);
      expect(shouldRetry(0, apiError(status))).toBe(false);
    }
    expect(shouldRetry(0, apiError(500))).toBe(true);
    expect(shouldRetry(1, new TypeError('Failed to fetch'))).toBe(true);
    expect(shouldRetry(2, apiError(503))).toBe(false);
  });

  it('uses shared freshness, retry and focus policies', () => {
    const client = createQueryClient();
    const defaults = client.getDefaultOptions();
    expect(defaults.queries?.staleTime).toBe(30_000);
    expect(defaults.queries?.retry).toBe(shouldRetry);
    expect(defaults.queries?.refetchOnWindowFocus).toBe(false);
    expect(defaults.mutations?.retry).toBe(false);
  });
});

describe('prefetchRouteData', () => {
  const options = (queryFn: () => Promise<string>) => queryOptions({ queryKey: ['test'], queryFn });

  it('does nothing during server rendering', () => {
    vi.stubGlobal('window', undefined);
    const client = createQueryClient();
    const queryFn = vi.fn(async () => 'data');
    prefetchRouteData(client, options(queryFn));
    expect(queryFn).not.toHaveBeenCalled();
  });

  it('starts the fetch in the browser without throwing on failure', async () => {
    vi.stubGlobal('window', {});
    const client = createQueryClient();
    const queryFn = vi.fn(async () => {
      throw apiError(404);
    });
    expect(() => prefetchRouteData(client, options(queryFn))).not.toThrow();
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));
  });

  it('reuses fresh cached data instead of refetching', async () => {
    vi.stubGlobal('window', {});
    const client = createQueryClient();
    client.setQueryData(['test'], 'cached');
    const queryFn = vi.fn(async () => 'fresh');
    prefetchRouteData(client, options(queryFn));
    await Promise.resolve();
    expect(queryFn).not.toHaveBeenCalled();
  });
});

describe('global mutation error toasts', () => {
  it.each([false, true])('continues to show localized current-session failures (stamped: %s)', async (stamped) => {
    const client = createQueryClient();
    syncDashboardSession(client, 'alice');
    const error = new Error('private backend detail');
    const message = vi.fn(() => 'Could not save. Try again.');
    const mutation = client.getMutationCache().build(client, {
      mutationFn: async () => {
        throw error;
      },
      meta: { ...(stamped ? { sessionGeneration: getSessionGeneration(client) } : {}), errorMessage: message },
    });
    await expect(mutation.execute(undefined)).rejects.toBe(error);
    await vi.waitFor(() => expect(toastError).toHaveBeenCalledWith('Could not save. Try again.'));
    expect(message).toHaveBeenCalledExactlyOnceWith(error);
    client.clear();
  });

  it.each(['cancelled', 'old-session'])('does not format or toast a %s mutation failure', async (scenario) => {
    const client = createQueryClient();
    syncDashboardSession(client, 'alice');
    const error = scenario === 'cancelled' ? new CancelledError() : new Error('old private error');
    const message = vi.fn(() => 'Could not revoke.');
    let fail: () => void = () => undefined;
    const request = vi.fn(
      () =>
        new Promise<never>((_resolve, reject) => {
          fail = () => reject(error);
        }),
    );
    const mutation = client.getMutationCache().build(client, {
      mutationFn: request,
      meta: { sessionGeneration: getSessionGeneration(client), errorMessage: message },
    });
    const result = mutation.execute(undefined).catch((failure: unknown) => failure);
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    if (scenario === 'old-session') syncDashboardSession(client, 'bob');
    fail();
    expect(await result).toBe(error);
    await import('sonner');
    expect(message).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    client.clear();
  });

  it('rechecks the session before displaying a dynamically loaded toast', async () => {
    const client = createQueryClient();
    syncDashboardSession(client, 'alice');
    const mutation = client.getMutationCache().build(client, {
      mutationFn: async () => {
        throw new Error('failed');
      },
      meta: {
        sessionGeneration: getSessionGeneration(client),
        errorMessage: () => {
          syncDashboardSession(client, 'bob');
          return 'Alice failure';
        },
      },
    });
    await expect(mutation.execute(undefined)).rejects.toThrow('failed');
    await import('sonner');
    expect(toastError).not.toHaveBeenCalled();
    client.clear();
  });
});

describe('loadRouteData', () => {
  it('gives up on a stalled request within its bound, aborts it, and returns null', async () => {
    const client = new QueryClient();
    let aborted = false;
    const started = Date.now();
    const result = await loadRouteData(
      client,
      {
        queryKey: ['stalled'],
        queryFn: ({ signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              aborted = true;
              reject(new Error('aborted'));
            });
          }),
      },
      50,
    );
    expect(result).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(aborted).toBe(true);
  });

  it('returns the data when the request answers in time, and null when it fails', async () => {
    const client = new QueryClient();
    expect(await loadRouteData(client, { queryKey: ['fine'], queryFn: async () => ({ google: true }) })).toEqual({ google: true });
    expect(await loadRouteData(client, { queryKey: ['broken'], queryFn: async () => Promise.reject(new Error('down')) })).toBeNull();
  });
});
