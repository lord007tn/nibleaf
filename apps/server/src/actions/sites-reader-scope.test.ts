import { buildAssetReferencesSync, type PublishedAssetReferences } from '@nibleaf/shared/asset-references';
import type { SiteSnapshot, SnapshotPage } from '@nibleaf/shared/site';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  projectFindUnique: vi.fn(),
  deploymentFindFirst: vi.fn(),
  deploymentFindUnique: vi.fn(),
  deploymentFindMany: vi.fn(),
  deploymentCreate: vi.fn(),
  deploymentAggregate: vi.fn(),
  resolveViewerAccess: vi.fn(),
  runPublishedSearch: vi.fn(),
  getCachedIndex: vi.fn(),
  warn: vi.fn(),
  // Whether this instance can encrypt and write conversation text.
  storageReady: true,
}));
vi.mock('@nibleaf/logger', () => ({ logger: { warn: mocks.warn, info: vi.fn(), debug: vi.fn(), error: vi.fn() } }));

vi.mock('@nibleaf/database', () => ({
  // The canonical free plan as seeded in production: no entitlement rows.
  deliveryPlanSelect: {},
  loadDefaultDeliveryPlan: async () => ({ key: 'free', active: true, entitlements: [] }),
  Prisma: { DbNull: null },
  prisma: {
    project: { findUnique: mocks.projectFindUnique },
    deployment: {
      findFirst: mocks.deploymentFindFirst,
      findUnique: mocks.deploymentFindUnique,
      findMany: mocks.deploymentFindMany,
      create: mocks.deploymentCreate,
      aggregate: mocks.deploymentAggregate,
    },
  },
}));
vi.mock('@nibleaf/search', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@nibleaf/search')>()),
  searchDocs: vi.fn(async () => []),
}));
vi.mock('hono/context-storage', () => ({ getContext: () => ({ req: { raw: { headers: new Headers() } } }) }));
vi.mock('@/env', () => ({ env: { APP_URL: 'https://app.example.test' } }));
vi.mock('@/lib/ai-search/quota', () => ({ consumeAnswerQuota: vi.fn() }));
vi.mock('@/lib/ai-search/conversation-archive', () => ({
  readerQuestionStorage: (captureSetting: boolean) =>
    captureSetting && mocks.storageReady
      ? { storesQuestions: true, questionRetentionDays: 30 }
      : { storesQuestions: false, questionRetentionDays: null },
}));
vi.mock('@/lib/ai-search/runtime', () => ({
  answerPublishedSearch: vi.fn(),
  answerSearchAvailable: vi.fn(async () => false),
  runPublishedSearch: mocks.runPublishedSearch,
}));
vi.mock('@/lib/search-cache', () => ({ getCachedIndex: mocks.getCachedIndex }));
vi.mock('./analytics', () => ({ trackProjectEvent: vi.fn(), trackProjectEvents: vi.fn(async () => undefined) }));
vi.mock('./notifications', () => ({ createNotificationsForOrgMembers: vi.fn() }));
vi.mock('./reader-access', () => ({ resolveViewerAccess: mocks.resolveViewerAccess }));

vi.mock('@nibleaf/bullmq', () => ({ createJob: vi.fn(async () => undefined), QueueNames: { PUBLISH: 'publish' } }));
vi.mock('./projects', () => ({ assertProjectInOrg: vi.fn(async () => ({ takedownAt: null })) }));

import { rollbackDeployment } from './deployments';

import {
  getProjectAssetAccess,
  getSite,
  getSiteChangelog,
  getSiteChangelogRss,
  getSiteOpenApi,
  getSitePage,
  invalidatePublishedSiteConfig,
  resolvePublishedAnswerContext,
  searchSite,
} from './sites';

const PARENT_BODY = 'Internal pricing plan. ![](/api/public/assets/projects/project-1/assets/parent-chart.png)';
const CHILD_BODY = 'Customer setup guide. ![](/api/public/assets/projects/project-1/assets/child-shot.png)';

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
    page({
      id: 'parent',
      path: 'plan',
      position: 0,
      title: 'Plan',
      description: 'Parent summary',
      content: PARENT_BODY,
      config: { seo: { ogImage: '/api/public/assets/projects/project-1/assets/parent-og.png' } },
    }),
    page({ id: 'child', parentId: 'parent', path: 'plan/guide', position: 0, title: 'Guide', content: CHILD_BODY }),
    page({ id: 'other', path: 'other', position: 1, title: 'Other', content: 'Unrelated restricted body.' }),
  ],
  openapi: {
    title: 'API Reference',
    path: 'api-reference',
    contentHash: 'hash-1',
    updatedAt: '2026-08-01T00:00:00.000Z',
    document: { openapi: '3.1.0', info: { title: 'Private API', version: '1' }, paths: { '/internal': {} } },
  },
  generatedAt: '2026-08-01T00:00:00.000Z',
};

const liveChrome = (config: Record<string, unknown> = {}) => ({
  name: 'Docs',
  description: null,
  icon: null,
  config,
  accessMode: 'READERS',
  takedownAt: null,
  domains: [],
  languages: [{ code: 'en', enabled: true, config: null, projectTranslations: [] }],
  addons: [],
  organization: { usagePlan: null },
});

let preparedIndex: PublishedAssetReferences;
const withIndex = <T extends { snapshot: SiteSnapshot }>(row: T) => {
  preparedIndex = buildAssetReferencesSync(row.snapshot, () => undefined);
  return { ...row, assetReferenceIndex: preparedIndex };
};
const assetMetadata = (row: { id: string; version: number } | null) =>
  row
    ? {
        ...row,
        assetReferenceBytes: preparedIndex.weight,
        assetSourceBytes: null,
        assetSourcePages: null,
      }
    : null;

const pageReader = (...ids: string[]) => ({ kind: 'reader', readerId: 'reader-1', allowedPageIds: new Set(ids) });
const siteReader = { kind: 'reader', readerId: 'reader-1', allowedPageIds: null };

beforeEach(() => {
  vi.clearAllMocks();
  invalidatePublishedSiteConfig('project-1');
  mocks.projectFindUnique.mockImplementation(async ({ select }: { select: Record<string, unknown> }) =>
    'name' in select ? liveChrome({ logo: { light: '/api/public/assets/projects/project-1/assets/logo.svg' } }) : { id: 'project-1' },
  );
  const deploymentId = `deployment-${Math.random()}`;
  mocks.deploymentFindFirst.mockImplementation(async () => assetMetadata({ id: deploymentId, version: 3 }));
  mocks.deploymentFindUnique.mockResolvedValue(withIndex({ snapshot }));
  mocks.deploymentFindMany.mockResolvedValue([
    { version: 3, completedAt: new Date('2026-08-01T00:00:00.000Z'), commitMessage: 'Add plan', pagesCount: 3 },
  ]);
  mocks.resolveViewerAccess.mockResolvedValue(pageReader('child'));
  mocks.getCachedIndex.mockResolvedValue({});
  mocks.runPublishedSearch.mockImplementation(async (_scope: unknown, _query: string, _limit: number, legacy: () => Promise<unknown>) => {
    await legacy();
    return { hits: [], runtime: 'legacy' };
  });
});

describe('page bodies for a page-scoped reader', () => {
  it('never renders an ungranted parent page body', async () => {
    const result = await getSitePage('project-1', 'plan');
    expect(result.page.id).toBe('child');
    expect(JSON.stringify(result)).not.toContain('Internal pricing plan');
    expect(JSON.stringify(result)).not.toContain('Parent summary');
  });

  it('keeps the parent as a navigation label without linking to it as a readable page', async () => {
    const site = await getSite('project-1');
    expect(site.nav).toEqual([
      expect.objectContaining({ id: 'parent', kind: 'GROUP', title: 'Plan', children: [expect.objectContaining({ id: 'child', kind: 'PAGE' })] }),
    ]);
    const result = await getSitePage('project-1', 'plan/guide');
    expect(result.prev).toBeNull();
    expect(result.next).toBeNull();
    expect(result.breadcrumbs).toEqual([
      { title: 'Plan', path: 'plan' },
      { title: 'Guide', path: 'plan/guide' },
    ]);
  });

  it('indexes only granted page bodies for search and Ask AI', async () => {
    await searchSite('project-1', 'pricing');
    const indexed = mocks.getCachedIndex.mock.calls[0]?.[3] as SnapshotPage[];
    expect(indexed.filter((item) => item.kind === 'PAGE').map((item) => item.id)).toEqual(['child']);
    expect(JSON.stringify(indexed)).not.toContain('Internal pricing plan');

    const context = await resolvePublishedAnswerContext('project-1');
    expect(context.versionPages.filter((item) => item.kind === 'PAGE').map((item) => item.id)).toEqual(['child']);
    expect(JSON.stringify(context.snapshot.pages)).not.toContain('Internal pricing plan');
    expect(context.scope.allowedPageIds).toEqual(new Set(['child']));
  });

  it('serves the parent body once the parent is granted too', async () => {
    mocks.resolveViewerAccess.mockResolvedValue(pageReader('parent', 'child'));
    const result = await getSitePage('project-1', 'plan');
    expect(result.page).toMatchObject({ id: 'parent', content: PARENT_BODY });
  });
});

describe('question storage in the site shell', () => {
  it('says questions are stored only when the site keeps them and the instance can', async () => {
    mocks.storageReady = true;
    expect((await getSite('project-1')).capabilities).toMatchObject({ storesQuestions: true, questionRetentionDays: 30 });

    mocks.storageReady = false;
    invalidatePublishedSiteConfig('project-1');
    expect((await getSite('project-1')).capabilities).toMatchObject({ storesQuestions: false, questionRetentionDays: null });

    mocks.storageReady = true;
    invalidatePublishedSiteConfig('project-1');
    // The site's live setting, as the chat itself reads it.
    mocks.projectFindUnique.mockImplementation(async ({ select }: { select: Record<string, unknown> }) =>
      'name' in select ? liveChrome({ search: { aiConversationCapture: false } }) : { id: 'project-1' },
    );
    expect((await getSite('project-1')).capabilities).toMatchObject({ storesQuestions: false, questionRetentionDays: null });
  });
});

describe('OpenAPI reference for a page-scoped reader', () => {
  it('refuses the raw document and omits the reference from the site shell', async () => {
    await expect(getSiteOpenApi('project-1')).rejects.toMatchObject({ status: 404 });
    const site = await getSite('project-1');
    expect(site.openapi).toBeNull();
    expect(site.nav.some((node) => node.id.startsWith('openapi:'))).toBe(false);
  });

  it('refuses the document to a reader without any effective grant', async () => {
    mocks.resolveViewerAccess.mockResolvedValue(pageReader());
    await expect(getSiteOpenApi('project-1')).rejects.toMatchObject({ status: 404 });
  });

  it('serves the document to site-wide readers', async () => {
    mocks.resolveViewerAccess.mockResolvedValue(siteReader);
    await expect(getSiteOpenApi('project-1')).resolves.toMatchObject({ document: { info: { title: 'Private API' } } });
    const site = await getSite('project-1');
    expect(site.openapi).toMatchObject({ path: 'api-reference' });
    expect(site.nav.some((node) => node.id === 'openapi:hash-1')).toBe(true);
  });
});

describe('site-wide release history for a page-scoped reader', () => {
  it('refuses the changelog and its feed', async () => {
    await expect(getSiteChangelog('project-1')).rejects.toMatchObject({ status: 404 });
    await expect(getSiteChangelogRss('project-1')).rejects.toMatchObject({ status: 404 });
    expect(mocks.deploymentFindMany).not.toHaveBeenCalled();
  });

  it('serves the changelog to site-wide readers', async () => {
    mocks.resolveViewerAccess.mockResolvedValue(siteReader);
    await expect(getSiteChangelog('project-1')).resolves.toEqual([expect.objectContaining({ version: 3, title: 'Add plan' })]);
  });
});

describe('private asset authorization', () => {
  it.each([true, false])('preserves a page-scoped image after rollback (stored index: %s)', async (stored) => {
    const target = {
      id: 'target',
      projectId: 'project-1',
      status: 'READY',
      version: 1,
      snapshot,
      pagesCount: 3,
      assetReferenceIndex: stored ? preparedIndex : null,
      assetReferenceBytes: stored ? preparedIndex.weight : null,
      assetSourceBytes: stored ? null : Buffer.byteLength(JSON.stringify(snapshot)),
      assetSourcePages: stored ? null : snapshot.pages.length,
    };
    mocks.deploymentFindFirst.mockResolvedValueOnce(target);
    mocks.deploymentAggregate.mockResolvedValue({ _max: { version: 3 } });
    const id = `rollback-${stored}-${Math.random()}`;
    mocks.deploymentCreate.mockImplementation(async ({ data }) => ({ id, ...data }));
    const rollback = await rollbackDeployment('org', 'project-1', 'target', 'user');
    expect(mocks.deploymentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        snapshot,
        assetReferenceIndex: target.assetReferenceIndex,
        assetReferenceBytes: target.assetReferenceBytes,
        assetSourceBytes: target.assetSourceBytes,
        assetSourcePages: target.assetSourcePages,
      }),
    });
    // Main activates this copied row in the worker; the private base creates it READY.
    const activated = { ...rollback, status: 'READY' };
    mocks.deploymentFindFirst.mockResolvedValue(activated);
    mocks.deploymentFindUnique.mockResolvedValue(activated);
    await expect(getProjectAssetAccess('project-1', key('child-shot.png'), new Headers())).resolves.toMatchObject({ kind: 'reader' });
    await expect(getProjectAssetAccess('project-1', key('parent-chart.png'), new Headers())).resolves.toBeNull();
  });

  const key = (name: string) => `projects/project-1/assets/${name}`;

  it('allows an asset referenced by a granted page', async () => {
    await expect(getProjectAssetAccess('project-1', key('child-shot.png'), new Headers())).resolves.toMatchObject({ kind: 'reader' });
  });

  it('loads only the stored reference index for asset requests', async () => {
    await expect(getProjectAssetAccess('project-1', key('child-shot.png'), new Headers())).resolves.toMatchObject({ kind: 'reader' });
    expect(mocks.deploymentFindUnique.mock.calls.every(([args]) => args.select.assetReferenceIndex === true && !args.select.snapshot)).toBe(true);
  });

  it('keeps normal legacy deployments readable and refuses oversized legacy bodies until republish', async () => {
    mocks.deploymentFindFirst.mockResolvedValue({
      id: 'legacy-normal',
      version: 1,
      assetReferenceBytes: null,
      assetSourceBytes: 4096,
      assetSourcePages: 3,
    });
    mocks.deploymentFindUnique.mockResolvedValue({ snapshot });
    await expect(getProjectAssetAccess('project-1', key('child-shot.png'), new Headers())).resolves.toMatchObject({ kind: 'reader' });
    invalidatePublishedSiteConfig('project-1');
    mocks.deploymentFindFirst.mockResolvedValue({
      id: 'legacy-large',
      version: 2,
      assetReferenceBytes: null,
      assetSourceBytes: 30_000_000,
      assetSourcePages: 50_000,
    });
    mocks.deploymentFindUnique.mockClear();
    await expect(getProjectAssetAccess('project-1', key('child-shot.png'), new Headers())).resolves.toBeNull();
    expect(mocks.deploymentFindUnique).not.toHaveBeenCalled();
    mocks.resolveViewerAccess.mockResolvedValue(siteReader);
    await expect(getProjectAssetAccess('project-1', key('child-shot.png'), new Headers())).resolves.toMatchObject({ kind: 'reader' });
  });

  it('retries a null chrome stamp without retaining it in either cache', async () => {
    const live = liveChrome({ banner: { message: 'x'.repeat(9 * 1024 * 1024) }, logo: { light: `/api/public/assets/${key('logo.svg')}` } });
    mocks.projectFindUnique.mockResolvedValue(live);
    await expect(getProjectAssetAccess('project-1', key('logo.svg'), new Headers())).resolves.toBeNull();
    live.config = { logo: { light: `/api/public/assets/${key('logo.svg')}` } };
    await expect(getProjectAssetAccess('project-1', key('logo.svg'), new Headers())).resolves.toMatchObject({ kind: 'reader' });
  });

  it('allows a shared site chrome asset', async () => {
    await expect(getProjectAssetAccess('project-1', key('logo.svg'), new Headers())).resolves.toMatchObject({ kind: 'reader' });
  });

  it.each(['seo', 'navbar', 'banner'])('allows localized shared assets in %s', async (field) => {
    const url = '/api/public/assets/projects/project-1/assets/localized.png';
    const config = { seo: { socialImage: url }, navbar: { anchors: [{ label: 'Help', icon: url }] }, banner: { content: `![Banner](${url})` } };
    const live = {
      ...liveChrome(),
      languages: [{ code: 'en', enabled: true, config: { [field]: config[field as keyof typeof config] }, projectTranslations: [] }],
    };
    mocks.projectFindUnique.mockResolvedValue(live);
    await expect(getProjectAssetAccess('project-1', key('localized.png'), new Headers())).resolves.toMatchObject({ kind: 'reader' });
  });

  it('allows assets in the effective add-on configuration', async () => {
    mocks.projectFindUnique.mockResolvedValue({
      ...liveChrome(),
      addons: [
        {
          key: 'edit-suggestions',
          enabled: true,
          config: { urlTemplate: 'https://example.test/api/public/assets/projects/project-1/assets/addon.png' },
        },
      ],
    });
    await expect(getProjectAssetAccess('project-1', key('addon.png'), new Headers())).resolves.toMatchObject({ kind: 'reader' });
  });

  it.each(['%2f', '%2F'])('normalizes encoded asset references: %s', async (slash) => {
    mocks.projectFindUnique.mockResolvedValue(liveChrome({ logo: { light: `/api/public/assets/${key('encoded.png').replaceAll('/', slash)}` } }));
    await expect(getProjectAssetAccess('project-1', key('encoded.png'), new Headers())).resolves.toMatchObject({ kind: 'reader' });
  });

  it('extracts page references once for repeated asset requests and isolates grant sets', async () => {
    const content = vi.fn(() => CHILD_BODY);
    const child = {
      ...page({ id: 'child', parentId: 'parent', path: 'plan/guide', position: 0 }),
      get content() {
        return content();
      },
    };
    mocks.deploymentFindUnique.mockResolvedValue(
      withIndex({
        snapshot: { ...snapshot, pages: [...snapshot.pages.filter((item) => item.id !== 'child'), child] },
      }),
    );
    await getProjectAssetAccess('project-1', key('child-shot.png'), new Headers());
    await getProjectAssetAccess('project-1', key('logo.svg'), new Headers());
    expect(content).toHaveBeenCalledTimes(1);
    expect(mocks.deploymentFindFirst).toHaveBeenCalledTimes(1);
    mocks.resolveViewerAccess.mockResolvedValue(pageReader('child', 'other'));
    await expect(getProjectAssetAccess('project-1', key('child-shot.png'), new Headers())).resolves.toMatchObject({ kind: 'reader' });
    expect(content).toHaveBeenCalledTimes(1);
    mocks.resolveViewerAccess.mockResolvedValue(pageReader('parent'));
    await expect(getProjectAssetAccess('project-1', key('child-shot.png'), new Headers())).resolves.toBeNull();
    await expect(getProjectAssetAccess('project-1', key('parent-chart.png'), new Headers())).resolves.toMatchObject({ kind: 'reader' });
  });

  it('reuses the deployment index across more than one hundred different readers without sharing grants', async () => {
    const content = vi.fn(() => CHILD_BODY);
    const child = {
      ...page({ id: 'child', path: 'guide', position: 0 }),
      get content() {
        return content();
      },
    };
    const others = Array.from({ length: 110 }, (_, index) => page({ id: `other-${index}`, path: `other-${index}`, position: index + 1 }));
    mocks.deploymentFindUnique.mockResolvedValue(withIndex({ snapshot: { ...snapshot, pages: [child, ...others] } }));
    for (const other of others) {
      mocks.resolveViewerAccess.mockResolvedValue(pageReader('child', other.id));
      await expect(getProjectAssetAccess('project-1', key('child-shot.png'), new Headers())).resolves.toMatchObject({ kind: 'reader' });
    }
    mocks.resolveViewerAccess.mockResolvedValue(pageReader('other-0'));
    await expect(getProjectAssetAccess('project-1', key('child-shot.png'), new Headers())).resolves.toBeNull();
    expect(content).toHaveBeenCalledTimes(1);
  });

  it('preserves ancestor navigation images without granting ancestor body images', async () => {
    const pages = snapshot.pages.map((item) =>
      item.id === 'parent' ? { ...item, icon: '/api/public/assets/projects/project-1/assets/parent-icon.png' } : item,
    );
    mocks.deploymentFindUnique.mockResolvedValue(withIndex({ snapshot: { ...snapshot, pages } }));
    await expect(getProjectAssetAccess('project-1', key('parent-icon.png'), new Headers())).resolves.toMatchObject({ kind: 'reader' });
    await expect(getProjectAssetAccess('project-1', key('parent-chart.png'), new Headers())).resolves.toBeNull();
    mocks.resolveViewerAccess.mockResolvedValue(pageReader('other'));
    await expect(getProjectAssetAccess('project-1', key('parent-icon.png'), new Headers())).resolves.toBeNull();
  });

  it('retries a transient deployment lookup failure immediately', async () => {
    mocks.deploymentFindFirst.mockRejectedValueOnce(new Error('temporary database failure'));
    await expect(getProjectAssetAccess('project-1', key('child-shot.png'), new Headers())).resolves.toBeNull();
    await expect(getProjectAssetAccess('project-1', key('child-shot.png'), new Headers())).resolves.toMatchObject({ kind: 'reader' });
    expect(mocks.deploymentFindFirst).toHaveBeenCalledTimes(2);
  });

  it('serves a newly published image immediately on a cached-deployment miss', async () => {
    await getProjectAssetAccess('project-1', key('child-shot.png'), new Headers());
    mocks.deploymentFindFirst.mockImplementation(async () => assetMetadata({ id: 'just-published', version: 4 }));
    mocks.deploymentFindUnique.mockResolvedValue(
      withIndex({
        snapshot: {
          ...snapshot,
          pages: [page({ id: 'child', path: 'guide', position: 0, content: `![New](/api/public/assets/${key('just-published.png')})` })],
        },
      }),
    );
    await expect(getSitePage('project-1', 'guide')).resolves.toMatchObject({ page: { id: 'child' } });
    await expect(getProjectAssetAccess('project-1', key('just-published.png'), new Headers())).resolves.toMatchObject({ kind: 'reader' });
    await expect(getProjectAssetAccess('project-1', key('child-shot.png'), new Headers())).resolves.toBeNull();
  });

  it('does not keep a first publication hidden behind a cached no-deployment result', async () => {
    mocks.deploymentFindFirst.mockImplementationOnce(async () => assetMetadata(null));
    await expect(getProjectAssetAccess('project-1', key('child-shot.png'), new Headers())).resolves.toBeNull();
    await expect(getProjectAssetAccess('project-1', key('child-shot.png'), new Headers())).resolves.toMatchObject({ kind: 'reader' });
  });

  it.each([512, 513])('allows an explicitly granted shared image with %s references on an oversized deployment', async (count) => {
    const large = page({
      id: 'large',
      path: 'large',
      position: 0,
      content: Array.from({ length: 20_001 }, (_, index) => key(`large-${index}.png`)).join(' '),
    });
    const pages = Array.from({ length: count }, (_, index) =>
      page({
        id: `shared-${index}`,
        path: `shared-${index}`,
        position: index + 1,
        content: `![Diagram](/api/public/assets/${key('shared-diagram.png')})`,
      }),
    );
    mocks.deploymentFindUnique.mockResolvedValue(
      withIndex({
        snapshot: { ...snapshot, pages: [large, ...pages, page({ id: 'other', path: 'other', position: count + 1 })] },
      }),
    );
    mocks.resolveViewerAccess.mockResolvedValue(pageReader(`shared-${count - 1}`));
    await expect(getProjectAssetAccess('project-1', key('shared-diagram.png'), new Headers())).resolves.toMatchObject({ kind: 'reader' });
    mocks.resolveViewerAccess.mockResolvedValue(pageReader('other'));
    await expect(getProjectAssetAccess('project-1', key('shared-diagram.png'), new Headers())).resolves.toBeNull();
    mocks.resolveViewerAccess.mockResolvedValue(pageReader(`shared-${count - 1}`));
    await expect(getProjectAssetAccess('project-1', key('shared-diagram.png'), new Headers())).resolves.toMatchObject({ kind: 'reader' });
  });

  it('serves two passes of 33 valid and 129 missing keys from the same extracted page references', async () => {
    const content = vi.fn(() => Array.from({ length: 20_001 }, (_, index) => key(`evict-${index}.png`)).join(' '));
    const child = {
      ...page({ id: 'child', path: 'large', position: 0 }),
      get content() {
        return content();
      },
    };
    mocks.deploymentFindUnique.mockResolvedValue(withIndex({ snapshot: { ...snapshot, pages: [child] } }));
    const serialize = vi.spyOn(JSON, 'stringify');
    try {
      for (let pass = 0; pass < 2; pass++) {
        for (let index = 0; index < 33; index++) {
          await expect(getProjectAssetAccess('project-1', key(`evict-${index}.png`), new Headers())).resolves.toMatchObject({ kind: 'reader' });
        }
        for (let index = 0; index < 129; index++) {
          await expect(getProjectAssetAccess('project-1', key(`missing-${index}.png`), new Headers())).resolves.toBeNull();
        }
        expect(content).toHaveBeenCalledTimes(1);
        expect(
          serialize.mock.calls.filter(([value]) => value && typeof value === 'object' && 'id' in value && value.id === 'project-1'),
        ).toHaveLength(0);
      }
      mocks.resolveViewerAccess.mockResolvedValue(pageReader('other'));
      await expect(getProjectAssetAccess('project-1', key('evict-0.png'), new Headers())).resolves.toBeNull();
      expect(content).toHaveBeenCalledTimes(1);
    } finally {
      serialize.mockRestore();
    }
  });

  it('extracts references from a large page without serializing its body', async () => {
    const large = page({
      id: 'child',
      path: 'large',
      position: 0,
      content: `${'x'.repeat(9 * 1024 * 1024)} ${Array.from({ length: 20_001 }, (_, index) => key(`huge-${index}.png`)).join(' ')}`,
    });
    const serialize = vi.spyOn(JSON, 'stringify');
    mocks.deploymentFindUnique.mockResolvedValue(withIndex({ snapshot: { ...snapshot, pages: [large] } }));
    try {
      await expect(getProjectAssetAccess('project-1', key('huge-20000.png'), new Headers())).resolves.toMatchObject({ kind: 'reader' });
      const serialized = serialize.mock.calls.filter(([value]) => value === large).length;
      expect(serialized).toBe(0);
      await expect(getProjectAssetAccess('project-1', key('huge-19999.png'), new Headers())).resolves.toMatchObject({ kind: 'reader' });
      expect(serialize.mock.calls.filter(([value]) => value === large)).toHaveLength(serialized);
      mocks.resolveViewerAccess.mockResolvedValue(pageReader('other'));
      await expect(getProjectAssetAccess('project-1', key('huge-20000.png'), new Headers())).resolves.toBeNull();
    } finally {
      serialize.mockRestore();
    }
  });

  it('extracts object-key references beyond the old text budget without repeating the raw walk', async () => {
    const body = `${'x'.repeat(9 * 1024 * 1024)} ${Array.from({ length: 20_001 }, (_, index) => key(`object-${index}.png`)).join(' ')}`;
    const content = vi.fn(() => body);
    const child = {
      ...page({ id: 'child', path: 'guide', position: 0, config: { [key('object-key.png')]: 'Metadata' } }),
      get content() {
        return content();
      },
    };
    mocks.deploymentFindUnique.mockResolvedValue(withIndex({ snapshot: { ...snapshot, pages: [child] } }));
    await expect(getProjectAssetAccess('project-1', key('object-key.png'), new Headers())).resolves.toMatchObject({ kind: 'reader' });
    await expect(getProjectAssetAccess('project-1', key('object-key.png'), new Headers())).resolves.toMatchObject({ kind: 'reader' });
    expect(content).toHaveBeenCalledTimes(1);
  });

  it('keeps chrome references keyed by their stable stamp when live rows are reloaded unchanged', async () => {
    const config = vi.fn(() => snapshot.project.config);
    const project = {
      ...snapshot.project,
      get config() {
        return config();
      },
    };
    mocks.deploymentFindUnique.mockResolvedValue(withIndex({ snapshot: { ...snapshot, project } }));
    await expect(getProjectAssetAccess('project-1', key('logo.svg'), new Headers())).resolves.toMatchObject({ kind: 'reader' });
    const reads = config.mock.calls.length;
    expect(reads).toBeGreaterThan(0);
    invalidatePublishedSiteConfig('project-1');
    await expect(getProjectAssetAccess('project-1', key('logo.svg'), new Headers())).resolves.toMatchObject({ kind: 'reader' });
    expect(config).toHaveBeenCalledTimes(reads);
  });

  it('uses compact page positions for oversized ancestor lookups', async () => {
    const pages = Array.from({ length: 1000 }, (_, index) =>
      page({ id: `ancestor-${index}`, parentId: index ? `ancestor-${index - 1}` : null, path: `ancestor-${index}`, position: index }),
    );
    pages[0] = page({
      id: 'ancestor-0',
      path: 'root',
      position: 0,
      icon: `/api/public/assets/${key('root-nav.png')}`,
      content: Array.from({ length: 20_001 }, (_, index) => key(`large-${index}.png`)).join(' '),
    });
    const find = vi.spyOn(pages, 'find');
    mocks.deploymentFindUnique.mockResolvedValue(withIndex({ snapshot: { ...snapshot, pages } }));
    mocks.resolveViewerAccess.mockResolvedValue(pageReader('ancestor-999'));
    await expect(getProjectAssetAccess('project-1', key('root-nav.png'), new Headers())).resolves.toMatchObject({ kind: 'reader' });
    await expect(getProjectAssetAccess('project-1', key('root-nav.png'), new Headers())).resolves.toMatchObject({ kind: 'reader' });
    expect(find).not.toHaveBeenCalled();
  });

  it('retains the reference index across sixty-four small deployments', async () => {
    const content = vi.fn(() => CHILD_BODY);
    const child = {
      ...page({ id: 'child', path: 'guide', position: 0 }),
      get content() {
        return content();
      },
    };
    mocks.deploymentFindUnique.mockResolvedValue(withIndex({ snapshot: { ...snapshot, pages: [child] } }));
    for (let index = 0; index < 64; index++) {
      invalidatePublishedSiteConfig('project-1');
      mocks.deploymentFindFirst.mockImplementation(async () => assetMetadata({ id: `active-deployment-${index}`, version: index }));
      await getProjectAssetAccess('project-1', key('child-shot.png'), new Headers());
    }
    invalidatePublishedSiteConfig('project-1');
    mocks.deploymentFindFirst.mockImplementation(async () => assetMetadata({ id: 'active-deployment-0', version: 0 }));
    await getProjectAssetAccess('project-1', key('child-shot.png'), new Headers());
    expect(content).toHaveBeenCalledTimes(1);
  });

  it('refreshes references after a chrome invalidation', async () => {
    await expect(getProjectAssetAccess('project-1', key('logo.svg'), new Headers())).resolves.toMatchObject({ kind: 'reader' });
    mocks.projectFindUnique.mockResolvedValue(liveChrome({ logo: { light: '/api/public/assets/projects/project-1/assets/replacement.png' } }));
    invalidatePublishedSiteConfig('project-1');
    await expect(getProjectAssetAccess('project-1', key('replacement.png'), new Headers())).resolves.toMatchObject({ kind: 'reader' });
    await expect(getProjectAssetAccess('project-1', key('logo.svg'), new Headers())).resolves.toBeNull();
  });

  it('refreshes the deployment lookup and chrome after fifteen seconds', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      await getProjectAssetAccess('project-1', key('child-shot.png'), new Headers());
      now.mockReturnValue(16_001);
      mocks.deploymentFindFirst.mockImplementation(async () => assetMetadata({ id: 'deployment-new', version: 4 }));
      mocks.deploymentFindUnique.mockResolvedValue(withIndex({ snapshot: { ...snapshot, pages: [] } }));
      mocks.projectFindUnique.mockResolvedValue(liveChrome({ logo: { light: '/api/public/assets/projects/project-1/assets/fresh.png' } }));
      await expect(getProjectAssetAccess('project-1', key('child-shot.png'), new Headers())).resolves.toBeNull();
      await expect(getProjectAssetAccess('project-1', key('fresh.png'), new Headers())).resolves.toMatchObject({ kind: 'reader' });
      expect(mocks.deploymentFindFirst).toHaveBeenCalledTimes(3);
    } finally {
      now.mockRestore();
    }
  });

  it('refuses assets referenced only by ungranted pages, including their metadata', async () => {
    await expect(getProjectAssetAccess('project-1', key('parent-chart.png'), new Headers())).resolves.toBeNull();
    await expect(getProjectAssetAccess('project-1', key('parent-og.png'), new Headers())).resolves.toBeNull();
    await expect(getProjectAssetAccess('project-1', key('unreferenced.pdf'), new Headers())).resolves.toBeNull();
  });

  it('does not match a key that is only a prefix of a referenced key', async () => {
    await expect(getProjectAssetAccess('project-1', key('child-shot'), new Headers())).resolves.toBeNull();
    await expect(getProjectAssetAccess('project-1', key('child-shot.p'), new Headers())).resolves.toBeNull();
  });

  it('refuses every asset when the reader has no effective grant', async () => {
    mocks.resolveViewerAccess.mockResolvedValue(pageReader());
    await expect(getProjectAssetAccess('project-1', key('logo.svg'), new Headers())).resolves.toBeNull();
    await expect(getProjectAssetAccess('project-1', key('child-shot.png'), new Headers())).resolves.toBeNull();
  });

  it('keeps every asset available to site-wide viewers', async () => {
    mocks.resolveViewerAccess.mockResolvedValue(siteReader);
    await expect(getProjectAssetAccess('project-1', key('unreferenced.pdf'), new Headers())).resolves.toEqual(siteReader);
    expect(mocks.deploymentFindFirst).not.toHaveBeenCalled();
  });

  it('refuses a viewer without access and a taken-down project', async () => {
    mocks.resolveViewerAccess.mockResolvedValue(null);
    await expect(getProjectAssetAccess('project-1', key('child-shot.png'), new Headers())).resolves.toBeNull();
    invalidatePublishedSiteConfig('project-1');
    mocks.projectFindUnique.mockResolvedValue({ ...liveChrome(), takedownAt: new Date() });
    mocks.resolveViewerAccess.mockResolvedValue(siteReader);
    await expect(getProjectAssetAccess('project-1', key('child-shot.png'), new Headers())).resolves.toBeNull();
  });

  it('refuses page-scoped access when the site has no live deployment', async () => {
    mocks.deploymentFindFirst.mockImplementation(async () => assetMetadata(null));
    await expect(getProjectAssetAccess('project-1', key('child-shot.png'), new Headers())).resolves.toBeNull();
  });
});
