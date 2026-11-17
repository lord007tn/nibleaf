import { validateSnapshotRedirects } from '@nibleaf/shared/redirects';
import { buildSnapshot, type SiteSnapshot } from '@nibleaf/shared/site';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  page: { findFirst: vi.fn(), findMany: vi.fn() },
  project: { findUnique: vi.fn() },
  language: { findMany: vi.fn() },
  transaction: vi.fn(),
  inTransaction: false,
  parsesUnderLock: 0,
}));
vi.mock('mdast-util-from-markdown', async (original) => {
  const actual = await original<typeof import('mdast-util-from-markdown')>();
  return {
    ...actual,
    fromMarkdown: (...args: Parameters<typeof actual.fromMarkdown>) => {
      if (database.inTransaction) database.parsesUnderLock++;
      return actual.fromMarkdown(...args);
    },
  };
});
vi.mock('@nibleaf/database', () => ({
  Prisma: { JsonNull: null },
  prisma: { page: database.page, project: database.project, language: database.language, $transaction: database.transaction },
}));
vi.mock('./platform-events', () => ({ logFirstContentEdit: vi.fn() }));
// The real size rule, with a cap a test can lower so it needs only a small body.
const sizeCap = vi.hoisted(() => ({ bytes: undefined as number | undefined }));
vi.mock('@nibleaf/shared/page-limits', async (original) => {
  const real = await original<typeof import('@nibleaf/shared/page-limits')>();
  return { ...real, oversizedPageContent: (next: string, stored?: string) => real.oversizedPageContent(next, stored, sizeCap.bytes) };
});
vi.mock('./branches', () => ({
  getDefaultBranch: async () => ({ id: 'main' }),
  assertBranchInProject: async (_projectId: string, id: string) => ({ id }),
}));

import { reorderPages, updatePage } from './pages';

const language = (code: string) => ({
  id: code,
  code,
  label: code,
  direction: 'LTR' as const,
  isDefault: code === 'en',
  enabled: true,
  config: null,
});
const projectFixture = () => ({
  id: 'project',
  name: 'Docs',
  slug: 'docs',
  description: null,
  icon: null,
  config: { theme: 'kept', redirects: [] as { from: string; to: string }[] },
  languages: [language('en'), language('ar')],
  branches: [
    { id: 'main', name: 'main', isDefault: true },
    { id: 'v2', name: 'Version 2', isDefault: false },
  ],
});
const pageFixture = (id: string, path = id, branchId = 'main', languageId = 'en') => ({
  id,
  projectId: 'project',
  branchId,
  languageId,
  parentId: null as string | null,
  slug: path.split('/').at(-1) ?? path,
  path,
  kind: 'PAGE' as 'PAGE' | 'GROUP',
  title: id,
  content: '',
  config: null,
  icon: null,
  description: null,
  translationKey: null,
  position: 0,
  hidden: false,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
});
type Row = ReturnType<typeof pageFixture>;

const seed = (initial: Row[], published = true) => {
  let pages = structuredClone(initial);
  let project = projectFixture();
  let failContent = false;
  const snapshot = (): SiteSnapshot =>
    buildSnapshot(
      project,
      pages.map((page) => ({
        ...page,
        languageCode: page.languageId,
        updatedAt: page.updatedAt.toISOString(),
        createdAt: page.createdAt.toISOString(),
      })),
      '2026-01-01T00:00:00Z',
    );
  let live = published ? snapshot() : null;
  const matches = (page: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => {
      if (key === 'id' && value && typeof value === 'object') {
        if ('not' in value) return page.id !== value.not;
        if ('in' in value) return (value.in as string[]).includes(page.id);
      }
      return page[key as keyof Row] === value;
    });
  const findFirst = async ({ where }: { where: Record<string, unknown> }) => pages.find((page) => matches(page, where)) ?? null;
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    $executeRaw: vi.fn().mockImplementation(async (_query, serialized: string) => {
      if (failContent) throw new Error('content write failed');
      const patches = JSON.parse(serialized) as { id: string; content: string; updatedAt: string }[];
      for (const patch of patches) {
        const index = pages.findIndex((page) => page.id === patch.id);
        const page = pages[index];
        if (!page) throw new Error('Missing patch fixture');
        pages[index] = { ...page, content: patch.content, updatedAt: new Date(patch.updatedAt) };
      }
      return patches.length;
    }),
    page: {
      findFirst,
      findFirstOrThrow: findFirst,
      findMany: vi
        .fn()
        .mockImplementation(async ({ where, include } = {}) =>
          pages
            .filter((page) => !where || matches(page, where))
            .map((page) => ({ ...page, ...(include ? { language: language(page.languageId) } : {}) })),
        ),
      update: vi.fn().mockImplementation(async ({ where, data }) => {
        if (failContent && data.content) throw new Error('content write failed');
        const index = pages.findIndex((page) => page.id === where.id);
        const current = pages[index];
        if (!current || (where.updatedAt && current.updatedAt.getTime() !== where.updatedAt.getTime()))
          throw Object.assign(new Error('Revision mismatch'), { code: 'P2025' });
        pages[index] = { ...current, ...data, updatedAt: new Date(current.updatedAt.getTime() + 1) };
        return pages[index];
      }),
      updateMany: vi.fn().mockImplementation(async ({ where, data }) => {
        pages = pages.map((page) => (matches(page, where) ? { ...page, ...data } : page));
        return { count: 1 };
      }),
    },
    project: {
      findUnique: vi.fn().mockImplementation(async () => structuredClone(project)),
      update: vi.fn().mockImplementation(async ({ data }) => {
        project = { ...project, ...data };
        return project;
      }),
    },
    language: { findMany: vi.fn().mockResolvedValue([language('en'), language('ar')]) },
    deployment: { findFirst: vi.fn().mockImplementation(async () => (live ? { snapshot: structuredClone(live) } : null)) },
  };
  database.project.findUnique.mockImplementation(tx.project.findUnique);
  database.language.findMany.mockImplementation(tx.language.findMany);
  database.page.findFirst.mockImplementation(findFirst);
  database.page.findMany.mockImplementation(tx.page.findMany);
  database.transaction.mockImplementation(async (work) => {
    const previous = structuredClone({ pages, project });
    try {
      database.inTransaction = true;
      return await work(tx);
    } catch (error) {
      ({ pages, project } = previous);
      throw error;
    } finally {
      database.inTransaction = false;
    }
  });
  return {
    tx,
    snapshot,
    pages: () => pages,
    config: () => project.config,
    publish: () => {
      live = snapshot();
    },
    setLive: (value: SiteSnapshot) => {
      live = value;
    },
    failContent: () => {
      failContent = true;
    },
  };
};

describe('page address preservation through page actions', () => {
  it('council: stale REST autosave cannot undo a rename link rewrite', async () => {
    const state = seed([pageFixture('target', 'old'), { ...pageFixture('source'), content: '[link](/old)' }]);
    const base = state.pages()[1]?.updatedAt.toISOString();
    await updatePage('project', 'target', { slug: 'new' });
    await expect(updatePage('project', 'source', { content: '[link](/old)\nMy unsaved text', expectedUpdatedAt: base })).rejects.toMatchObject({
      status: 409,
      code: 'page:revision_conflict',
    });
    expect(state.pages()[1]?.content).toBe('[link](/new)');
    await updatePage('project', 'source', { content: 'Legacy caller without precondition' });
    expect(state.pages()[1]?.content).toBe('Legacy caller without precondition');
  });

  it('council: conflicting locale destinations roll back instead of letting the last language win', async () => {
    const initial = [
      pageFixture('english', 'old'),
      pageFixture('arabic', 'old', 'main', 'ar'),
      pageFixture('en-parent', 'en-parent'),
      pageFixture('ar-parent', 'ar-parent', 'main', 'ar'),
    ];
    const state = seed(initial);
    await expect(
      reorderPages('project', {
        items: [
          { id: 'english', parentId: 'en-parent', position: 0 },
          { id: 'arabic', parentId: 'ar-parent', position: 0 },
        ],
      }),
    ).rejects.toMatchObject({ code: 'page:address_conflict', details: { reason: 'locale_redirect_conflict', from: '/old' } });
    expect(state.pages()).toEqual(initial);
  });

  it('council: a user redirect is never replaced by a generated redirect', async () => {
    const state = seed([pageFixture('target', 'old')]);
    state.config().redirects.push({ from: '/old', to: 'https://example.com/custom' });
    await expect(updatePage('project', 'target', { slug: 'new' })).rejects.toMatchObject({
      code: 'page:address_conflict',
      details: { reason: 'user_redirect_conflict', from: '/old', to: 'https://example.com/custom' },
    });
    expect(state.pages()[0]?.path).toBe('old');
    expect(state.config().redirects[0]?.to).toBe('https://example.com/custom');
  });

  it('council: sequential language moves cannot redirect both published locales to the last destination', async () => {
    const state = seed([
      pageFixture('english', 'old'),
      pageFixture('arabic', 'old', 'main', 'ar'),
      pageFixture('en-parent', 'en-parent'),
      pageFixture('ar-parent', 'ar-parent', 'main', 'ar'),
    ]);
    await reorderPages('project', { items: [{ id: 'english', parentId: 'en-parent', position: 0 }] });
    await expect(reorderPages('project', { items: [{ id: 'arabic', parentId: 'ar-parent', position: 0 }] })).rejects.toMatchObject({
      code: 'page:address_conflict',
      details: { reason: 'locale_redirect_conflict', from: '/old' },
    });
    expect(state.pages().find((page) => page.id === 'arabic')?.path).toBe('old');
  });

  it('council: generated provenance survives validation and a sequential slug swap', async () => {
    const state = seed([pageFixture('target', 'a')]);
    await updatePage('project', 'target', { slug: 'b' });
    expect(state.config().redirects[0]).toMatchObject({ from: '/a', to: '/b', generated: true });
    state.publish();
    await updatePage('project', 'target', { slug: 'a' });
    expect(state.config().redirects).toEqual([{ from: '/b', to: '/a', generated: true }]);
    expect(validateSnapshotRedirects(state.snapshot()).issues).toEqual([]);
  });

  it('council: relative and reference destinations resolve against a moving source old address', async () => {
    const state = seed([
      pageFixture('parent', 'old'),
      {
        ...pageFixture('source', 'old/source'),
        parentId: 'parent',
        content: '[inline](target?x=1#part) [reference][dest]\n\n[dest]: target#section',
      },
      { ...pageFixture('target', 'old/target'), parentId: 'parent' },
    ]);
    const result = await updatePage('project', 'parent', { slug: 'new' });
    expect(result.linksUpdated).toBe(2);
    expect(state.pages()[1]?.content).toBe('[inline](/new/target?x=1#part) [reference][dest]\n\n[dest]: /new/target#section');
  });

  it('council: redirect validation returns structured issues for a localized remedy', async () => {
    const state = seed([pageFixture('target', 'old')]);
    state.config().redirects.push(...Array.from({ length: 100 }, (_, index) => ({ from: `/legacy-${index}`, to: '/old' })));
    await expect(updatePage('project', 'target', { slug: 'new' })).rejects.toMatchObject({
      code: 'page:redirect_invalid',
      details: { issues: expect.arrayContaining([expect.objectContaining({ code: 'too-many-rules' })]) },
    });
  });

  it('council: document parsing never runs under the structural transaction lock', async () => {
    const state = seed([pageFixture('target', 'old'), { ...pageFixture('source'), content: '[link](/old)' }]);
    await updatePage('project', 'target', { slug: 'new' });
    expect(database.parsesUnderLock).toBe(0);
    expect(state.tx.$executeRaw).toHaveBeenCalledOnce();
  });

  it('council: a document changed after preparation aborts safely instead of applying stale patches', async () => {
    const state = seed([pageFixture('target', 'old'), { ...pageFixture('source'), content: '[link](/old)' }]);
    const transaction = database.transaction.getMockImplementation();
    database.transaction.mockImplementationOnce(async (work) => {
      const source = state.pages()[1];
      if (!source || !transaction) throw new Error('Missing fixture');
      source.content += '\nConcurrent edit';
      source.updatedAt = new Date(source.updatedAt.getTime() + 1);
      return transaction(work);
    });
    await expect(updatePage('project', 'target', { slug: 'new' })).rejects.toMatchObject({
      code: 'page:address_conflict',
      details: { reason: 'address_raced' },
    });
    expect(state.pages()[0]?.path).toBe('old');
    expect(state.pages()[1]?.content).toContain('Concurrent edit');
  });

  it('council: failed MDX documents are counted and left untouched', async () => {
    const content = '[link](/old)\n\n{not valid javascript';
    const state = seed([pageFixture('target', 'old'), { ...pageFixture('source'), content }]);
    expect(await updatePage('project', 'target', { slug: 'new' })).toMatchObject({ documentsSkipped: 1, linksUpdated: 0 });
    expect(state.pages()[1]?.content).toBe(content);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    sizeCap.bytes = undefined;
    database.inTransaction = false;
    database.parsesUnderLock = 0;
  });

  it('redirects a live slug, rewrites query/anchor links, and preserves code and external URLs', async () => {
    const source =
      '[plain](/getting-started) [anchor](/getting-started#install) [query](/getting-started?x=1) [outside](https://example.com/getting-started)\n\n`[inline](/getting-started)`\n\n```md\n[code](/getting-started)\n```\n\n    [indented](/getting-started)';
    const state = seed([pageFixture('target', 'getting-started'), { ...pageFixture('config'), content: source }]);
    const result = await updatePage('project', 'target', { slug: 'quickstart' });
    expect(result).toMatchObject({ path: 'quickstart', redirectsAdded: 1, linksUpdated: 3 });
    expect(state.config()).toEqual({ theme: 'kept', redirects: [{ from: '/getting-started', to: '/quickstart', generated: true }] });
    expect(state.pages()[1]?.content).toBe(
      source
        .replace('[plain](/getting-started)', '[plain](/quickstart)')
        .replace('[anchor](/getting-started#install)', '[anchor](/quickstart#install)')
        .replace('[query](/getting-started?x=1)', '[query](/quickstart?x=1)'),
    );
    expect(state.tx.deployment.findFirst).toHaveBeenCalledWith({ where: { projectId: 'project', status: 'READY' }, orderBy: { version: 'desc' } });
    expect(validateSnapshotRedirects(state.snapshot()).issues).toEqual([]);
  });

  it('skips and reports a linking page whose rewritten links would cross the size cap, and still renames', async () => {
    // The real rule at a 64 KiB cap: the same behaviour as at 2 MiB, with a small body.
    const cap = 64 * 1024;
    sizeCap.bytes = cap;
    const links = '[x](/a) '.repeat(10);
    // Exactly at the cap: each rewritten link adds 18 bytes and would cross it.
    const atCap = `${links}\n\n${'y'.repeat(cap - links.length - 2)}`;
    const state = seed(
      [pageFixture('target', 'a'), { ...pageFixture('big'), content: atCap }, { ...pageFixture('small'), content: '[x](/a)' }],
      false,
    );
    expect(await updatePage('project', 'target', { slug: 'much-longer-address' })).toMatchObject({
      path: 'much-longer-address',
      linksUpdated: 1,
      documentsSkipped: 1,
    });
    expect(state.pages().find((page) => page.id === 'big')?.content).toBe(atCap);
    expect(state.pages().find((page) => page.id === 'small')?.content).toBe('[x](/much-longer-address)');
  });

  it('relinks an unpublished page without creating a redirect', async () => {
    const state = seed([pageFixture('target', 'old'), { ...pageFixture('source'), content: '[draft](/old)' }], false);
    expect(await updatePage('project', 'target', { slug: 'new' })).toMatchObject({ redirectsAdded: 0, linksUpdated: 1 });
    expect(state.config().redirects.map(({ from, to }) => ({ from, to }))).toEqual([]);
    expect(state.pages()[1]?.content).toBe('[draft](/new)');
  });

  it('does not consider a path live when only another branch, language, or prior path was published', async () => {
    const state = seed([pageFixture('target', 'draft')]);
    const live = state.snapshot();
    const page = live.pages[0];
    if (!page) throw new Error('Published fixture is missing its page');
    live.pages = [
      { ...page, path: 'draft', versionId: 'v2' },
      { ...page, path: 'draft', languageCode: 'ar' },
      { ...page, path: 'former' },
    ];
    state.setLive(live);
    expect(await updatePage('project', 'target', { slug: 'new' })).toMatchObject({ redirectsAdded: 0 });
    expect(state.config().redirects.map(({ from, to }) => ({ from, to }))).toEqual([]);
  });

  it('redirects descendants when a parent address changes', async () => {
    const state = seed([pageFixture('parent', 'old'), { ...pageFixture('child', 'old/child'), parentId: 'parent' }]);
    expect(await updatePage('project', 'parent', { slug: 'new' })).toMatchObject({ redirectsAdded: 2 });
    expect(state.config().redirects.map(({ from, to }) => ({ from, to }))).toEqual([
      { from: '/old', to: '/new' },
      { from: '/old/child', to: '/new/child' },
    ]);
  });

  it.each(['bulk', 'anchored'] as const)('preserves addresses for a subtree reparented by %s reorder', async (mode) => {
    const state = seed([
      pageFixture('parent'),
      pageFixture('target'),
      { ...pageFixture('child', 'target/child'), parentId: 'target' },
      { ...pageFixture('source'), content: '[child](/target/child#help)' },
    ]);
    await reorderPages(
      'project',
      mode === 'bulk'
        ? { items: [{ id: 'target', parentId: 'parent', position: 0 }] }
        : { pageId: 'target', parentId: 'parent', position: { at: 'end' } },
    );
    expect(state.config().redirects.map(({ from, to }) => ({ from, to }))).toEqual([
      { from: '/target', to: '/parent/target' },
      { from: '/target/child', to: '/parent/target/child' },
    ]);
    expect(state.pages().at(-1)?.content).toBe('[child](/parent/target/child#help)');
  });

  it('uses the original language when a move changes both language and path', async () => {
    const state = seed([
      pageFixture('target', 'old'),
      pageFixture('group', 'group', 'main', 'ar'),
      { ...pageFixture('source'), content: '[guide](/old?x=1#help)' },
    ]);
    await reorderPages('project', { items: [{ id: 'target', parentId: 'group', languageId: 'ar', position: 0 }] });
    expect(state.config().redirects.map(({ from, to }) => ({ from, to }))).toEqual([{ from: '/old', to: '/group/old?lang=ar' }]);
    expect(state.pages().at(-1)?.content).toBe('[guide](/group/old?x=1&lang=ar#help)');
    expect(validateSnapshotRedirects(state.snapshot()).issues).toEqual([]);
  });

  it('skips redirects for addresses another page takes during a swap', async () => {
    const state = seed([
      pageFixture('left'),
      pageFixture('right'),
      { ...pageFixture('one', 'left/intro'), parentId: 'left' },
      { ...pageFixture('two', 'right/intro'), parentId: 'right' },
    ]);
    await reorderPages('project', {
      items: [
        { id: 'one', parentId: 'right', position: 0 },
        { id: 'two', parentId: 'left', position: 0 },
      ],
    });
    expect(state.config().redirects.map(({ from, to }) => ({ from, to }))).toEqual([]);
  });

  it('flattens published chains, retargets unpublished intermediate paths, and avoids loops on return', async () => {
    const state = seed([pageFixture('target', 'a')]);
    await updatePage('project', 'target', { slug: 'b' });
    state.publish();
    await updatePage('project', 'target', { slug: 'c' });
    expect(state.config().redirects.map(({ from, to }) => ({ from, to }))).toEqual([
      { from: '/a', to: '/c' },
      { from: '/b', to: '/c' },
    ]);
    await updatePage('project', 'target', { slug: 'd' });
    expect(state.config().redirects.map(({ from, to }) => ({ from, to }))).toEqual([
      { from: '/a', to: '/d' },
      { from: '/b', to: '/d' },
    ]);
    await updatePage('project', 'target', { slug: 'a' });
    expect(state.config().redirects.map(({ from, to }) => ({ from, to }))).toEqual([{ from: '/b', to: '/a' }]);
    expect(validateSnapshotRedirects(state.snapshot()).issues).toEqual([]);
  });

  it('skips sources another language still owns while rewriting only matching-language links', async () => {
    const state = seed([
      pageFixture('target', 'old', 'main', 'ar'),
      pageFixture('english', 'old'),
      {
        ...pageFixture('source', 'source', 'main', 'ar'),
        content: '[local](/old) [explicit](/old?lang=ar#x) [prefixed](/ar/old) [english](/old?lang=en)',
      },
    ]);
    const result = await updatePage('project', 'target', { slug: 'new' });
    expect(result).toMatchObject({ redirectsAdded: 0, linksUpdated: 3 });
    expect(state.pages().at(-1)?.content).toBe('[local](/new) [explicit](/new?lang=ar#x) [prefixed](/ar/new) [english](/old?lang=en)');
  });

  it('uses the reader version slug and language query and leaves other branches untouched', async () => {
    const state = seed([
      pageFixture('target', 'old', 'v2', 'ar'),
      { ...pageFixture('source', 'source', 'v2', 'ar'), content: '[local](/old) [version](/version-2/old?lang=ar)' },
      { ...pageFixture('other'), content: '[other](/old)' },
    ]);
    await updatePage('project', 'target', { slug: 'new' });
    expect(state.config().redirects.map(({ from, to }) => ({ from, to }))).toEqual([{ from: '/version-2/old', to: '/version-2/new?lang=ar' }]);
    expect(state.pages()[1]?.content).toBe('[local](/new) [version](/version-2/new?lang=ar)');
    expect(state.pages()[2]?.content).toBe('[other](/old)');
    expect(validateSnapshotRedirects(state.snapshot()).issues).toEqual([]);
  });

  it('rolls back paths and config if a link rewrite fails', async () => {
    const initial = [pageFixture('target', 'old'), { ...pageFixture('source'), content: '[link](/old)' }];
    const state = seed(initial);
    state.failContent();
    await expect(updatePage('project', 'target', { slug: 'new' })).rejects.toThrow('content write failed');
    expect(state.pages()).toEqual(initial);
    expect(state.config().redirects.map(({ from, to }) => ({ from, to }))).toEqual([]);
  });

  it('keeps the redirect limit and rolls back when adding a rule would exceed it', async () => {
    const state = seed([pageFixture('target', 'old')]);
    state.config().redirects.push(...Array.from({ length: 100 }, (_, index) => ({ from: `/legacy-${index}`, to: '/old' })));
    await expect(updatePage('project', 'target', { slug: 'new' })).rejects.toThrow('limit is 100');
    expect(state.pages()[0]?.path).toBe('old');
    expect(state.config().redirects).toHaveLength(100);
  });
});
