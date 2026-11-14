import type { SiteSnapshot, SnapshotPage } from '@nibleaf/shared/site';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  projectFindUnique: vi.fn(),
  deploymentFindFirst: vi.fn(),
  deploymentFindUnique: vi.fn(),
  searchDocs: vi.fn(),
  runPublishedSearch: vi.fn(),
  getCachedIndex: vi.fn(),
}));

vi.mock('@nibleaf/database', () => ({
  // The canonical free plan as seeded in production: no entitlement rows.
  deliveryPlanSelect: {},
  loadDefaultDeliveryPlan: async () => ({ key: 'free', active: true, entitlements: [] }),
  prisma: {
    project: { findUnique: mocks.projectFindUnique },
    deployment: { findFirst: mocks.deploymentFindFirst, findUnique: mocks.deploymentFindUnique },
  },
}));
vi.mock('@nibleaf/search', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@nibleaf/search')>()),
  searchDocs: mocks.searchDocs,
}));
vi.mock('hono/context-storage', () => ({ getContext: () => ({ req: { raw: { headers: new Headers() } } }) }));
vi.mock('@/env', () => ({ env: {} }));
vi.mock('@nibleaf/storage', () => ({ getObjectStream: vi.fn() }));
vi.mock('@/actions/importers/ghost-assets', () => ({ fetchPublicImage: vi.fn() }));
vi.mock('@/lib/ai-search/quota', () => ({ consumeAnswerQuota: vi.fn(), recordAnswerServed: vi.fn(async () => undefined) }));
vi.mock('@/lib/ai-search/runtime', () => ({
  answerPublishedSearch: vi.fn(),
  answerSearchAvailable: vi.fn(),
  publishedSearchAnswerHint: vi.fn(() => false),
  runPublishedSearch: mocks.runPublishedSearch,
}));
vi.mock('@/lib/search-cache', () => ({ getCachedIndex: mocks.getCachedIndex }));
vi.mock('./analytics', () => ({ trackProjectEvent: vi.fn(), trackProjectEvents: vi.fn(async () => undefined) }));
vi.mock('./notifications', () => ({ createNotificationsForOrgMembers: vi.fn() }));
vi.mock('./reader-access', () => ({ resolveViewerAccess: vi.fn(async () => ({ kind: 'public', allowedPageIds: null })) }));

import og from '@/modules/public/sites/og';
import { trackProjectEvents } from './analytics';
import { resolveViewerAccess } from './reader-access';
import { getSiteOgData, getSitePage, getSitePageMarkdown, getSiteSitemap, invalidatePublishedSiteConfig, searchSite } from './sites';

const page = (over: Partial<SnapshotPage> & Pick<SnapshotPage, 'id' | 'path' | 'position'>): SnapshotPage => ({
  parentId: null,
  versionId: 'version-1',
  updatedAt: '2026-08-01T00:00:00.000Z',
  languageCode: 'en',
  kind: 'PAGE',
  title: over.path,
  slug: over.path,
  icon: null,
  description: null,
  content: '',
  config: null,
  translationKey: null,
  hidden: false,
  ...over,
});

const body =
  'Get started with the Acme API in about ten minutes. This guide walks you through creating an API key, making your first request, and paginating through results.';

const snapshot: SiteSnapshot = {
  project: {
    id: 'project-1',
    name: 'Docs',
    slug: 'docs',
    description: null,
    icon: null,
    config: {},
    languages: [{ code: 'en', label: 'English', direction: 'LTR', isDefault: true, config: null }],
    versions: [{ id: 'version-1', name: 'main', slug: 'main', isDefault: true }],
  },
  pages: [
    page({ id: 'page-lede', path: 'authentication', position: 0, title: 'Authentication', description: '  How tokens work.  ', content: body }),
    page({ id: 'page-no-lede', path: 'getting-started', position: 1, title: 'Getting started', content: `# Getting started\n\n${body}` }),
  ],
  generatedAt: '2026-08-01T00:00:00.000Z',
};

describe('getSitePage lede vs excerpt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidatePublishedSiteConfig('project-1');
    vi.mocked(resolveViewerAccess).mockReset().mockResolvedValue({ kind: 'public', allowedPageIds: null });
    mocks.projectFindUnique.mockImplementation(async ({ select }: { select: Record<string, unknown> }) =>
      'name' in select
        ? {
            name: 'Docs',
            description: null,
            icon: null,
            config: {},
            accessMode: 'PUBLIC',
            takedownAt: null,
            domains: [],
            languages: [{ code: 'en', enabled: true, config: null, projectTranslations: [] }],
            addons: [],
            organization: { usagePlan: null },
          }
        : { id: 'project-1' },
    );
    mocks.deploymentFindFirst.mockResolvedValue({ id: `deployment-${Math.random()}`, version: 1 });
    mocks.deploymentFindUnique.mockResolvedValue({ snapshot });
  });

  it('lists every language and version in one sitemap with canonical path prefixes', async () => {
    const languages = [...snapshot.project.languages, { code: 'ar', label: 'Arabic', direction: 'RTL' as const, isDefault: false, config: null }];
    mocks.deploymentFindUnique.mockResolvedValue({
      snapshot: {
        ...snapshot,
        project: {
          ...snapshot.project,
          languages,
          versions: [...snapshot.project.versions, { id: 'version-2', name: 'v2', slug: 'v2', isDefault: false }],
        },
        pages: [
          ...snapshot.pages,
          page({ id: 'arabic', path: 'guide', position: 2, languageCode: 'ar' }),
          page({ id: 'arabic-v2', path: 'guide', position: 2, languageCode: 'ar', versionId: 'version-2' }),
        ],
      },
    });
    const sitemap = await getSiteSitemap('project-1');
    expect(sitemap.body).toContain('/sites/project-1/authentication</loc>');
    expect(sitemap.body).toContain('/sites/project-1/ar/guide</loc>');
    expect(sitemap.body).toContain('/sites/project-1/ar/v2/guide</loc>');
    expect(sitemap.body).not.toContain('?lang=');
  });

  it('serves a real 1200×630 public PNG, revalidates it and changes ETag with the published title', async () => {
    const app = new Hono().route('/sites', og);
    const response = await app.request('/sites/project-1/og/authentication.png');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('public, no-cache, must-revalidate');
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([1200, 630]);
    const etag = response.headers.get('etag') ?? '';
    const unchanged = await app.request('/sites/project-1/og/authentication.png', { headers: { 'if-none-match': etag } });
    expect(unchanged.status).toBe(304);
    expect(await unchanged.text()).toBe('');
    mocks.deploymentFindFirst.mockResolvedValue({ id: 'deployment-new-title', version: 2 });
    mocks.deploymentFindUnique.mockResolvedValue({ snapshot: { ...snapshot, pages: [{ ...snapshot.pages[0], title: 'New title' }] } });
    const changed = await app.request('/sites/project-1/og/authentication.png', { headers: { 'if-none-match': etag } });
    expect(changed.status).toBe(200);
    expect(changed.headers.get('etag')).not.toBe(etag);
  });

  it.each(['WORKSPACE', 'READERS', 'takedown', 'unpublished', 'missing-page'])(
    'returns 404/no-store for %s, even after a cached public card',
    async (state) => {
      const app = new Hono().route('/sites', og);
      const publicResponse = await app.request('/sites/project-1/og/authentication.png');
      expect(publicResponse.status).toBe(200);
      const lookup = mocks.projectFindUnique.getMockImplementation();
      mocks.projectFindUnique.mockImplementation(async (query) => {
        const result = await lookup?.(query);
        return 'name' in query.select
          ? {
              ...result,
              accessMode: ['WORKSPACE', 'READERS'].includes(state) ? state : 'PUBLIC',
              takedownAt: state === 'takedown' ? new Date() : null,
            }
          : result;
      });
      // On a private site even an authenticated reader is refused a public card. Every
      // other state keeps a PUBLIC viewer, so the 404 comes from page resolution, not the viewer gate.
      vi.mocked(resolveViewerAccess).mockResolvedValueOnce(
        ['WORKSPACE', 'READERS'].includes(state) ? { kind: 'workspace', allowedPageIds: null } : { kind: 'public', allowedPageIds: null },
      );
      if (state === 'unpublished') mocks.deploymentFindFirst.mockResolvedValue(null);
      invalidatePublishedSiteConfig('project-1');
      const response = await app.request(`/sites/project-1/og/${state === 'missing-page' ? 'missing' : 'authentication'}.png`, {
        headers: { 'if-none-match': publicResponse.headers.get('etag') ?? '' },
      });
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(await response.text()).toBe('');
    },
  );

  it('serves the trimmed author-written description as the lede alongside the excerpt', async () => {
    const result = await getSitePage('project-1', 'authentication');
    expect(result.page.description).toBe('How tokens work.');
    expect(result.page.excerpt).toBe(body);
  });

  it('never promotes the derived excerpt to a lede when the author wrote no description', async () => {
    const result = await getSitePage('project-1', 'getting-started');
    expect(result.page.description).toBeNull();
    // The excerpt still exists for SEO/social meta — cut on a word boundary.
    expect(result.page.excerpt).toBe(
      'Getting started Get started with the Acme API in about ten minutes. This guide walks you through creating an API key, making your first request, and…',
    );
    expect(result.page.excerpt.length).toBeLessThanOrEqual(160);
  });

  it('serves a public page as title, summary, and authored Markdown', async () => {
    const result = await getSitePageMarkdown('project-1', 'authentication');
    expect(result).toEqual({
      body: `# Authentication\n\n> How tokens work.\n\n${body}\n`,
      isPrivate: false,
    });
  });

  it('serves an exact Arabic path and rejects a requested locale that fell back to English', async () => {
    const languages = [
      { code: 'en', label: 'English', direction: 'LTR' as const, isDefault: true, config: null },
      { code: 'ar', label: 'Arabic', direction: 'RTL' as const, isDefault: false, config: null },
    ];
    mocks.projectFindUnique.mockImplementation(async ({ select }: { select: Record<string, unknown> }) =>
      'name' in select
        ? {
            name: 'Docs',
            description: null,
            icon: null,
            config: {},
            accessMode: 'PUBLIC',
            takedownAt: null,
            domains: [],
            languages: languages.map((language) => ({ code: language.code, enabled: true, config: null, projectTranslations: [] })),
            addons: [],
            organization: { usagePlan: null },
          }
        : { id: 'project-1' },
    );
    invalidatePublishedSiteConfig('project-1');
    mocks.deploymentFindFirst.mockResolvedValue({ id: `deployment-ar-${Math.random()}`, version: 1 });
    mocks.deploymentFindUnique.mockResolvedValue({
      snapshot: {
        ...snapshot,
        project: { ...snapshot.project, languages },
        pages: [snapshot.pages[0], page({ id: 'page-ar', path: 'المقدمة', position: 1, languageCode: 'ar', title: 'المقدمة', content: 'ابدأ هنا.' })],
      },
    });

    await expect(getSitePageMarkdown('project-1', 'المقدمة', 'ar')).resolves.toMatchObject({ body: '# المقدمة\n\nابدأ هنا.\n' });
    await expect(getSitePageMarkdown('project-1', 'authentication', 'ar')).rejects.toMatchObject({
      status: 404,
      details: { language: 'ar', reason: 'language_fallback' },
    });
  });

  it('fails closed for noindex, canonicalized and hidden public pages, and serves private pages only to their authorized viewer as private', async () => {
    mocks.deploymentFindFirst.mockResolvedValueOnce({ id: `deployment-noindex-${Math.random()}`, version: 1 });
    mocks.deploymentFindUnique.mockResolvedValueOnce({
      snapshot: {
        ...snapshot,
        pages: [{ ...snapshot.pages[0], config: { seo: { noindex: true } } }],
      },
    });
    await expect(getSitePageMarkdown('project-1', 'authentication')).rejects.toMatchObject({ status: 404 });

    mocks.deploymentFindFirst.mockResolvedValueOnce({ id: `deployment-canonical-${Math.random()}`, version: 1 });
    mocks.deploymentFindUnique.mockResolvedValueOnce({
      snapshot: {
        ...snapshot,
        pages: [{ ...snapshot.pages[0], config: { seo: { canonicalUrl: 'https://origin.example/authentication' } } }],
      },
    });
    await expect(getSitePageMarkdown('project-1', 'authentication')).rejects.toMatchObject({ status: 404 });

    mocks.deploymentFindFirst.mockResolvedValueOnce({ id: `deployment-hidden-${Math.random()}`, version: 1 });
    mocks.deploymentFindUnique.mockResolvedValueOnce({
      snapshot: { ...snapshot, pages: [{ ...snapshot.pages[0], hidden: true }] },
    });
    await expect(getSitePageMarkdown('project-1', 'authentication')).rejects.toMatchObject({ status: 404 });

    mocks.projectFindUnique.mockImplementation(async ({ select }: { select: Record<string, unknown> }) =>
      'name' in select
        ? {
            name: 'Docs',
            description: null,
            icon: null,
            config: {},
            accessMode: 'READERS',
            takedownAt: null,
            domains: [],
            languages: [{ code: 'en', enabled: true, config: null, projectTranslations: [] }],
            addons: [],
            organization: { usagePlan: null },
          }
        : { id: 'project-1' },
    );
    invalidatePublishedSiteConfig('project-1');
    mocks.deploymentFindFirst.mockResolvedValueOnce({ id: `deployment-private-${Math.random()}`, version: 1 });
    mocks.deploymentFindUnique.mockResolvedValueOnce({ snapshot });
    // The viewer passed the access gate, so a private page's Markdown is theirs,
    // marked private (never shared-cached).
    await expect(getSitePageMarkdown('project-1', 'authentication')).resolves.toMatchObject({ isPrivate: true });
  });

  it('fails closed when the resolved language disables indexing', async () => {
    mocks.projectFindUnique.mockImplementation(async ({ select }: { select: Record<string, unknown> }) =>
      'name' in select
        ? {
            name: 'Docs',
            description: null,
            icon: null,
            config: {},
            accessMode: 'PUBLIC',
            takedownAt: null,
            domains: [],
            languages: [{ code: 'en', enabled: true, config: { seo: { allowIndex: false } }, projectTranslations: [] }],
            addons: [],
            organization: { usagePlan: null },
          }
        : { id: 'project-1' },
    );
    invalidatePublishedSiteConfig('project-1');
    mocks.deploymentFindFirst.mockResolvedValueOnce({ id: `deployment-language-noindex-${Math.random()}`, version: 1 });
    mocks.deploymentFindUnique.mockResolvedValueOnce({
      snapshot: {
        ...snapshot,
        project: {
          ...snapshot.project,
          languages: [{ ...snapshot.project.languages[0], config: { seo: { allowIndex: false } } }],
        },
      },
    });

    await expect(getSitePageMarkdown('project-1', 'authentication', 'en')).rejects.toMatchObject({ status: 404 });
  });
});

describe('searchSite multilingual scope', () => {
  const multilingualSnapshot: SiteSnapshot = {
    ...snapshot,
    project: {
      ...snapshot.project,
      languages: [
        { code: 'en', label: 'English', direction: 'LTR', isDefault: true, config: null },
        { code: 'ar', label: 'Arabic', direction: 'RTL', isDefault: false, config: null },
      ],
    },
    pages: [
      page({
        id: 'page-en',
        path: 'authentication',
        position: 0,
        languageCode: 'en',
        title: 'Authentication',
        content: ['Sign requests.', '', '## API keys', '', 'Create a token in the dashboard.'].join('\n'),
      }),
      page({ id: 'page-ar', path: 'authentication', position: 0, languageCode: 'ar', title: 'المصادقة' }),
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.projectFindUnique.mockImplementation(async ({ select }: { select: Record<string, unknown> }) =>
      'name' in select
        ? {
            name: 'Docs',
            description: null,
            icon: null,
            config: {},
            accessMode: 'PUBLIC',
            takedownAt: null,
            domains: [],
            languages: [
              { code: 'en', enabled: true, config: null, projectTranslations: [] },
              { code: 'ar', enabled: true, config: null, projectTranslations: [] },
            ],
            addons: [],
            organization: { usagePlan: null },
          }
        : { id: 'project-1' },
    );
    mocks.deploymentFindFirst.mockResolvedValue({ id: `deployment-search-${Math.random()}`, version: 1 });
    mocks.deploymentFindUnique.mockResolvedValue({ snapshot: multilingualSnapshot });
    mocks.getCachedIndex.mockImplementation(async (_projectId: string, _key: string, language: string) => ({ language }));
    mocks.searchDocs.mockImplementation(async (index: { language: string }) => [
      {
        id: `page-${index.language}`,
        title: index.language === 'ar' ? 'المصادقة' : 'Authentication',
        path: 'authentication',
        description: '',
        snippet: index.language === 'ar' ? 'استخدم رمزاً' : 'Use a token',
        score: index.language === 'ar' ? 20 : 10,
      },
    ]);
    mocks.runPublishedSearch.mockImplementation(async (_scope: unknown, _query: string, _limit: number, legacy: () => Promise<unknown[]>) => ({
      hits: await legacy(),
      runtime: 'legacy',
    }));
  });

  it('searches all published languages and annotates each result for localized routing', async () => {
    const result = await searchSite('project-1', 'token');
    expect(mocks.getCachedIndex.mock.calls.map((call) => call[2])).toEqual(['en', 'ar']);
    // The default language first, then the other languages; raw scores from
    // separate indexes are never compared.
    expect(result.hits).toEqual([
      expect.objectContaining({ id: 'page-en', language: 'en' }),
      expect.objectContaining({ id: 'page-ar', language: 'ar' }),
    ]);
  });

  it('refuses anonymous search on a private site before consulting any index', async () => {
    invalidatePublishedSiteConfig('project-1');
    const original = mocks.projectFindUnique.getMockImplementation();
    mocks.projectFindUnique.mockImplementation(async (args) => {
      const value = await original?.(args);
      return value && 'name' in value ? { ...value, accessMode: 'READERS' } : value;
    });
    vi.mocked(resolveViewerAccess).mockResolvedValueOnce(null);
    await expect(searchSite('project-1', 'invoice')).rejects.toMatchObject({ status: 404 });
    expect(resolveViewerAccess).toHaveBeenCalledWith('project-1', 'READERS', expect.any(Headers));
    expect(mocks.runPublishedSearch).not.toHaveBeenCalled();
    expect(mocks.getCachedIndex).not.toHaveBeenCalled();
    invalidatePublishedSiteConfig('project-1');
  });

  it('records analytics without waiting for the write to finish', async () => {
    let finish!: () => void;
    vi.mocked(trackProjectEvents).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const result = await searchSite('project-1', 'invoice');
    expect(result.hits.length).toBeGreaterThan(0);
    expect(trackProjectEvents).toHaveBeenCalledWith(
      'project-1',
      expect.arrayContaining([
        expect.objectContaining({ name: 'search_query_submitted', query: 'invoice' }),
        expect.objectContaining({ name: 'search_results_returned' }),
      ]),
      expect.any(Object),
    );
    finish();
  });

  it('reports the runtime of the language that actually returned hits', async () => {
    mocks.runPublishedSearch.mockImplementation(async (scope: { language: string }) => ({
      hits: scope.language === 'ar' ? [{ id: 'page-ar', title: 'المصادقة', path: 'authentication', description: '', snippet: '', score: 1 }] : [],
      runtime: scope.language === 'ar' ? 'hybrid' : 'legacy-fallback',
    }));
    expect((await searchSite('project-1', 'المصادقة')).runtime).toBe('hybrid');
  });

  it('reports mixed for returned hybrid and fallback hits, and fallback when all scopes fall back', async () => {
    mocks.runPublishedSearch.mockImplementation(async (scope: { language: string }) => ({
      hits: [{ id: `page-${scope.language}`, title: 'Token', path: 'authentication', description: '', snippet: '', score: 1 }],
      runtime: scope.language === 'ar' ? 'hybrid' : 'legacy-fallback',
    }));
    expect((await searchSite('project-1', 'token')).runtime).toBe('mixed');
    mocks.runPublishedSearch.mockResolvedValue({ hits: [], runtime: 'legacy-fallback' });
    expect((await searchSite('project-1', 'missing')).runtime).toBe('legacy-fallback');
  });

  it('keeps an Arabic reader’s result at a one-result limit on an English-default site, still searching every language', async () => {
    const result = await searchSite('project-1', 'token', undefined, 1, undefined, {}, 'ar');
    expect(mocks.getCachedIndex.mock.calls.map((call) => call[2])).toEqual(['en', 'ar']);
    expect(result.hits).toEqual([expect.objectContaining({ id: 'page-ar', language: 'ar' })]);
  });

  it('matches the preferred language by its base and ignores a language the site does not serve', async () => {
    expect((await searchSite('project-1', 'token', undefined, 1, undefined, {}, 'ar-SA')).hits[0]).toMatchObject({ language: 'ar' });
    expect((await searchSite('project-1', 'token', undefined, 1, undefined, {}, 'fr')).hits[0]).toMatchObject({ language: 'en' });
  });

  it('never widens a reader’s page grants: the same scope and pages with and without prefer', async () => {
    vi.mocked(resolveViewerAccess).mockResolvedValue({ kind: 'reader', allowedPageIds: new Set(['page-en']) } as never);
    onTestFinished(() => {
      vi.mocked(resolveViewerAccess).mockResolvedValue({ kind: 'public', allowedPageIds: null } as never);
    });
    const scopes = async (prefer?: string) => {
      vi.clearAllMocks();
      await searchSite('project-1', 'token', undefined, 10, undefined, {}, prefer);
      return {
        scopes: mocks.runPublishedSearch.mock.calls.map(([scope]) => scope),
        indexes: mocks.getCachedIndex.mock.calls.map(([, , language, pages, allowed]) => ({
          language,
          pages: (pages as Array<{ id: string }>).map((item) => item.id),
          allowed,
        })),
      };
    };
    const without = await scopes();
    const withPrefer = await scopes('ar');
    expect(withPrefer).toEqual(without);
    expect(without.indexes.every((index) => index.pages.join() === 'page-en')).toBe(true);
    expect(without.indexes.every((index) => JSON.stringify([...(index.allowed as Set<string>)]) === JSON.stringify(['page-en']))).toBe(true);
  });

  it('never widens a page-scoped reader on a three-language site, with or without prefer', async () => {
    const trilingual: SiteSnapshot = {
      ...multilingualSnapshot,
      project: {
        ...multilingualSnapshot.project,
        languages: [...multilingualSnapshot.project.languages, { code: 'fr', label: 'Français', direction: 'LTR', isDefault: false, config: null }],
      },
      pages: [
        ...multilingualSnapshot.pages,
        page({ id: 'page-fr', path: 'authentication', position: 0, languageCode: 'fr', title: 'Authentification' }),
      ],
    };
    mocks.deploymentFindUnique.mockResolvedValue({ snapshot: trilingual });
    vi.mocked(resolveViewerAccess).mockResolvedValue({ kind: 'reader', allowedPageIds: new Set(['page-en', 'page-fr']) } as never);
    onTestFinished(() => {
      vi.mocked(resolveViewerAccess).mockResolvedValue({ kind: 'public', allowedPageIds: null } as never);
    });
    const scopes = async (prefer?: string) => {
      vi.clearAllMocks();
      mocks.deploymentFindFirst.mockResolvedValue({ id: `deployment-trilingual-${prefer ?? 'none'}`, version: 1 });
      await searchSite('project-1', 'token', undefined, 10, undefined, {}, prefer);
      return {
        scopes: mocks.runPublishedSearch.mock.calls.map(([scope]) => scope),
        indexes: mocks.getCachedIndex.mock.calls.map(([, , language, pages, allowed]) => ({
          language,
          pages: (pages as Array<{ id: string }>).map((item) => item.id).sort(),
          allowed,
        })),
      };
    };
    const without = await scopes();
    expect(without.indexes.map((index) => index.language)).toEqual(['en', 'ar', 'fr']);
    for (const prefer of ['fr', 'ar']) {
      const withPrefer = await scopes(prefer);
      expect(withPrefer.indexes).toEqual(without.indexes);
      expect(withPrefer.scopes.map((scope) => ({ ...(scope as object), deploymentId: undefined }))).toEqual(
        without.scopes.map((scope) => ({ ...(scope as object), deploymentId: undefined })),
      );
    }
    expect(without.indexes.every((index) => index.pages.join() === 'page-en,page-fr')).toBe(true);
    expect(without.indexes.every((index) => JSON.stringify([...(index.allowed as Set<string>)]) === JSON.stringify(['page-en', 'page-fr']))).toBe(
      true,
    );
  });

  it('points a hit at the section that matched, with a preview from that section', async () => {
    const result = await searchSite('project-1', 'token');
    expect(result.hits.find((hit) => hit.id === 'page-en')).toMatchObject({
      section: { id: 'api-keys', title: 'API keys' },
      snippet: 'Create a token in the dashboard.',
    });
    expect(result.hits.find((hit) => hit.id === 'page-ar')).not.toHaveProperty('section');
  });

  it('keeps an explicit language scope for API clients', async () => {
    const result = await searchSite('project-1', 'token', 'ar');
    expect(mocks.getCachedIndex).toHaveBeenCalledTimes(1);
    expect(mocks.getCachedIndex.mock.calls[0]?.[2]).toBe('ar');
    expect(result.hits).toEqual([expect.objectContaining({ id: 'page-ar', language: 'ar' })]);
  });
});

describe('OG card page resolution: hidden pages, languages and versions', () => {
  const rich: SiteSnapshot = {
    ...snapshot,
    project: {
      ...snapshot.project,
      languages: [
        { code: 'en', label: 'English', direction: 'LTR', isDefault: true, config: null },
        { code: 'ar', label: 'العربية', direction: 'RTL', isDefault: false, config: null },
      ],
      versions: [
        { id: 'version-1', name: 'main', slug: 'main', isDefault: true },
        { id: 'version-2', name: 'v2', slug: 'v2', isDefault: false },
      ],
    },
    pages: [
      ...snapshot.pages,
      page({ id: 'hidden', path: 'internal', position: 5, title: 'Internal plan', hidden: true }),
      page({ id: 'ar-auth', path: 'authentication', position: 0, languageCode: 'ar', title: 'المصادقة' }),
      page({ id: 'v2-auth', path: 'authentication', position: 0, versionId: 'version-2', title: 'Authentication v2' }),
    ],
  };
  const liveLanguages = (arEnabled: boolean) => [
    { code: 'en', enabled: true, config: null, projectTranslations: [] },
    { code: 'ar', enabled: arEnabled, config: null, projectTranslations: [] },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveViewerAccess).mockReset().mockResolvedValue({ kind: 'public', allowedPageIds: null });
    mocks.deploymentFindFirst.mockResolvedValue({ id: `og-${Math.random()}`, version: 1 });
    mocks.deploymentFindUnique.mockResolvedValue({ snapshot: rich });
  });

  const live = (arEnabled: boolean) =>
    mocks.projectFindUnique.mockImplementation(async ({ select }: { select: Record<string, unknown> }) =>
      'name' in select
        ? {
            name: 'Docs',
            description: null,
            icon: null,
            config: {},
            accessMode: 'PUBLIC',
            takedownAt: null,
            domains: [],
            languages: liveLanguages(arEnabled),
            addons: [],
            organization: { usagePlan: null },
          }
        : { id: 'project-1' },
    );

  it('never makes a card for a hidden page', async () => {
    live(true);
    invalidatePublishedSiteConfig('project-1');
    await expect(getSiteOgData('project-1', 'internal')).rejects.toMatchObject({ status: 404 });
  });

  it('uses the language card when the language is enabled, RTL included', async () => {
    live(true);
    invalidatePublishedSiteConfig('project-1');
    await expect(getSiteOgData('project-1', 'authentication', 'ar')).resolves.toMatchObject({ title: 'المصادقة', rtl: true });
  });

  it('never leaks a disabled language: it falls back to the default-language card', async () => {
    live(false);
    invalidatePublishedSiteConfig('project-1');
    const card = await getSiteOgData('project-1', 'authentication', 'ar');
    expect(card).toMatchObject({ title: 'Authentication', rtl: false });
  });

  it('resolves a versioned path to that version, and an unknown page to 404', async () => {
    live(true);
    invalidatePublishedSiteConfig('project-1');
    await expect(getSiteOgData('project-1', 'v2/authentication', undefined, 'v2')).resolves.toMatchObject({ title: 'Authentication v2' });
    await expect(getSiteOgData('project-1', 'v2/no-such-page', undefined, 'v2')).rejects.toMatchObject({ status: 404 });
  });
});
