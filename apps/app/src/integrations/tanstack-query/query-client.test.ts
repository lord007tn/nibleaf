import { queryOptions } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import { createQueryClient, isClientError, prefetchRouteData, shouldRetry } from './query-client';

const apiError = (status: number) => new ApiResponseError('failed', status);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('query client defaults', () => {
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
