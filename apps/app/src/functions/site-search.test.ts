import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), analytics: vi.fn() }));
vi.mock('@/services/api', () => ({ api: { public: { sites: { ':id': { search: { $get: mocks.get } } } } } }));
vi.mock('@/providers/site-analytics-provider', () => ({ getSiteSearchAnalytics: mocks.analytics }));

import { searchSiteFn } from './site-search';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.analytics.mockReturnValue({ consentState: 'denied' });
});

describe('reader search transport', () => {
  it('calls the public API once with reader scope, current consent and cancellation', async () => {
    const hit = { id: 'domain', title: 'Custom domain', path: 'domain', language: 'en', score: 4, snippet: 'Connect a domain.' };
    mocks.get.mockResolvedValue(Response.json({ data: { hits: [hit], searchId: 'search-1' } }));
    const controller = new AbortController();
    const hits = await searchSiteFn({
      data: { projectId: 'docs', query: ' custom domain ', language: 'en', prefer: 'ar', version: 'v2', limit: 8, consentState: 'granted' },
      signal: controller.signal,
    });
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith(
      { param: { id: 'docs' }, query: { q: 'custom domain', lang: 'en', prefer: 'ar', version: 'v2', limit: '8', consentState: 'denied' } },
      { init: { signal: controller.signal } },
    );
    expect(hits).toEqual([{ ...hit, searchId: 'search-1' }]);
  });

  it('preserves API failures rather than turning them into an empty result', async () => {
    mocks.get.mockResolvedValue(Response.json({ error: { code: 'http:rate_limit', message: 'Slow down' } }, { status: 429 }));
    await expect(searchSiteFn({ data: { projectId: 'docs', query: 'domain' } })).rejects.toMatchObject({ status: 429, message: 'Slow down' });
  });

  it('forwards fetch cancellation without retrying through another transport', async () => {
    const error = new DOMException('Cancelled', 'AbortError');
    mocks.get.mockRejectedValue(error);
    await expect(searchSiteFn({ data: { projectId: 'docs', query: 'domain' } })).rejects.toBe(error);
    expect(mocks.get).toHaveBeenCalledOnce();
  });
});
