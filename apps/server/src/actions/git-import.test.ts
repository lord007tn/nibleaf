import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {
    organization: { findUnique: vi.fn(), update: vi.fn() },
    page: { findFirst: vi.fn() },
  },
  files: new Map<string, string>(),
  failingPath: null as string | null,
  pages: [] as Array<{ id: string; parentId: string | null; slug: string; title: string; content: string }>,
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
// Same matching rule as the real persistence: a leaf is (parent, slug).
vi.mock('./importers/persistence', () => ({
  ensureGroupPage: vi.fn(async (_target: unknown, group: { parentId: string | null; slug: string }) => `group:${group.parentId ?? ''}/${group.slug}`),
  upsertLeafPage: vi.fn(async (_target: unknown, page: { parentId: string | null; slug: string; title: string; content: string }) => {
    const found = mocks.pages.find((row) => row.parentId === page.parentId && row.slug === page.slug);
    if (found) {
      Object.assign(found, { title: page.title, content: page.content });
      return 'updated';
    }
    mocks.pages.push({ id: `page-${mocks.pages.length + 1}`, parentId: page.parentId, slug: page.slug, title: page.title, content: page.content });
    return 'imported';
  }),
}));

import { importFromGitProvider, normalizeGitContentPath, planImportSlugs } from './git-import';
import { upsertLeafPage } from './importers/persistence';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.files.clear();
  mocks.failingPath = null;
  mocks.pages = [];
  mocks.prisma.organization.findUnique.mockResolvedValue({
    metadata: JSON.stringify({ git: { provider: 'github', repo: 'acme/docs', branch: 'main', path: 'docs' } }),
  });
  mocks.prisma.organization.update.mockResolvedValue({});
  mocks.prisma.page.findFirst.mockImplementation(async ({ where }: { where: { parentId: string | null; slug: string } }) => {
    const row = mocks.pages.find((page) => page.parentId === where.parentId && page.slug === where.slug);
    return row ? { id: row.id } : null;
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

describe('planImportSlugs', () => {
  it('keeps Arabic file names as distinct, readable slugs', () => {
    const slugs = planImportSlugs(['ar/البدء.md', 'ar/النشر.md', 'ar/دليل/index.md']);
    expect(Object.fromEntries(slugs)).toEqual({ 'ar/البدء.md': 'البدء', 'ar/النشر.md': 'النشر', 'ar/دليل/index.md': 'دليل' });
  });

  it('strips tashkeel like dashboard slugs do', () => {
    expect(planImportSlugs(['مُقَدِّمَة.md']).get('مُقَدِّمَة.md')).toBe('مقدمة');
  });

  it('suffixes names that normalize alike, independent of listing order', () => {
    const paths = ['Intro.md', 'intro.mdx', 'intro-2.md', 'guide.md', 'guide/index.md', '🎉.md', '✨.md'];
    const forward = planImportSlugs(paths);
    expect(planImportSlugs([...paths].reverse())).toEqual(forward);
    expect(Object.fromEntries(forward)).toEqual({
      'Intro.md': 'intro',
      'intro.mdx': 'intro-3', // intro-2 is another file's own slug
      'intro-2.md': 'intro-2',
      'guide.md': 'guide',
      'guide/index.md': 'guide-2',
      '✨.md': 'page',
      '🎉.md': 'page-2',
    });
    expect(new Set(forward.values()).size).toBe(paths.length);
  });

  it('only compares files that land in the same folder', () => {
    expect(Object.fromEntries(planImportSlugs(['a/intro.md', 'b/intro.md']))).toEqual({ 'a/intro.md': 'intro', 'b/intro.md': 'intro' });
  });
});

describe('importFromGitProvider', () => {
  it('imports two Arabic files as two pages and maps them to the same pages on re-import', async () => {
    mocks.files.set('docs/البدء.md', '# البدء\n\nابدأ هنا');
    mocks.files.set('docs/النشر.md', '# النشر\n\nانشر موقعك');

    await expect(importFromGitProvider('org-1', 'project-1')).resolves.toMatchObject({ imported: 2, updated: 0 });
    expect(mocks.pages.map((page) => page.slug).sort()).toEqual(['البدء', 'النشر']);

    mocks.files.set('docs/النشر.md', '# النشر\n\nنسخة محدثة');
    await expect(importFromGitProvider('org-1', 'project-1')).resolves.toMatchObject({ imported: 0, updated: 2 });
    expect(mocks.pages).toHaveLength(2);
    expect(mocks.pages.find((page) => page.slug === 'البدء')?.content).toContain('ابدأ هنا');
    expect(mocks.pages.find((page) => page.slug === 'النشر')?.content).toContain('نسخة محدثة');
  });

  it('keeps updating a page imported under its older ASCII-only slug', async () => {
    mocks.pages.push({ id: 'page-legacy', parentId: null, slug: 'caf', title: 'Café', content: 'old' });
    mocks.files.set('docs/café.md', '# Café\n\nnew');

    await expect(importFromGitProvider('org-1', 'project-1')).resolves.toMatchObject({ imported: 0, updated: 1 });
    expect(mocks.pages).toEqual([expect.objectContaining({ id: 'page-legacy', slug: 'caf', content: expect.stringContaining('new') })]);
  });

  it('writes nothing when a file cannot be downloaded part-way through', async () => {
    mocks.files.set('docs/a.md', '# A');
    mocks.files.set('docs/b.md', '# B');
    mocks.failingPath = 'docs/b.md';

    await expect(importFromGitProvider('org-1', 'project-1')).rejects.toThrow('GitHub API 502');
    expect(upsertLeafPage).not.toHaveBeenCalled();
  });
});
