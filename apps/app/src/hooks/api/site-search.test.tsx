// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Real TanStack Query, fake transport: these tests pin the library behaviour the
// search dialog relies on (placeholder results, cancellation, retry states).
const mocks = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock('@/functions/site-search', () => ({ searchSiteFn: mocks.search, answerSiteFn: vi.fn() }));

import { useSiteSearch } from './site-search';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

type Result = ReturnType<typeof useSiteSearch>;
let latest: Result | undefined;
let root: Root | undefined;
let client: QueryClient;

function Probe({ query }: { query: string }) {
  const result = useSiteSearch('docs', query);
  // Read what the dialog reads: the query only re-renders for fields in use.
  const { data, error, status, isFetching, isPlaceholderData } = result;
  report(result);
  return <output>{JSON.stringify({ data, error: String(error), status, isFetching, isPlaceholderData })}</output>;
}
const report = (result: Result) => {
  latest = result;
};

const render = (query: string) =>
  act(async () => {
    root?.render(
      <QueryClientProvider client={client}>
        <Probe query={query} />
      </QueryClientProvider>,
    );
  });

const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));

const deferred = <T,>() => {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root = createRoot(document.createElement('div'));
  latest = undefined;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  client.clear();
  vi.clearAllMocks();
});

describe('useSiteSearch with a real QueryClient', () => {
  it('keeps the previous results as placeholder data while the next query loads', async () => {
    const first = [{ id: 'a' }];
    mocks.search.mockResolvedValueOnce(first);
    await render('setup');
    await settle();
    expect(latest?.data).toBe(first);
    mocks.search.mockReturnValueOnce(new Promise(() => undefined));
    await render('setup guide');
    expect(latest?.isPlaceholderData).toBe(true);
    expect(latest?.data).toBe(first);
  });

  it('passes an abort signal and cancels a search the reader typed past', async () => {
    mocks.search.mockReturnValueOnce(new Promise(() => undefined));
    await render('set');
    const signal: AbortSignal = mocks.search.mock.calls[0]?.[0]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    mocks.search.mockReturnValueOnce(new Promise(() => undefined));
    await render('setup');
    await settle();
    expect(signal.aborted).toBe(true);
    expect(mocks.search.mock.calls[1]?.[0]).toMatchObject({ data: { projectId: 'docs', query: 'setup' } });
  });

  it('returns a search that never loaded to pending, without its error, when it is retried', async () => {
    mocks.search.mockRejectedValueOnce(new Error('Network unavailable'));
    await render('setup');
    await settle();
    expect(latest?.error).toBeInstanceOf(Error);
    const retry = deferred<unknown[]>();
    mocks.search.mockReturnValueOnce(retry.promise);
    await act(async () => {
      void latest?.refetch();
    });
    await settle();
    // The dialog shows result skeletons here, not the error and its Retry button.
    expect(latest?.status).toBe('pending');
    expect(latest?.error).toBeNull();
    expect(latest?.isFetching).toBe(true);
    retry.resolve([]);
    await settle();
    expect(latest?.data).toEqual([]);
  });

  it('keeps the error of a failed refresh while it is retried, so Retry can show it is busy', async () => {
    mocks.search.mockResolvedValueOnce([{ id: 'a' }]);
    await render('setup');
    await settle();
    mocks.search.mockRejectedValueOnce(new Error('Network unavailable'));
    await act(async () => {
      void latest?.refetch();
    });
    await settle();
    expect(latest?.error).toBeInstanceOf(Error);
    mocks.search.mockReturnValueOnce(new Promise(() => undefined));
    await act(async () => {
      void latest?.refetch();
    });
    await settle();
    expect(latest?.error).toBeInstanceOf(Error);
    expect(latest?.isFetching).toBe(true);
  });
});
