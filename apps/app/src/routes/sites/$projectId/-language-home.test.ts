import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const load = (pathname: string) => {
  const loader = Route.options.loader as (input: {
    params: { projectId: string };
    deps: { lang?: string };
    location: { pathname: string; searchStr: string; hash: string };
  }) => Promise<unknown>;
  return loader({ params: { projectId: 'qa-site' }, deps: {}, location: { pathname, searchStr: '', hash: '' } });
};

const shell = (arPrefix: string, activeLanguage: string, activeVersion = 'main') =>
  Response.json({
    data: {
      project: { id: 'qa-site' },
      languages: [
        { code: 'en', isDefault: true, pathPrefix: 'en' },
        { code: 'ar', isDefault: false, pathPrefix: arPrefix },
      ],
      versions: [
        { id: 'main', slug: 'main', isDefault: true },
        { id: 'v2', slug: 'v2', isDefault: false },
      ],
      activeLanguage,
      activeVersion,
    },
  });

beforeEach(() => {
  mocks.getSite.mockReset();
});

describe('non-default language homepages', () => {
  it('loads /ar without sending an empty version', async () => {
    mocks.getSite.mockResolvedValueOnce(shell('ar', 'en')).mockResolvedValueOnce(shell('ar', 'ar'));
    await expect(load('/sites/qa-site/ar')).resolves.toMatchObject({ site: { activeLanguage: 'ar' } });
    expect(mocks.getSite).toHaveBeenLastCalledWith({ param: { id: 'qa-site' }, query: { lang: 'ar' } });
  });

  it('loads a collision-escaped /~lang/ar homepage', async () => {
    mocks.getSite.mockResolvedValueOnce(shell('~lang/ar', 'en')).mockResolvedValueOnce(shell('~lang/ar', 'ar'));
    await expect(load('/sites/qa-site/~lang/ar')).resolves.toMatchObject({ site: { activeLanguage: 'ar' } });
    expect(mocks.getSite).toHaveBeenLastCalledWith({ param: { id: 'qa-site' }, query: { lang: 'ar' } });
  });

  it('keeps the version on a versioned language homepage', async () => {
    mocks.getSite.mockResolvedValueOnce(shell('ar', 'en')).mockResolvedValueOnce(shell('ar', 'ar', 'v2'));
    await expect(load('/sites/qa-site/ar/v2')).resolves.toMatchObject({ site: { activeLanguage: 'ar', activeVersion: 'v2' } });
    expect(mocks.getSite).toHaveBeenLastCalledWith({ param: { id: 'qa-site' }, query: { lang: 'ar', version: 'v2' } });
  });
});
