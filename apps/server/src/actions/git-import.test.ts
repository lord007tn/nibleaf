import { slugifyUnicode } from '@nibleaf/shared/utils';
import { updatePageBody } from '@nibleaf/validators';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

type Row = {
  id: string;
  parentId: string | null;
  kind: 'PAGE' | 'GROUP';
  slug: string;
  title: string;
  content: string;
  config: unknown;
  updatedAt?: Date;
};
type Source = { pageId: string; projectId: string; branchId: string; languageId: string; path: string };

const mocks = vi.hoisted(() => ({
  prisma: {
    organization: { findUnique: vi.fn(), update: vi.fn() },
    page: { findMany: vi.fn(), update: vi.fn() },
    pageGitImportSource: { create: vi.fn(), delete: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  },
  files: new Map<string, string>(),
  failingPath: null as string | null,
  rows: [] as Row[],
  sources: [] as Source[],
  ids: 0,
}));

vi.mock('@nibleaf/database', () => ({ prisma: mocks.prisma }));
vi.mock('./project-settings-storage', () => ({
  readProjectGitSettings: async () => ({ provider: 'github', repo: 'acme/docs', branch: 'main', path: 'docs' }),
  writeProjectSettings: vi.fn(async () => undefined),
}));
vi.mock('./projects', () => ({ assertProjectInOrg: vi.fn() }));
vi.mock('./branches', () => ({ assertBranchInProject: vi.fn(), getDefaultBranch: vi.fn(async () => ({ id: 'branch-1' })) }));
vi.mock('./languages', () => ({ assertLanguageInProject: vi.fn(), getDefaultLanguage: vi.fn(async () => ({ id: 'language-1' })) }));
vi.mock('./importers/github', () => ({
  listGitHubFiles: vi.fn(async () => [...mocks.files.keys()].map((path) => ({ path, type: 'blob' as const }))),
  getGitHubTextFile: vi.fn(async (_owner: string, _repo: string, _branch: string, path: string) => {
    if (path === mocks.failingPath) throw new Error('GitHub API 502');
    return mocks.files.get(path) ?? null;
  }),
}));
// Groups: find by slug or create, like the real persistence helper.
vi.mock('./importers/persistence', () => ({
  ensureGroupPage: vi.fn(async (_target: unknown, group: { parentId: string | null; slug: string; title: string }) => {
    const found = mocks.rows.find((row) => row.kind === 'GROUP' && row.parentId === group.parentId && row.slug === group.slug);
    if (found) return found.id;
    const id = `group-${mocks.rows.length + 1}`;
    mocks.rows.push({ id, parentId: group.parentId, kind: 'GROUP', slug: group.slug, title: group.title, content: '', config: null });
    return id;
  }),
}));
// createPage's sibling-unique slug allocation, over pages and groups alike.
vi.mock('./pages', () => ({
  createPage: vi.fn(async (_projectId: string, body: { parentId: string | null; slug: string; title: string; content: string; config?: unknown }) => {
    const base = slugifyUnicode(body.slug) || 'page';
    let slug = base;
    for (let suffix = 2; mocks.rows.some((row) => row.parentId === body.parentId && row.slug === slug); suffix++) slug = `${base}-${suffix}`;
    const row: Row = {
      id: `page-${++mocks.ids}`,
      parentId: body.parentId,
      kind: 'PAGE',
      slug,
      title: body.title,
      content: body.content,
      config: body.config ?? null,
      updatedAt: new Date(Date.UTC(2026, 10, 7, 0, 0, mocks.ids)),
    };
    mocks.rows.push(row);
    return { ...row };
  }),
}));

import { importFromGitProvider, normalizeGitContentPath } from './git-import';
import { createPage } from './pages';

const page = (slug: string, parentId: string | null = null) =>
  mocks.rows.find((row) => row.kind === 'PAGE' && row.slug === slug && row.parentId === parentId);
const pageOf = (path: string) => {
  const source = mocks.sources.find((row) => row.path === path);
  return source ? mocks.rows.find((row) => row.id === source.pageId) : undefined;
};
/** Page.parent-style cascade: deleting a page deletes its source row. */
const deletePage = (id: string) => {
  mocks.rows = mocks.rows.filter((row) => row.id !== id);
  mocks.sources = mocks.sources.filter((row) => row.pageId !== id);
};
const runImport = () => importFromGitProvider('org-1', 'project-1');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.files.clear();
  mocks.failingPath = null;
  mocks.rows = [];
  mocks.sources = [];
  mocks.ids = 0;
  mocks.prisma.organization.findUnique.mockResolvedValue({
    metadata: JSON.stringify({ git: { provider: 'github', repo: 'acme/docs', branch: 'main', path: 'docs' } }),
  });
  mocks.prisma.organization.update.mockResolvedValue({});
  mocks.prisma.page.findMany.mockImplementation(async ({ where }: { where: { id?: { in: string[] } } }) =>
    mocks.rows.filter((row) => !where.id || where.id.in.includes(row.id)).map((row) => ({ ...row })),
  );
  mocks.prisma.page.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
    const row = mocks.rows.find((candidate) => candidate.id === where.id);
    if (!row) throw new Error('Record to update not found.');
    Object.assign(row, data, { updatedAt: new Date((row.updatedAt?.getTime() ?? 0) + 1) });
    return row;
  });
  // Every fake page lives in the import's branch/language, so the lookup
  // through the page relation returns every row, whatever its stored scope.
  mocks.prisma.pageGitImportSource.findMany.mockImplementation(async () => mocks.sources.map((row) => ({ ...row })));
  mocks.prisma.pageGitImportSource.update.mockImplementation(async ({ where, data }: { where: { pageId: string }; data: Partial<Source> }) => {
    const row = mocks.sources.find((candidate) => candidate.pageId === where.pageId);
    if (!row) throw new Error('Record to update not found.');
    const next = { ...row, ...data };
    const clash = mocks.sources.some(
      (other) => other !== row && other.path === next.path && other.branchId === next.branchId && other.languageId === next.languageId,
    );
    if (clash) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    Object.assign(row, data);
    return row;
  });
  mocks.prisma.pageGitImportSource.delete.mockImplementation(async ({ where }: { where: { pageId: string } }) => {
    mocks.sources = mocks.sources.filter((row) => row.pageId !== where.pageId);
  });
  Object.assign(mocks.prisma.page, {
    deleteMany: vi.fn(async ({ where }: { where: { id: string } }) => deletePage(where.id)),
    // Field equality on whatever the fake row stores, plus "no child pages".
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> & { id: string } }) => {
      const row = mocks.rows.find((candidate) => candidate.id === where.id) as Record<string, unknown> | undefined;
      if (!row) return null;
      const fieldsMatch = Object.entries(where).every(([key, value]) => {
        if (['projectId', 'children', 'comments', 'audienceGrants', 'gitImportSource'].includes(key) || value === undefined) return true;
        const stored = row[key];
        return value instanceof Date ? stored instanceof Date && stored.getTime() === value.getTime() : stored === value;
      });
      const childless = !mocks.rows.some((candidate) => candidate.parentId === where.id);
      // Only a query that asks for "no identity row" excludes a claimed page.
      const unclaimed =
        (where.gitImportSource as { is?: unknown } | undefined)?.is !== null || !mocks.sources.some((source) => source.pageId === where.id);
      return fieldsMatch && childless && unclaimed ? { id: where.id } : null;
    }),
  });
  Object.assign(mocks.prisma, {
    $queryRaw: vi.fn(async () => []),
    $executeRaw: vi.fn(async () => 0),
    $transaction: vi.fn(async (run: (tx: typeof mocks.prisma) => Promise<unknown>) => run(mocks.prisma)),
  });
  // Same constraints as the table: pageId is the key, (scope, path) is unique.
  mocks.prisma.pageGitImportSource.create.mockImplementation(async ({ data }: { data: Source }) => {
    const taken = mocks.sources.some(
      (row) => row.pageId === data.pageId || (row.path === data.path && row.branchId === data.branchId && row.languageId === data.languageId),
    );
    if (taken) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    mocks.sources.push({ ...data });
    return data;
  });
});

describe('normalizeGitContentPath', () => {
  it('normalizes a repository-relative path', () => {
    expect(normalizeGitContentPath(' docs\\guides/ ')).toBe('docs/guides');
    expect(normalizeGitContentPath()).toBe('');
  });

  it.each(['../../etc', 'docs/../private', '/etc', 'C:\\Windows'])('rejects an escaping path: %s', (value) => {
    expect(() => normalizeGitContentPath(value)).toThrow('Git content path must stay inside the repository.');
  });
});

describe('importFromGitProvider', () => {
  it('imports two Arabic files as two pages with readable slugs and maps them to the same pages on re-import', async () => {
    mocks.files.set('docs/البدء.md', '# البدء\n\nابدأ هنا');
    mocks.files.set('docs/النشر.md', '# النشر\n\nانشر موقعك');

    await expect(runImport()).resolves.toMatchObject({ imported: 2, updated: 0 });
    expect(mocks.rows.map((row) => row.slug).sort()).toEqual(['البدء', 'النشر']);
    expect(pageOf('docs/النشر.md')?.slug).toBe('النشر');

    mocks.files.set('docs/النشر.md', '# النشر\n\nنسخة محدثة');
    await expect(runImport()).resolves.toMatchObject({ imported: 0, updated: 2 });
    expect(mocks.rows).toHaveLength(2);
    expect(page('البدء')?.content).toContain('ابدأ هنا');
    expect(page('النشر')?.content).toContain('نسخة محدثة');
  });

  it('keeps the source out of page settings, so settings saves and tree renames cannot touch it', async () => {
    mocks.files.set('docs/intro.md', '# Intro\n\nHello');
    await runImport();
    const imported = pageOf('docs/intro.md');
    expect(imported?.config).toBeNull();
    expect(JSON.stringify(mocks.rows)).not.toContain('docs/intro.md');
    for (const call of mocks.prisma.page.update.mock.calls) expect(call[0].data).not.toHaveProperty('config');

    // Sidebar-title save, then a tree rename built from the stored config: both validate.
    const sidebar = { config: { ...((imported?.config as object | null) ?? {}), sidebarTitle: 'Start' } };
    expect(updatePageBody.safeParse(sidebar).success).toBe(true);
    if (imported) imported.config = sidebar.config;
    expect(updatePageBody.safeParse({ title: 'Introduction', config: { ...(imported?.config as object), sidebarTitle: 'Start' } }).success).toBe(
      true,
    );

    // Page settings clear every override (`config: null`): the identity stays.
    if (imported) imported.config = null;
    mocks.rows.push({ id: 'page-legacy', parentId: null, kind: 'PAGE', slug: 'intro-2', title: 'x', content: 'x', config: null });
    mocks.files.set('docs/intro.md', '# Intro\n\nHello again');
    await expect(runImport()).resolves.toMatchObject({ imported: 0, updated: 1 });
    expect(pageOf('docs/intro.md')).toMatchObject({ id: imported?.id, content: expect.stringContaining('Hello again') });
  });

  it('releases the source with its page, so a re-import recreates the deleted page', async () => {
    mocks.files.set('docs/intro.md', 'A');
    await runImport();
    const id = pageOf('docs/intro.md')?.id as string;
    deletePage(id);

    await expect(runImport()).resolves.toMatchObject({ imported: 1, updated: 0 });
    expect(pageOf('docs/intro.md')?.id).not.toBe(id);
    expect(mocks.sources).toHaveLength(1);
  });

  it('keeps every file on its own page when look-alike siblings are added and removed', async () => {
    mocks.files.set('docs/Intro.md', 'A');
    mocks.files.set('docs/intro.md', 'B');
    await runImport();
    const idA = pageOf('docs/Intro.md')?.id;
    const idB = pageOf('docs/intro.md')?.id;
    expect(new Set([idA, idB]).size).toBe(2);

    // New look-alikes that would renumber positional suffixes.
    mocks.files.set('docs/intro-2.md', 'C');
    mocks.files.set('docs/INTRO.md', 'D');
    await expect(runImport()).resolves.toMatchObject({ imported: 2, updated: 2 });
    expect(pageOf('docs/Intro.md')).toMatchObject({ id: idA, content: 'A' });
    expect(pageOf('docs/intro.md')).toMatchObject({ id: idB, content: 'B' });
    expect(pageOf('docs/intro-2.md')?.content).toBe('C');
    expect(pageOf('docs/INTRO.md')?.content).toBe('D');

    // Removing the file that held the plain slug must not hand its page to another file.
    mocks.files.delete('docs/Intro.md');
    mocks.files.set('docs/intro.md', 'B2');
    await expect(runImport()).resolves.toMatchObject({ imported: 0, updated: 3 });
    expect(pageOf('docs/intro.md')).toMatchObject({ id: idB, content: 'B2' });
    expect(mocks.rows.find((row) => row.id === idA)?.content).toBe('A');
    expect(mocks.rows.filter((row) => row.kind === 'PAGE')).toHaveLength(4);
  });

  it('leaves a shared legacy page with the file whose text it holds', async () => {
    // The old importer wrote Intro.md then intro.md onto one `intro` page.
    mocks.rows.push({ id: 'page-legacy', parentId: null, kind: 'PAGE', slug: 'intro', title: 'Intro', content: 'B', config: null });
    mocks.files.set('docs/Intro.md', 'A');
    mocks.files.set('docs/intro.md', 'B');

    await expect(runImport()).resolves.toMatchObject({ imported: 1, updated: 1 });
    expect(pageOf('docs/intro.md')?.id).toBe('page-legacy');
    expect(pageOf('docs/Intro.md')).toMatchObject({ slug: 'intro-2', content: 'A' });
  });

  it('does not duplicate a page whose name matches a folder group created before it', async () => {
    mocks.files.set('docs/guide/setup.md', 'Setup');
    await runImport();
    mocks.files.set('docs/guide.md', 'Guide');
    await expect(runImport()).resolves.toMatchObject({ imported: 1, updated: 1 });
    await expect(runImport()).resolves.toMatchObject({ imported: 0, updated: 2 });
    expect(mocks.rows.filter((row) => row.kind === 'PAGE' && row.parentId === null)).toEqual([
      expect.objectContaining({ slug: 'guide-2', content: 'Guide' }),
    ]);
  });

  it('adopts a page an older import left at `-2` beside a same-named group, once', async () => {
    mocks.rows.push({ id: 'group-legacy', parentId: null, kind: 'GROUP', slug: 'guide', title: 'Guide', content: '', config: null });
    mocks.rows.push({ id: 'page-legacy', parentId: null, kind: 'PAGE', slug: 'guide-2', title: 'Guide', content: 'old', config: null });
    mocks.files.set('docs/guide.md', 'new');

    await expect(runImport()).resolves.toMatchObject({ imported: 0, updated: 1 });
    await expect(runImport()).resolves.toMatchObject({ imported: 0, updated: 1 });
    expect(mocks.rows.find((row) => row.id === 'page-legacy')?.content).toBe('new');
    expect(mocks.sources).toEqual([expect.objectContaining({ pageId: 'page-legacy', path: 'docs/guide.md' })]);
    expect(createPage).not.toHaveBeenCalled();
  });

  it('keeps updating a page imported under its older ASCII-only slug, and keeps its config', async () => {
    mocks.rows.push({
      id: 'page-legacy',
      parentId: null,
      kind: 'PAGE',
      slug: 'caf',
      title: 'Café',
      content: 'old',
      config: { sidebarTitle: 'Café' },
    });
    mocks.files.set('docs/café.md', '# Café\n\nnew');

    await expect(runImport()).resolves.toMatchObject({ imported: 0, updated: 1 });
    expect(mocks.rows).toEqual([
      expect.objectContaining({ id: 'page-legacy', slug: 'caf', content: expect.stringContaining('new'), config: { sidebarTitle: 'Café' } }),
    ]);
    expect(pageOf('docs/café.md')?.id).toBe('page-legacy');
  });

  it('never adopts a page that belongs to another source file', async () => {
    mocks.rows.push({ id: 'page-owned', parentId: null, kind: 'PAGE', slug: 'intro', title: 'Intro', content: 'other', config: null });
    mocks.sources.push({ pageId: 'page-owned', projectId: 'project-1', branchId: 'branch-1', languageId: 'language-1', path: 'docs/old/intro.md' });
    mocks.files.set('docs/intro.md', 'mine');

    await expect(runImport()).resolves.toMatchObject({ imported: 1, updated: 0 });
    expect(mocks.rows.find((row) => row.id === 'page-owned')?.content).toBe('other');
  });

  it('keeps a page imported on a branch after that branch is merged into main', async () => {
    mocks.rows.push({ id: 'page-moved', parentId: null, kind: 'PAGE', slug: 'intro', title: 'Intro', content: 'old', config: null });
    // The row still names the branch the page was imported on.
    mocks.sources.push({ pageId: 'page-moved', projectId: 'project-1', branchId: 'branch-merged', languageId: 'language-1', path: 'docs/intro.md' });
    mocks.files.set('docs/intro.md', 'new');

    await expect(runImport()).resolves.toMatchObject({ imported: 0, updated: 1, skipped: 0 });
    expect(mocks.rows).toEqual([expect.objectContaining({ id: 'page-moved', content: 'new' })]);
    expect(mocks.sources).toEqual([expect.objectContaining({ pageId: 'page-moved', branchId: 'branch-1', path: 'docs/intro.md' })]);
    expect(mocks.prisma.pageGitImportSource.create).not.toHaveBeenCalled();
  });

  it('adopts the old shared `page` of Arabic files only for the file whose text it holds', async () => {
    // The old importer slugged every Arabic name `page`: the last file won.
    mocks.rows.push({ id: 'page-legacy', parentId: null, kind: 'PAGE', slug: 'page', title: 'النشر', content: 'انشر موقعك', config: null });
    mocks.files.set('docs/البدء.md', 'ابدأ هنا');
    mocks.files.set('docs/النشر.md', 'انشر موقعك');

    await expect(runImport()).resolves.toMatchObject({ imported: 1, updated: 1 });
    expect(pageOf('docs/النشر.md')?.id).toBe('page-legacy');
    expect(pageOf('docs/البدء.md')).toMatchObject({ slug: 'البدء', content: 'ابدأ هنا' });
    expect(mocks.rows.filter((row) => row.kind === 'PAGE')).toHaveLength(2);
  });

  it('never adopts the old shared `page` when its text matches no file', async () => {
    mocks.rows.push({ id: 'page-legacy', parentId: null, kind: 'PAGE', slug: 'page', title: 'x', content: 'edited by a writer', config: null });
    mocks.files.set('docs/البدء.md', 'ابدأ هنا');
    mocks.files.set('docs/النشر.md', 'انشر موقعك');

    await expect(runImport()).resolves.toMatchObject({ imported: 2, updated: 0 });
    expect(mocks.rows.find((row) => row.id === 'page-legacy')?.content).toBe('edited by a writer');
  });

  it('drops its duplicate page when a concurrent import claimed the file first', async () => {
    mocks.files.set('docs/intro.md', 'A');
    mocks.prisma.pageGitImportSource.create.mockImplementationOnce(async () => {
      throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    });

    await expect(runImport()).resolves.toMatchObject({ imported: 0, skipped: 1 });
    expect(mocks.rows).toEqual([]);
    const [lock] = (mocks.prisma as unknown as { $queryRaw: { mock: { calls: Array<[string[]]> } } }).$queryRaw.mock.calls[0] ?? [[]];
    expect(lock.join('?')).toContain('FOR NO KEY UPDATE');
  });

  const loseIdentityRace = () => {
    mocks.files.set('docs/intro.md', 'A');
    mocks.prisma.pageGitImportSource.create.mockImplementationOnce(async () => {
      throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    });
  };
  const duplicatePage = () => mocks.rows.find((row) => row.slug === 'intro');
  const touch = (row: Row | undefined, fields: Partial<Row>) => {
    if (row) Object.assign(row, fields, { updatedAt: new Date((row.updatedAt?.getTime() ?? 0) + 1) });
  };

  it.each([
    ['a save', () => touch(duplicatePage(), { content: 'Saved by a writer' }), () => expect(duplicatePage()?.content).toBe('Saved by a writer')],
    [
      'a settings-only save',
      () => touch(duplicatePage(), { config: { sidebarTitle: 'Start' } }),
      () => expect(duplicatePage()?.config).toEqual({ sidebarTitle: 'Start' }),
    ],
    [
      'a new child page',
      () =>
        mocks.rows.push({
          id: 'child',
          parentId: duplicatePage()?.id ?? null,
          kind: 'PAGE',
          slug: 'child',
          title: 'Child',
          content: 'Child',
          config: null,
        }),
      () => expect(mocks.rows.some((row) => row.id === 'child')).toBe(true),
    ],
  ])('keeps its duplicate page, unlinked, when %s lands before the cleanup lock', async (_what, commitBeforeLock, verify) => {
    loseIdentityRace();
    // The writer's transaction commits while the cleanup waits for the page row.
    const queryRaw = (mocks.prisma as unknown as { $queryRaw: ReturnType<typeof vi.fn> }).$queryRaw;
    queryRaw
      .mockImplementationOnce(async () => [])
      .mockImplementationOnce(async () => {
        commitBeforeLock();
        return [];
      });

    await expect(runImport()).resolves.toMatchObject({ imported: 0, skipped: 1 });
    expect(duplicatePage()).toBeDefined();
    verify();
    expect(mocks.sources).toEqual([]);
    expect(String(queryRaw.mock.calls[1]?.[0])).toContain('FOR UPDATE');
  });

  it('keeps the page and its identity when another import adopted it before the claim failed', async () => {
    mocks.files.set('docs/intro.md', 'A');
    // Import B adopts the page this import just created, so this import's claim fails.
    mocks.prisma.pageGitImportSource.create.mockImplementationOnce(async ({ data }: { data: Source }) => {
      mocks.sources.push({ ...data });
      throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    });

    await expect(runImport()).resolves.toMatchObject({ imported: 0, skipped: 1 });
    const page = duplicatePage();
    expect(page).toBeDefined();
    expect(mocks.sources).toEqual([expect.objectContaining({ pageId: page?.id, path: 'docs/intro.md' })]);
  });

  it.each([
    ['the transaction times out', { code: 'P2028' }],
    ['a lock wait hits lock_timeout', { code: 'P2010', meta: { code: '55P03', message: 'canceling statement due to lock timeout' } }],
    ['the driver adapter reports lock_timeout', { code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: '55P03' } } } }],
  ])('leaves its duplicate page unlinked when %s', async (_what, failure) => {
    loseIdentityRace();
    const transaction = (mocks.prisma as unknown as { $transaction: ReturnType<typeof vi.fn> }).$transaction;
    transaction.mockImplementationOnce(async () => {
      throw Object.assign(new Error('Cleanup gave up'), failure);
    });

    await expect(runImport()).resolves.toMatchObject({ imported: 0, skipped: 1 });
    expect(duplicatePage()).toBeDefined();
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 30_000, maxWait: 10_000 });
  });

  it('caps every lock wait of the duplicate cleanup before taking the locks', async () => {
    loseIdentityRace();

    await runImport();

    const executeRaw = (mocks.prisma as unknown as { $executeRaw: ReturnType<typeof vi.fn> }).$executeRaw;
    expect(String(executeRaw.mock.calls[0]?.[0])).toContain("SET LOCAL lock_timeout = '10s'");
  });

  it.each([
    ['its claim hits a page another import just removed (P2003)', 'claim'],
    ['the page is deleted before its update (P2025)', 'update'],
  ])('skips an older page the file was adopting when %s', async (_what, step) => {
    mocks.rows.push({ id: 'page-legacy', parentId: null, kind: 'PAGE', slug: 'intro', title: 'Intro', content: 'old', config: null });
    mocks.files.set('docs/intro.md', 'new');
    if (step === 'claim') {
      mocks.prisma.pageGitImportSource.create.mockImplementationOnce(async () => {
        throw Object.assign(new Error('Foreign key constraint failed'), { code: 'P2003' });
      });
    } else {
      mocks.prisma.page.update.mockImplementationOnce(async () => {
        throw Object.assign(new Error('Record to update not found.'), { code: 'P2025' });
      });
    }

    await expect(runImport()).resolves.toMatchObject({ imported: 0, updated: 0, skipped: 1 });
  });

  it('drops a stale row whose path another page already holds here, and never adopts its page', async () => {
    mocks.rows.push({ id: 'page-stale', parentId: null, kind: 'PAGE', slug: 'intro', title: 'Intro', content: 'merged copy', config: null });
    mocks.rows.push({ id: 'page-current', parentId: null, kind: 'PAGE', slug: 'intro-2', title: 'Intro', content: 'old', config: null });
    mocks.sources.push({ pageId: 'page-stale', projectId: 'project-1', branchId: 'branch-merged', languageId: 'language-1', path: 'docs/intro.md' });
    mocks.sources.push({ pageId: 'page-current', projectId: 'project-1', branchId: 'branch-1', languageId: 'language-1', path: 'docs/intro.md' });
    mocks.files.set('docs/intro.md', 'new');

    await expect(runImport()).resolves.toMatchObject({ imported: 0, updated: 1, skipped: 0 });
    expect(mocks.sources).toEqual([expect.objectContaining({ pageId: 'page-current', branchId: 'branch-1', path: 'docs/intro.md' })]);
    expect(mocks.rows.find((row) => row.id === 'page-current')?.content).toBe('new');
    expect(mocks.rows.find((row) => row.id === 'page-stale')?.content).toBe('merged copy');
    expect(mocks.prisma.pageGitImportSource.create).not.toHaveBeenCalled();
  });

  it('writes nothing when a file cannot be downloaded part-way through', async () => {
    mocks.files.set('docs/a.md', '# A');
    mocks.files.set('docs/b.md', '# B');
    mocks.failingPath = 'docs/b.md';

    await expect(runImport()).rejects.toThrow('GitHub API 502');
    expect(createPage).not.toHaveBeenCalled();
    expect(mocks.prisma.page.update).not.toHaveBeenCalled();
  });
});

describe('importFromGitProvider page size cap', () => {
  const MiB = 1024 * 1024;
  const cap = 2 * MiB;
  beforeEach(() => {
    // The locked read returns the stored body of the fake row.
    Object.assign(mocks.prisma, {
      $queryRaw: vi.fn(async (_sql: TemplateStringsArray, id: string) => {
        const row = mocks.rows.find((candidate) => candidate.id === id);
        return row ? [{ content: row.content }] : [];
      }),
    });
  });

  it('skips and reports a re-import that would grow a page past the cap, and leaves the page as it was', async () => {
    mocks.files.set('docs/guide.md', 'Small');
    mocks.files.set('docs/other.md', 'Other');
    await runImport();
    mocks.files.set('docs/guide.md', 'x'.repeat(cap + 1));
    mocks.files.set('docs/other.md', 'Other, updated');
    await expect(runImport()).resolves.toMatchObject({ updated: 1, skipped: 1, tooLarge: ['docs/guide.md'] });
    expect(pageOf('docs/guide.md')?.content).toBe('Small');
    expect(pageOf('docs/other.md')?.content).toBe('Other, updated');
    // Compared with the stored body under the row lock.
    const raw = mocks.prisma as unknown as { $transaction: ReturnType<typeof vi.fn>; $queryRaw: ReturnType<typeof vi.fn> };
    expect(raw.$transaction).toHaveBeenCalled();
    expect(String(raw.$queryRaw.mock.calls.at(-1)?.[0].join('?'))).toContain('FOR NO KEY UPDATE');
  });

  it('applies a re-import that shrinks a page already over the cap', async () => {
    mocks.files.set('docs/guide.md', 'Small');
    await runImport();
    const stored = pageOf('docs/guide.md');
    if (stored) stored.content = 'x'.repeat(3 * MiB);
    mocks.files.set('docs/guide.md', 'x'.repeat(2.5 * MiB));
    await expect(runImport()).resolves.toMatchObject({ updated: 1, skipped: 0, tooLarge: [] });
    expect(pageOf('docs/guide.md')?.content).toHaveLength(2.5 * MiB);
  });

  it('skips and reports a new file over the cap instead of creating its page', async () => {
    mocks.files.set('docs/huge.md', 'ع'.repeat(MiB + 1));
    mocks.files.set('docs/intro.md', 'Hello');
    await expect(runImport()).resolves.toMatchObject({ imported: 1, skipped: 1, tooLarge: ['docs/huge.md'] });
    expect(createPage).toHaveBeenCalledOnce();
  });

  it('reads repository files with a bound and reports one that is over it, without stopping the import', async () => {
    const { getGitHubTextFile } = await import('./importers/github');
    const { ImportError } = await import('@/errors');
    const original = vi.mocked(getGitHubTextFile).getMockImplementation();
    onTestFinished(() => {
      if (original) vi.mocked(getGitHubTextFile).mockImplementation(original);
    });
    vi.mocked(getGitHubTextFile).mockImplementation(async (_owner, _repo, _branch, path, maxBytes) => {
      expect(maxBytes).toBe(4 * cap);
      if (path === 'docs/huge.md') throw new ImportError({ code: 'import:limit', message: 'too large' });
      return mocks.files.get(path) ?? null;
    });
    mocks.files.set('docs/huge.md', 'x');
    mocks.files.set('docs/intro.md', 'Hello');
    await expect(runImport()).resolves.toMatchObject({ imported: 1, skipped: 1, tooLarge: ['docs/huge.md'] });
  });
});
