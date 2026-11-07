import { slugifyUnicode } from '@nibleaf/shared/utils';
import { updatePageBody } from '@nibleaf/validators';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = { id: string; parentId: string | null; kind: 'PAGE' | 'GROUP'; slug: string; title: string; content: string; config: unknown };
type Source = { pageId: string; projectId: string; branchId: string; languageId: string; path: string };

const mocks = vi.hoisted(() => ({
  prisma: {
    organization: { findUnique: vi.fn(), update: vi.fn() },
    page: { findMany: vi.fn(), update: vi.fn() },
    pageGitImportSource: { create: vi.fn(), findMany: vi.fn() },
  },
  files: new Map<string, string>(),
  failingPath: null as string | null,
  rows: [] as Row[],
  sources: [] as Source[],
  ids: 0,
}));

vi.mock('@nibleaf/database', () => ({ prisma: mocks.prisma }));
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
    };
    mocks.rows.push(row);
    return row;
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
    Object.assign(row, data);
    return row;
  });
  mocks.prisma.pageGitImportSource.findMany.mockImplementation(async () => mocks.sources.map((row) => ({ ...row })));
  // Same constraints as the table: pageId is the key, (scope, path) is unique.
  mocks.prisma.pageGitImportSource.create.mockImplementation(async ({ data }: { data: Source }) => {
    if (mocks.sources.some((row) => row.pageId === data.pageId || row.path === data.path)) throw new Error('Unique constraint failed');
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

  it('writes nothing when a file cannot be downloaded part-way through', async () => {
    mocks.files.set('docs/a.md', '# A');
    mocks.files.set('docs/b.md', '# B');
    mocks.failingPath = 'docs/b.md';

    await expect(runImport()).rejects.toThrow('GitHub API 502');
    expect(createPage).not.toHaveBeenCalled();
    expect(mocks.prisma.page.update).not.toHaveBeenCalled();
  });
});
