import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';

const mocks = vi.hoisted(() => ({ getSiteOpenApi: vi.fn(), getSiteChangelogRss: vi.fn(), answerSite: vi.fn() }));

vi.mock('@/actions/sites', () => ({
  getSite: vi.fn(),
  getSitePage: vi.fn(),
  getSiteOpenApi: mocks.getSiteOpenApi,
  searchSite: vi.fn(),
  answerSite: mocks.answerSite,
  recordSiteEvent: vi.fn(),
  getSiteChangelog: vi.fn(),
  getSiteChangelogRss: mocks.getSiteChangelogRss,
  getSiteSitemap: vi.fn(),
  getSiteRobots: vi.fn(),
  getSiteLlmsTxt: vi.fn(),
  getSiteLlmsFullTxt: vi.fn(),
}));

import handlers from './handlers';

const app = new Hono<HonoEnv>();
app.onError((error, ctx) =>
  error instanceof AppError ? ctx.json(error.toJSON(), error.status) : ctx.json({ error: { message: error.message } }, 500),
);
app.route('/sites', handlers);
const document = { openapi: '3.1.0', info: { title: 'Pets', version: '1' }, paths: {} };

describe('published OpenAPI endpoint', () => {
  beforeEach(() => {
    mocks.getSiteOpenApi.mockResolvedValue({
      document,
      metadata: { title: 'API Reference', path: 'api-reference', contentHash: 'abc123', updatedAt: '2026-08-16T00:00:00.000Z' },
      project: { config: { visibility: 'public' } },
    });
  });

  it('serves the raw Scalar-compatible document with deployment-hash caching', async () => {
    const response = await app.request('/sites/project/openapi.json');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(document);
    expect(response.headers.get('etag')).toBe('"abc123"');
    expect(response.headers.get('cache-control')).toContain('public');
  });

  it('returns 304 when the immutable published hash already matches', async () => {
    const response = await app.request('/sites/project/openapi.json', { headers: { 'if-none-match': '"abc123"' } });
    expect(response.status).toBe(304);
    expect(await response.text()).toBe('');
  });

  it('never makes a private-site specification shared-cacheable', async () => {
    mocks.getSiteOpenApi.mockResolvedValueOnce({
      document,
      metadata: { title: 'API Reference', path: 'api-reference', contentHash: 'abc123', updatedAt: '2026-08-16T00:00:00.000Z' },
      project: { config: { visibility: 'private' } },
    });
    const response = await app.request('/sites/project/openapi.json');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
});

describe('published changelog RSS endpoint', () => {
  it('serves an RSS document with shared-cache headers for a public site', async () => {
    mocks.getSiteChangelogRss.mockResolvedValueOnce({ body: '<rss version="2.0"></rss>', isPrivate: false });
    const response = await app.request('/sites/project/changelog/rss.xml');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/rss+xml');
    expect(response.headers.get('cache-control')).toContain('public');
    expect(await response.text()).toContain('<rss');
  });
});

describe('grounded answer endpoint', () => {
  beforeEach(() => {
    mocks.answerSite.mockReset();
  });

  it('uses a POST body and prevents shared caching', async () => {
    mocks.answerSite.mockResolvedValueOnce({ status: 'no_answer', answer: 'No evidence.', confidence: 0, citations: [], cacheHit: false });
    const response = await app.request('/sites/project/answer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q: 'What is the SLA?', lang: 'en', version: 'main' }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toContain('Cookie');
    expect(mocks.answerSite).toHaveBeenCalledWith('project', 'What is the SLA?', 'en', 'main');
  });

  it('rejects empty and oversized answer requests before orchestration', async () => {
    expect(
      (await app.request('/sites/project/answer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"q":""}' })).status,
    ).toBe(422);
    expect(mocks.answerSite).not.toHaveBeenCalled();
  });
});
