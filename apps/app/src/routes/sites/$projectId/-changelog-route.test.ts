import { isNotFound } from '@tanstack/react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getSite: vi.fn(), getChangelog: vi.fn() }));
vi.mock('@/services/api', () => ({
  api: { public: { sites: { ':id': { $get: mocks.getSite, changelog: { $get: mocks.getChangelog } } } } },
}));
vi.mock('@/lib/site-origin', () => ({ customDomainOrigin: () => null }));
vi.mock('@tanstack/react-start', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-start')>()),
  // Keep the real server function's schema and handler; replace only its transport.
  createServerFn: () => ({
    validator: <T>(schema: { parse: (input: unknown) => T }) => ({
      handler:
        <TResult>(handler: (input: { data: T }) => TResult) =>
        async ({ data }: { data: unknown }) =>
          handler({ data: schema.parse(data) }),
    }),
    handler: <T>(handler: T) => handler,
  }),
}));

import { Route } from './changelog';

const load = (projectId = 'qa-site') => {
  const loader = Route.options.loader as (input: { params: { projectId: string }; deps: { lang?: string } }) => Promise<unknown>;
  return loader({ params: { projectId }, deps: { lang: 'ar' } });
};

const apiError = (status: number) =>
  Response.json({ error: { code: 'UPSTREAM_FAILURE', message: 'Temporarily unavailable' } }, { status, headers: { 'retry-after': '30' } });

beforeEach(() => {
  mocks.getSite.mockReset();
  mocks.getChangelog.mockReset();
});

describe('published changelog route', () => {
  it.each(['$projectId', 'missing-site'])('returns the router not-found sentinel for missing site %s', async (projectId) => {
    mocks.getSite.mockResolvedValueOnce(apiError(404));

    const error = await load(projectId).catch((caught: unknown) => caught);
    expect(isNotFound(error)).toBe(true);
    expect(mocks.getChangelog).not.toHaveBeenCalled();
  });

  it.each([429, 500, 503])('preserves HTTP %i failures for the retryable error boundary', async (status) => {
    mocks.getSite.mockResolvedValueOnce(apiError(status));

    await expect(load()).rejects.toMatchObject({ name: 'ApiResponseError', status, retryAfter: '30' });
  });

  it('keeps the site shell when only the optional changelog feed fails', async () => {
    const site = { project: { id: 'qa-site' }, nav: [], languages: [], versions: [] };
    mocks.getSite.mockResolvedValueOnce(Response.json({ data: site }));
    mocks.getChangelog.mockResolvedValueOnce(apiError(503));

    await expect(load()).resolves.toEqual({ site, entries: [], lang: 'ar', siteOrigin: null });
  });

  it('returns published entries with the site shell', async () => {
    const site = { project: { id: 'qa-site' }, nav: [], languages: [], versions: [] };
    const entries = [{ version: 2, publishedAt: '2026-10-01T00:00:00.000Z' }];
    mocks.getSite.mockResolvedValueOnce(Response.json({ data: site }));
    mocks.getChangelog.mockResolvedValueOnce(Response.json({ data: entries }));

    await expect(load()).resolves.toEqual({ site, entries, lang: 'ar', siteOrigin: null });
    expect(mocks.getChangelog).toHaveBeenCalledExactlyOnceWith({ param: { id: 'qa-site' } });
  });
});
