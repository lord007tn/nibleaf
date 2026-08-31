import type { MintlifyImportBody } from '@nibleaf/validators';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_IMPORT_FILES } from './content';
import type { ImportSummary } from './types';

/**
 * Importer-level tests for the Mintlify nav walk (slug collisions, hash
 * fallbacks, the created-node cap). GitHub access and page persistence are
 * replaced with in-memory fakes, so these run without a database or network —
 * the fakes mirror the real persistence matching rules (upsert leaves by
 * (parent, slug, PAGE); groups by exact slug first, then title).
 */

const mem = vi.hoisted(() => ({
  rows: [] as Array<{
    id: string;
    kind: 'GROUP' | 'PAGE';
    languageId: string;
    parentId: string | null;
    slug: string;
    title: string;
    translationKey?: string;
  }>,
  languages: new Map([['en', { id: 'lang-en', code: 'en' }]]),
  languageOperations: [] as Array<{ kind: 'create' | 'update'; code: string; position?: number; isDefault?: boolean; enabled?: boolean }>,
  nextId: 1,
  repoFiles: new Map<string, string>(),
  reset() {
    this.rows.length = 0;
    this.nextId = 1;
    this.repoFiles.clear();
    this.languageOperations.length = 0;
    this.languages.clear();
    this.languages.set('en', { id: 'lang-en', code: 'en' });
  },
}));

vi.mock('@nibleaf/database', () => ({
  prisma: {
    branch: { deleteMany: vi.fn(async () => ({ count: 1 })) },
    project: { update: vi.fn(async () => ({})) },
    language: {
      findFirst: vi.fn(async ({ where }: { where: { code: { equals: string } } }) =>
        [...mem.languages.values()].find((language) => language.code.toLowerCase() === where.code.equals.toLowerCase()),
      ),
    },
  },
}));
vi.mock('../branches', () => ({
  createImportReplacementBranch: vi.fn(async () => ({ id: 'import-branch' })),
  promoteImportReplacementBranch: vi.fn(async () => ({})),
}));
vi.mock('../languages', () => ({
  createLanguage: vi.fn(async (_projectId: string, body: { code: string }) => {
    const language = { id: `lang-${body.code}`, code: body.code };
    mem.languageOperations.push({ kind: 'create', code: body.code });
    mem.languages.set(body.code, language);
    return language;
  }),
  updateLanguage: vi.fn(async (_projectId: string, id: string, body: { position?: number; isDefault?: boolean; enabled?: boolean }) => {
    const language = [...mem.languages.values()].find((candidate) => candidate.id === id);
    if (!language) return;
    mem.languageOperations.push({ kind: 'update', code: language.code, ...body });
    return language;
  }),
}));
vi.mock('../projects', () => ({ assertProjectInOrg: vi.fn(async () => ({ id: 'project', config: null })) }));
vi.mock('./github', () => ({
  getGitHubDefaultBranch: async () => 'main',
  listGitHubFiles: async () => [...mem.repoFiles.keys()].map((path) => ({ path, type: 'blob' as const })),
  getGitHubTextFile: async (_owner: string, _name: string, _branch: string, path: string) => mem.repoFiles.get(path) ?? null,
  githubRawUrl: (_owner: string, _name: string, _branch: string, path: string) => path,
  fetchRawText: async (path: string) => mem.repoFiles.get(path) ?? null,
}));
vi.mock('./persistence', () => ({
  defaultImportTarget: async (projectId: string) => ({ projectId, branchId: 'branch', languageId: 'lang-en' }),
  removeImportPlaceholders: async () => 0,
  ensureGroupPage: async (target: { languageId: string }, group: { parentId: string | null; title: string; slug: string }) => {
    const found =
      mem.rows.find(
        (row) => row.languageId === target.languageId && row.kind === 'GROUP' && row.parentId === group.parentId && row.slug === group.slug,
      ) ??
      mem.rows.find(
        (row) => row.languageId === target.languageId && row.kind === 'GROUP' && row.parentId === group.parentId && row.title === group.title,
      );
    if (found) {
      return found.id;
    }
    const row = {
      id: `row-${mem.nextId++}`,
      kind: 'GROUP' as const,
      languageId: target.languageId,
      parentId: group.parentId,
      slug: group.slug,
      title: group.title,
    };
    mem.rows.push(row);
    return row.id;
  },
  upsertLeafPage: async (target: { languageId: string }, page: { parentId: string | null; slug: string; title: string; translationKey?: string }) => {
    const found = mem.rows.find(
      (row) => row.languageId === target.languageId && row.kind === 'PAGE' && row.parentId === page.parentId && row.slug === page.slug,
    );
    if (found) {
      found.title = page.title;
      found.translationKey = page.translationKey;
      return 'updated' as const;
    }
    mem.rows.push({
      id: `row-${mem.nextId++}`,
      kind: 'PAGE' as const,
      languageId: target.languageId,
      parentId: page.parentId,
      slug: page.slug,
      title: page.title,
      translationKey: page.translationKey,
    });
    return 'imported' as const;
  },
}));

import { prisma } from '@nibleaf/database';
import { promoteImportReplacementBranch } from '../branches';
import { mintlifyImporter } from './mintlify';

const runImport = (input: Partial<MintlifyImportBody> = {}): Promise<ImportSummary> =>
  mintlifyImporter.run({
    organizationId: 'org',
    projectId: 'project',
    input: { repo: 'acme/docs', branch: 'main', ...input } as MintlifyImportBody,
  });

const setNavigation = (navigation: unknown): void => {
  mem.repoFiles.set('docs.json', JSON.stringify({ navigation }));
};

beforeEach(() => {
  vi.clearAllMocks();
  mem.reset();
});

describe('Mintlify replacement safety', () => {
  it('promotes the isolated replacement only after a complete import', async () => {
    setNavigation([{ group: 'Docs', pages: ['intro'] }]);
    mem.repoFiles.set('intro.mdx', '# Intro');

    await runImport();

    expect(promoteImportReplacementBranch).toHaveBeenCalledWith('project', 'import-branch', undefined);
  });

  it('deletes the isolated replacement when the import fails', async () => {
    setNavigation([]);

    await expect(runImport()).rejects.toThrow('empty navigation');

    expect(promoteImportReplacementBranch).not.toHaveBeenCalled();
    expect(prisma.branch.deleteMany).toHaveBeenCalledWith({
      where: { id: 'import-branch', projectId: 'project', isDefault: false },
    });
  });

  it('uses explicit navigation as the exact source of truth for a replacement import', async () => {
    setNavigation([{ group: 'Docs', pages: ['intro'] }]);
    mem.repoFiles.set('intro.mdx', '# Intro\n\n[Hidden appendix](/appendix)');
    mem.repoFiles.set('appendix.mdx', '# Appendix');

    await runImport({ replaceExisting: true });

    expect(mem.rows.filter((row) => row.kind === 'PAGE').map((row) => row.slug)).toEqual(['intro']);
  });
});

describe('mintlify importNodes slug collisions', () => {
  it('imports modern object page entries with their label, icon, and tag metadata', async () => {
    setNavigation([{ group: 'Docs', pages: [{ page: 'guides/intro', label: 'Start here', icon: 'rocket', tag: 'New' }] }]);
    mem.repoFiles.set('guides/intro.mdx', '# Ignored heading');

    const summary = await runImport();
    expect(summary.imported).toBe(1);
    expect(mem.rows.find((row) => row.kind === 'PAGE')?.title).toBe('Start here');
  });

  it('imports sibling pages sharing a basename as two distinct pages, stable across re-imports', async () => {
    setNavigation([{ group: 'Docs', pages: ['sdk/overview', 'api/overview'] }]);
    mem.repoFiles.set('sdk/overview.mdx', '# SDK overview');
    mem.repoFiles.set('api/overview.mdx', '# API overview');

    const first = await runImport();
    expect(first.imported).toBe(2);
    const pages = mem.rows.filter((row) => row.kind === 'PAGE');
    expect(pages.map((page) => page.slug)).toEqual(['overview', 'api-overview']);
    // Both live under the same group parent — the collision was per-parent.
    expect(new Set(pages.map((page) => page.parentId)).size).toBe(1);
    expect(first.warnings.some((w) => w.includes('sdk/overview') && w.includes('api/overview') && w.includes('api-overview'))).toBe(true);

    // Re-import: same slugs, updates in place, no third page.
    const second = await runImport();
    expect(second.imported).toBe(0);
    expect(second.updated).toBe(2);
    const again = mem.rows.filter((row) => row.kind === 'PAGE');
    expect(again.map((page) => page.slug)).toEqual(['overview', 'api-overview']);
  });

  it('gives non-Latin page and group names distinct stable hash slugs', async () => {
    setNavigation([
      { group: 'مقدمة', pages: ['docs/مقدمة'] },
      { group: 'دليل', pages: ['docs/ثاني'] },
    ]);
    mem.repoFiles.set('docs/مقدمة.mdx', '# Intro');
    mem.repoFiles.set('docs/ثاني.mdx', '# Second');

    const summary = await runImport();
    expect(summary.imported).toBe(2);
    const groups = mem.rows.filter((row) => row.kind === 'GROUP');
    const pages = mem.rows.filter((row) => row.kind === 'PAGE');
    expect(groups).toHaveLength(2);
    expect(pages).toHaveLength(2);
    for (const group of groups) {
      expect(group.slug).toMatch(/^group-[0-9a-f]{8}$/);
    }
    for (const page of pages) {
      expect(page.slug).toMatch(/^page-[0-9a-f]{8}$/);
    }
    expect(new Set(groups.map((group) => group.slug)).size).toBe(2);
    expect(new Set(pages.map((page) => page.slug)).size).toBe(2);
    expect(summary.warnings.some((w) => w.includes('no Latin characters'))).toBe(true);
  });
});

describe('mintlify language import', () => {
  it('imports language trees into separate targets with explicit page pairing', async () => {
    setNavigation({
      languages: [
        { language: 'en', default: true, groups: [{ group: 'Guides', 'x-nibleaf': { slug: 'guides' }, pages: ['intro'] }] },
        { language: 'ar', groups: [{ group: 'الأدلة', 'x-nibleaf': { slug: 'guides' }, pages: ['ar/intro'] }] },
      ],
    });
    mem.repoFiles.set('intro.mdx', "---\ntranslation_key: 'intro'\nlang: 'en'\n---\n# Intro");
    mem.repoFiles.set('ar/intro.mdx', "---\ntranslation_key: 'intro'\nlang: 'ar'\n---\n# مقدمة");

    const summary = await runImport();
    expect(summary.imported).toBe(2);
    expect([...mem.languages.keys()]).toEqual(['en', 'ar']);
    const pages = mem.rows.filter((row) => row.kind === 'PAGE');
    expect(pages.map((page) => ({ languageId: page.languageId, translationKey: page.translationKey }))).toEqual([
      { languageId: 'lang-en', translationKey: 'intro' },
      { languageId: 'lang-ar', translationKey: 'intro' },
    ]);
    const groups = mem.rows.filter((row) => row.kind === 'GROUP');
    expect(groups.map((group) => group.slug)).toEqual(['guides', 'guides']);
  });

  it('matches existing language codes case-insensitively without changing their stored spelling', async () => {
    mem.languages.clear();
    mem.languages.set('AR', { id: 'lang-ar', code: 'AR' });
    setNavigation({ languages: [{ language: 'ar', default: true, pages: ['ar/intro'] }] });
    mem.repoFiles.set('ar/intro.mdx', '# مقدمة');

    await runImport();

    expect([...mem.languages.keys()]).toEqual(['AR']);
    expect(mem.languageOperations[0]).toMatchObject({ kind: 'update', code: 'AR', isDefault: true });
  });

  it('promotes the declared default before updating a previously default hidden language while retaining positions', async () => {
    mem.languages.set('ar', { id: 'lang-ar', code: 'ar' });
    setNavigation({
      languages: [
        { language: 'ar', hidden: true, pages: ['ar/intro'] },
        { language: 'en', default: true, pages: ['intro'] },
      ],
    });
    mem.repoFiles.set('ar/intro.mdx', '# مقدمة');
    mem.repoFiles.set('intro.mdx', '# Intro');

    await runImport();

    expect(mem.languageOperations.slice(0, 2)).toMatchObject([
      { kind: 'update', code: 'en', position: 1, isDefault: true, enabled: true },
      { kind: 'update', code: 'ar', position: 0, enabled: false },
    ]);
  });
});

describe('mintlify import cap', () => {
  it('counts created GROUP nodes against the cap, warns once, and skips the remainder', async () => {
    const total = MAX_IMPORT_FILES + 1; // 251 groups of one page each = 502 potential nodes
    setNavigation(Array.from({ length: total }, (_, i) => ({ group: `Group ${i}`, pages: [`page-${i}`] })));
    for (let i = 0; i < total; i++) {
      mem.repoFiles.set(`page-${i}.mdx`, `# Page ${i}`);
    }

    const summary = await runImport();
    const groups = mem.rows.filter((row) => row.kind === 'GROUP');
    const pages = mem.rows.filter((row) => row.kind === 'PAGE');
    // Groups and leaves alternate, so half the node budget goes to each.
    expect(groups).toHaveLength(MAX_IMPORT_FILES / 2);
    expect(pages).toHaveLength(MAX_IMPORT_FILES / 2);
    expect(mem.rows).toHaveLength(MAX_IMPORT_FILES);
    expect(summary.imported).toBe(MAX_IMPORT_FILES / 2);
    expect(summary.warnings.filter((w) => w.includes('capped'))).toHaveLength(1);
    // Every remaining top-level group counts as one skipped nav entry.
    expect(summary.skipped).toBe(total - MAX_IMPORT_FILES / 2);
  });
});
