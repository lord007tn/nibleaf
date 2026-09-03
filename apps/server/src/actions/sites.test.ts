import type { SiteSnapshot, SnapshotPage } from '@nibleaf/shared/site';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  projectFindUnique: vi.fn(),
  deploymentFindFirst: vi.fn(),
  deploymentFindUnique: vi.fn(),
  searchDocs: vi.fn(),
  runPublishedSearch: vi.fn(),
  getCachedIndex: vi.fn(),
}));

vi.mock('@nibleaf/database', () => ({
  prisma: {
    project: { findUnique: mocks.projectFindUnique },
    deployment: { findFirst: mocks.deploymentFindFirst, findUnique: mocks.deploymentFindUnique },
  },
}));
vi.mock('@nibleaf/search', () => ({ searchDocs: mocks.searchDocs }));
vi.mock('hono/context-storage', () => ({ getContext: () => ({ req: { raw: { headers: new Headers() } } }) }));
vi.mock('@/env', () => ({ env: {} }));
vi.mock('@/lib/ai-search/quota', () => ({ consumeAnswerQuota: vi.fn() }));
vi.mock('@/lib/ai-search/runtime', () => ({
  answerPublishedSearch: vi.fn(),
  answerSearchAvailable: vi.fn(),
  runPublishedSearch: mocks.runPublishedSearch,
}));
vi.mock('@/lib/search-cache', () => ({ getCachedIndex: mocks.getCachedIndex }));
vi.mock('./analytics', () => ({ trackProjectEvent: vi.fn() }));
vi.mock('./notifications', () => ({ createNotificationsForOrgMembers: vi.fn() }));
vi.mock('./reader-access', () => ({ resolveViewerAccess: vi.fn(async () => ({ kind: 'public', allowedPageIds: null })) }));

import { getSitePage, getSitePageMarkdown, invalidatePublishedSiteConfig, searchSite } from './sites';

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

  it('fails closed for noindex and private-reader content even when the viewer is authorized', async () => {
    mocks.deploymentFindFirst.mockResolvedValueOnce({ id: `deployment-noindex-${Math.random()}`, version: 1 });
    mocks.deploymentFindUnique.mockResolvedValueOnce({
      snapshot: {
        ...snapshot,
        pages: [{ ...snapshot.pages[0], config: { seo: { noindex: true } } }],
      },
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
    await expect(getSitePageMarkdown('project-1', 'authentication')).rejects.toMatchObject({ status: 404 });
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
      page({ id: 'page-en', path: 'authentication', position: 0, languageCode: 'en', title: 'Authentication' }),
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
    expect(result.hits).toEqual([
      expect.objectContaining({ id: 'page-ar', language: 'ar' }),
      expect.objectContaining({ id: 'page-en', language: 'en' }),
    ]);
  });

  it('keeps an explicit language scope for API clients', async () => {
    const result = await searchSite('project-1', 'token', 'ar');
    expect(mocks.getCachedIndex).toHaveBeenCalledTimes(1);
    expect(mocks.getCachedIndex.mock.calls[0]?.[2]).toBe('ar');
    expect(result.hits).toEqual([expect.objectContaining({ id: 'page-ar', language: 'ar' })]);
  });
});
