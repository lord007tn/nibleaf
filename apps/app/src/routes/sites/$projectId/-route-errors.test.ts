import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { getSiteFn } from '@/functions/site';

const mocks = vi.hoisted(() => ({ getSite: vi.fn() }));
vi.mock('@/services/api', () => ({ api: { public: { sites: { ':id': { $get: mocks.getSite } } } } }));
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

import { Route } from './route';

const load = (projectId = 'qa-site', pathname = '/sites/qa-site/guide', lang: string | undefined = 'ar') => {
  const loader = Route.options.loader as (input: {
    params: { projectId: string };
    deps: { lang?: string };
    location: { pathname: string };
  }) => Promise<unknown>;
  return loader({ params: { projectId }, deps: { lang }, location: { pathname } });
};

const apiError = (status: number) =>
  Response.json({ error: { code: 'UPSTREAM_FAILURE', message: 'Temporarily unavailable' } }, { status, headers: { 'retry-after': '30' } });

beforeEach(() => {
  mocks.getSite.mockReset();
});

describe('published reader route input', () => {
  it('titles reader pages when the site shell fails to load', () => {
    const head = Route.options.head as unknown as (context: { loaderData?: unknown; match: { search: { lang?: string } }; matches: [] }) => {
      meta?: unknown[];
    };
    expect(head({ match: { search: { lang: 'ar' } }, matches: [] }).meta).toEqual([{ title: 'الوثائق' }]);
    expect(head({ match: { search: {} }, matches: [] }).meta).toEqual([{ title: 'Documentation' }]);
  });

  it('loads the site shell for a malformed percent path instead of throwing', async () => {
    mocks.getSite.mockResolvedValueOnce(
      Response.json({
        data: {
          project: { id: 'qa-site' },
          languages: [
            { code: 'en', isDefault: true },
            { code: 'ar', isDefault: false },
          ],
          versions: [{ id: 'main', slug: 'main', isDefault: true }],
          activeLanguage: 'ar',
          activeVersion: 'main',
        },
      }),
    );

    await expect(load('qa-site', '/sites/qa-site/%E0%A4/guide')).resolves.toMatchObject({ site: { project: { id: 'qa-site' } } });
    expect(mocks.getSite).toHaveBeenCalledExactlyOnceWith({ param: { id: 'qa-site' }, query: { lang: 'ar', version: '%E0%A4' } });
  });

  it('marks a private site and keeps its sign-in branding so the reader can offer a way in', async () => {
    const gate = { projectId: 'qa-site', name: 'Acme', mode: 'READERS', language: { code: 'ar', direction: 'RTL' }, config: null };
    mocks.getSite.mockResolvedValueOnce(
      Response.json({ error: { code: 'database:not_found', message: 'site not found', details: { reason: 'private', gate } } }, { status: 404 }),
    );

    await expect(load()).resolves.toEqual({ site: null, siteOrigin: null, unavailable: 'private', gate });
    // The tab title follows the site's own language when the URL names none.
    const head = Route.options.head as unknown as (context: { loaderData?: unknown; match: { search: { lang?: string } }; matches: [] }) => {
      meta?: Array<{ title?: string }>;
    };
    expect(head({ loaderData: { site: null, unavailable: 'private', gate }, match: { search: {} }, matches: [] }).meta?.[0]).toEqual({
      title: 'هذا التوثيق خاص',
    });
  });

  it('keeps an unpublished site on the not-published screen', async () => {
    mocks.getSite.mockResolvedValueOnce(
      Response.json({ error: { code: 'database:not_found', message: 'site not found', details: { reason: 'not_published' } } }, { status: 404 }),
    );
    await expect(load()).resolves.toEqual({ site: null, siteOrigin: null, unavailable: undefined });
  });

  it('retains the real server function validator before reaching the API', async () => {
    await expect(getSiteFn({ data: { projectId: 'qa-site', version: '' } })).rejects.toBeInstanceOf(ZodError);
    expect(mocks.getSite).not.toHaveBeenCalled();
  });

  it.each([
    ['$projectId', '/sites/$projectId'],
    ['$projectId', '/sites/%24projectId'],
    ['[', '/sites/['],
    ['[', '/sites/%5B'],
    ['+', '/sites/+'],
    ['+', '/sites/%2B'],
    ['a.b', '/sites/a.b'],
    ['productops-invalid-20261021', '/sites/productops-invalid-20261021'],
  ])('lets missing identifier %s at %s reach the normal not-found lookup', async (projectId, pathname) => {
    mocks.getSite.mockResolvedValueOnce(apiError(404));

    // No site has that id: "No site at this address", not "Not published yet".
    await expect(load(projectId, pathname)).resolves.toEqual({ site: null, siteOrigin: null, unavailable: 'missing' });
    expect(mocks.getSite).toHaveBeenCalledExactlyOnceWith({ param: { id: projectId }, query: { lang: 'ar' } });
  });

  it.each([
    ['$projectId', '/sites/%24projectId/v2/guide', 'v2', 'en'],
    ['[', '/sites/%5B/v2/guide', 'v2', 'ar'],
    ['+', '/sites/%2B/المقدمة', 'المقدمة', 'ar'],
    ['qa-site', '/sites/qa-site', undefined, 'en'],
    ['qa-site', '/sites/qa-site/', undefined, 'ar'],
    ['qa-site', '/sites/qa-site/v2', 'v2', 'en'],
    ['qa-site', '/sites/qa-site/v2/guide/', 'v2', 'ar'],
    ['qa-site', '/sites/qa-site/changelog', undefined, 'ar'],
    ['qa-site', '/sites/qa-site/%D8%A7%D9%84%D9%85%D9%82%D8%AF%D9%85%D8%A9', 'المقدمة', 'ar'],
  ])('preserves the requested version and language for %s at %s', async (projectId, pathname, version, lang) => {
    const site = { project: { id: projectId }, nav: [], languages: [], versions: [] };
    mocks.getSite.mockResolvedValueOnce(Response.json({ data: site }));

    await expect(load(projectId, pathname, lang)).resolves.toEqual({ site, siteOrigin: null });
    expect(mocks.getSite).toHaveBeenCalledExactlyOnceWith({
      param: { id: projectId },
      query: { lang, ...(version ? { version } : {}) },
    });
  });
});

describe('published reader failure recovery', () => {
  it('keeps a genuine missing or privacy-hidden publication unavailable', async () => {
    mocks.getSite.mockResolvedValueOnce(apiError(404));
    await expect(load()).resolves.toEqual({ site: null, siteOrigin: null, unavailable: 'missing' });
  });
  it.each([429, 500, 503])('preserves HTTP %i failures for the retryable error boundary', async (status) => {
    mocks.getSite.mockResolvedValueOnce(apiError(status));
    await expect(load()).rejects.toMatchObject({ name: 'ApiResponseError', status, code: 'UPSTREAM_FAILURE', retryAfter: '30' });
  });
  it('preserves network failures instead of claiming content was never published', async () => {
    const error = new TypeError('fetch failed');
    mocks.getSite.mockRejectedValueOnce(error);
    await expect(load()).rejects.toBe(error);
  });
});
