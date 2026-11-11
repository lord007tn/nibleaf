import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSiteOgData: vi.fn(),
  cachedSiteOg: vi.fn(),
}));

vi.mock('@/actions/sites', () => ({ getSiteOgData: mocks.getSiteOgData }));
vi.mock('@/lib/site-og', () => ({
  cachedSiteOg: mocks.cachedSiteOg,
  siteOgEtag: (data: { title: string; deploymentId: string }) => `"${data.deploymentId}:${data.title}"`,
}));
vi.mock('@/middlewares/rate-limit', () => ({ rateLimit: () => async (_ctx: unknown, next: () => Promise<void>) => next() }));

import { notFound as notFoundError } from '@/errors';
import app, { OG_CACHE_CONTROL } from './og';

const card = { projectId: 'p', deploymentId: 'd1', title: 'Public title', siteName: 'Docs', brandColor: '#000', logo: null, rtl: false };
const notFound = () => notFoundError('site', { reason: 'private' });

/** A downstream cache: it stores a card, and must revalidate every use. */
const cache = new Map<string, { etag: string; body: ArrayBuffer }>();
const fetchThroughCache = async (path: string) => {
  const stored = cache.get(path);
  const response = await app.request(path, { headers: stored ? { 'if-none-match': stored.etag } : {} });
  if (response.status === 304 && stored) return { status: 200, body: stored.body, served: 'revalidated' as const, response };
  if (response.status === 200 && response.headers.get('cache-control')?.includes('public')) {
    const body = await response.clone().arrayBuffer();
    cache.set(path, { etag: response.headers.get('etag') ?? '', body });
    return { status: 200, body, served: 'origin' as const, response };
  }
  cache.delete(path);
  return { status: response.status, body: null, served: 'origin' as const, response };
};

describe('OG card caching', () => {
  beforeEach(() => {
    cache.clear();
    vi.clearAllMocks();
    mocks.getSiteOgData.mockResolvedValue(card);
    mocks.cachedSiteOg.mockResolvedValue(Buffer.from('png'));
  });

  it('lets caches store a card but requires revalidation on every use', async () => {
    const response = await app.request('/p/og/intro.png');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(OG_CACHE_CONTROL);
    expect(OG_CACHE_CONTROL).toBe('public, no-cache, must-revalidate');
    const revalidated = await app.request('/p/og/intro.png', { headers: { 'if-none-match': response.headers.get('etag') ?? '' } });
    expect(revalidated.status).toBe(304);
    expect(revalidated.headers.get('cache-control')).toBe(OG_CACHE_CONTROL);
  });

  it('stops serving a cached card as soon as the site goes private or is taken down', async () => {
    expect((await fetchThroughCache('/p/og/intro.png')).served).toBe('origin');
    expect((await fetchThroughCache('/p/og/intro.png')).served).toBe('revalidated');

    // The site goes private (or is taken down): the access check runs before any 304.
    mocks.getSiteOgData.mockRejectedValue(notFound());
    const after = await fetchThroughCache('/p/og/intro.png');
    expect(after.status).toBe(404);
    expect(after.response.headers.get('cache-control')).toBe('private, no-store');
    expect(cache.has('/p/og/intro.png')).toBe(false);
    expect(mocks.cachedSiteOg).toHaveBeenCalledTimes(1);
  });

  it('serves the new card right after a rename or republish', async () => {
    await fetchThroughCache('/p/og/intro.png');
    mocks.getSiteOgData.mockResolvedValue({ ...card, deploymentId: 'd2', title: 'Renamed title' });
    const after = await fetchThroughCache('/p/og/intro.png');
    expect(after.served).toBe('origin');
    expect(after.response.headers.get('etag')).toBe('"d2:Renamed title"');
  });
});
