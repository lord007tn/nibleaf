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

  it('rejects input the API would refuse without sending a request', async () => {
    for (const data of [
      { projectId: 'docs', query: '   ' },
      { projectId: '', query: 'domain' },
      { projectId: 'docs', query: 'domain', limit: Number.NaN },
      { projectId: 'docs', query: 'domain', language: 'x'.repeat(36) },
    ]) {
      await expect(searchSiteFn({ data })).rejects.toThrow('Invalid search input');
    }
    mocks.analytics.mockReturnValue({ consentState: 'denied', sessionId: 'x'.repeat(129) });
    await expect(searchSiteFn({ data: { projectId: 'docs', query: 'domain' } })).rejects.toThrow('Invalid search input: sessionId');
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('searches the first 200 code points of a longer query instead of sending it whole', async () => {
    mocks.get.mockImplementation(async () => Response.json({ data: { hits: [], searchId: 'search-1' } }));
    const EMOJI = '😀';
    const cases: Array<[string, string]> = [
      ['x'.repeat(201), 'x'.repeat(200)],
      ['x'.repeat(300), 'x'.repeat(200)],
      ['x'.repeat(301), 'x'.repeat(200)],
      ['ب'.repeat(250), 'ب'.repeat(200)],
      [EMOJI.repeat(250), EMOJI.repeat(200)],
      // The 200th code point is an emoji: it is kept whole, never half of it.
      [`${'x'.repeat(199)}${EMOJI}${EMOJI}`, `${'x'.repeat(199)}${EMOJI}`],
      // Spaces around the query don't count: it is trimmed first, as the check does.
      [`   ${'x'.repeat(200)}   `, 'x'.repeat(200)],
      // A cut that ends on a space leaves no trailing space in the request.
      [`${'x'.repeat(199)} yz`, 'x'.repeat(199)],
      // Exactly 200 code points goes through unchanged, in any script.
      ['x'.repeat(200), 'x'.repeat(200)],
      ['ب'.repeat(200), 'ب'.repeat(200)],
      [EMOJI.repeat(200), EMOJI.repeat(200)],
    ];
    for (const [query, sent] of cases) {
      mocks.get.mockClear();
      await searchSiteFn({ data: { projectId: 'docs', query } });
      expect(mocks.get).toHaveBeenCalledExactlyOnceWith(
        { param: { id: 'docs' }, query: { q: sent, consentState: 'denied' } },
        { init: { signal: undefined } },
      );
    }
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
