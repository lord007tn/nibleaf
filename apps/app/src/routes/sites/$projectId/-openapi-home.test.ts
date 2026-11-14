import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import type { SiteShell } from '@/hooks/api/types';

const mocks = vi.hoisted(() => ({ getSite: vi.fn(), query: vi.fn(), redirectIfConfigured: vi.fn() }));
vi.mock('@/functions/site', () => ({ getSiteFn: mocks.getSite, listSiteChangelogFn: vi.fn() }));
vi.mock('@/lib/site-origin', () => ({ customDomainOrigin: () => null }));
vi.mock('@/lib/site-redirects', () => ({ redirectIfConfigured: mocks.redirectIfConfigured }));

import { Route as SplatRoute } from './$';
import { Route as IndexRoute } from './index';

const fixture: SiteShell = {
  project: { id: 'api-only', name: 'API docs', slug: 'api-only', description: null, config: null, primaryDomain: null },
  nav: [],
  languages: [
    { code: 'en', label: 'English', direction: 'LTR', isDefault: true },
    { code: 'ar', label: 'Arabic', direction: 'RTL', isDefault: false },
  ],
  versions: [
    { id: 'main', name: 'Main', slug: 'main', isDefault: true },
    { id: 'v2', name: 'V2', slug: 'v2', isDefault: false },
  ],
  activeLanguage: 'en',
  activeVersion: 'main',
  languageConfig: null,
  version: 1,
  generatedAt: '2026-11-14T00:00:00.000Z',
  openapi: { title: 'API reference', path: 'reference', contentHash: 'fixture', updatedAt: '2026-11-14T00:00:00.000Z' },
};

const load = (path: string, site = fixture, searchStr = '', hash = '') => {
  const loader = SplatRoute.options.loader as (input: unknown) => Promise<unknown>;
  return loader({
    params: { projectId: 'api-only', _splat: path },
    deps: {},
    location: { searchStr, hash },
    context: { queryClient: { query: mocks.query } },
    parentMatchPromise: Promise.resolve({ loaderData: { site } }),
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockRejectedValue(new ApiResponseError('Page not found', 404, 'NOT_FOUND'));
  mocks.getSite.mockResolvedValue(fixture);
});

describe('API-only homepages', () => {
  it.each([undefined, 'en'])('keeps the default index fallback for %s', async (lang) => {
    const loader = IndexRoute.options.loader as (input: unknown) => Promise<unknown>;
    await expect(
      loader({ params: { projectId: 'api-only' }, deps: { lang }, context: { queryClient: { query: mocks.query } } }),
    ).rejects.toMatchObject({ options: { href: '/sites/api-only/reference', statusCode: 302 } });
  });

  it.each([
    ['ar', '/sites/api-only/ar/reference', 'ar', undefined],
    ['v2', '/sites/api-only/v2/reference', undefined, 'v2'],
    ['ar/v2', '/sites/api-only/ar/v2/reference', 'ar', 'v2'],
    ['ar/main', '/sites/api-only/ar/reference', 'ar', 'main'],
  ])('redirects %s to the reference with its language and version', async (path, href, language, version) => {
    await expect(load(path, fixture, '?tab=cli', 'install')).rejects.toMatchObject({ options: { href: `${href}?tab=cli#install`, statusCode: 302 } });
    expect(mocks.getSite).toHaveBeenCalledWith({
      data: {
        projectId: 'api-only',
        language,
        version,
      },
    });
  });

  it.each(['~lang/ar', '~lang~/ar'])('uses the published collision prefix %s', async (pathPrefix) => {
    const site = { ...fixture, languages: fixture.languages.map((language) => (language.isDefault ? language : { ...language, pathPrefix })) };
    mocks.getSite.mockResolvedValue(site);
    await expect(load(pathPrefix, site)).rejects.toMatchObject({ options: { href: `/sites/api-only/${pathPrefix}/reference`, statusCode: 302 } });
  });

  it.each([
    ['reference', 'en', 'main', '/sites/api-only/reference'],
    ['ar/reference', 'ar', 'main', '/sites/api-only/ar/reference'],
    ['v2/reference', 'en', 'v2', '/sites/api-only/v2/reference'],
    ['ar/v2/reference', 'ar', 'v2', '/sites/api-only/ar/v2/reference'],
  ])('renders the reference at %s after following the redirect', async (path, activeLanguage, activeVersion, canonical) => {
    mocks.getSite.mockResolvedValue({ ...fixture, activeLanguage, activeVersion });
    const data = await load(path);
    expect(data).toMatchObject({ kind: 'openapi', site: { activeLanguage, activeVersion } });
    const head = SplatRoute.options.head as (input: unknown) => { links: Array<{ rel: string; href: string }> };
    expect(head({ loaderData: data, params: { projectId: 'api-only' }, match: {}, matches: [] }).links).toContainEqual({
      rel: 'canonical',
      href: `http://localhost:4310${canonical}`,
    });
  });

  it('keeps an exact API path when its root also names a version', async () => {
    const site = {
      ...fixture,
      activeVersion: 'v2',
      openapi: { title: 'API reference', path: 'v2/reference', contentHash: 'fixture', updatedAt: '2026-11-14T00:00:00.000Z' },
    };
    mocks.getSite.mockResolvedValue(site);
    await expect(load('ar/v2/reference', site)).resolves.toMatchObject({ kind: 'openapi', version: undefined });
  });

  it('does not turn an unrelated missing path into an API homepage', async () => {
    await expect(load('ar/missing')).rejects.toMatchObject({ isNotFound: true });
  });

  it('keeps an inaccessible API-only homepage hidden', async () => {
    mocks.getSite.mockRejectedValue(new ApiResponseError('Site not found', 404, 'NOT_FOUND'));
    await expect(load('ar')).rejects.toMatchObject({ isNotFound: true });
  });

  it('does not hide a retryable page failure behind a reference redirect', async () => {
    mocks.query.mockRejectedValue(new ApiResponseError('Unavailable', 503, 'UNAVAILABLE'));
    await expect(load('ar')).rejects.toMatchObject({ status: 503 });
    expect(mocks.getSite).not.toHaveBeenCalled();
  });
});
