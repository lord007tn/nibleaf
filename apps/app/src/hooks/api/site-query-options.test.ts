import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import { PageTransportError } from '@/lib/page-load-error';

/** The server function's client side: it fetches, and on a failed response throws the body as a plain Error (the status is lost). */
const site = vi.hoisted(() => ({ refusal: undefined as ApiResponseError | undefined }));
vi.mock('@/functions/site', () => ({
  getSitePageFn: async ({ fetch: send }: { fetch: typeof fetch }) => {
    const response = await send('http://app.test/_serverFn/page');
    if (site.refusal) throw site.refusal;
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  },
}));

import { sitePageQueryOptions } from './site-query-options';

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

afterEach(() => {
  vi.unstubAllGlobals();
  site.refusal = undefined;
});

describe('sitePageQueryOptions', () => {
  it('serves a public page from cache while fresh, and reloads a restricted page on every read', async () => {
    const fetch = vi.fn(async () => Response.json({ id: 'page' }));
    vi.stubGlobal('fetch', fetch);
    const queries = client();
    await queries.query({ ...sitePageQueryOptions('p1', 'a'), staleTime: 30_000 });
    await queries.query({ ...sitePageQueryOptions('p1', 'a'), staleTime: 30_000 });
    expect(fetch).toHaveBeenCalledTimes(1);

    const restricted = sitePageQueryOptions('p2', 'a', undefined, undefined, { fresh: false });
    expect(restricted.staleTime).toBe(0);
    await queries.query(restricted);
    await queries.query(restricted);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('reports a gateway answer with its status and Retry-After, and a dropped request as status 0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>Bad gateway</html>', { status: 503, headers: { 'retry-after': '2' } })),
    );
    const gateway = await client()
      .query(sitePageQueryOptions('p1', 'a'))
      .catch((error: unknown) => error);
    expect(gateway).toBeInstanceOf(PageTransportError);
    expect(gateway).toMatchObject({ status: 503, retryAfter: '2' });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    );
    const dropped = await client()
      .query(sitePageQueryOptions('p1', 'a'))
      .catch((error: unknown) => error);
    expect(dropped).toBeInstanceOf(PageTransportError);
    expect(dropped).toMatchObject({ status: 0 });
  });

  it('keeps an API refusal as it is', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200 })),
    );
    site.refusal = new ApiResponseError('Sign in to read this site', 403);
    const error = await client()
      .query(sitePageQueryOptions('p1', 'a'))
      .catch((thrown: unknown) => thrown);
    expect(error).toBe(site.refusal);
  });
});
