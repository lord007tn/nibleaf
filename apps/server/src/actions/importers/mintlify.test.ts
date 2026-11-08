import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MintlifyImportBody } from '@nibleaf/validators';
import { unzipSync } from 'fflate';
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
    content?: string;
    translationKey?: string;
    description?: string;
    icon?: string;
    config?: unknown;
    position?: number;
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
  captureImportDraft: vi.fn(async () => 'draft-before-source-read'),
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
vi.mock('../assets', () => ({ findImportedAsset: vi.fn(), storeAsset: vi.fn() }));
vi.mock('./github', () => ({
  getGitHubSnapshot: async () => ({ revision: 'pinned-sha', files: [...mem.repoFiles.keys()].map((path) => ({ path, type: 'blob' as const })) }),
  getGitHubDefaultBranch: async () => 'main',
  listGitHubFiles: async () => [...mem.repoFiles.keys()].map((path) => ({ path, type: 'blob' as const })),
  getGitHubTextFile: async (_owner: string, _name: string, _branch: string, path: string) => mem.repoFiles.get(path) ?? null,
  githubRawUrl: (_owner: string, _name: string, _branch: string, path: string) => path,
  fetchRawText: async (path: string) => mem.repoFiles.get(path) ?? null,
}));
vi.mock('./persistence', () => ({
  defaultImportTarget: async (projectId: string) => ({ projectId, branchId: 'branch', languageId: 'lang-en' }),
  removeImportPlaceholders: async () => 0,
  ensureGroupPage: async (
    target: { languageId: string },
    group: { parentId: string | null; title: string; slug: string; icon?: string; position?: number },
  ) => {
    const found =
      mem.rows.find(
        (row) => row.languageId === target.languageId && row.kind === 'GROUP' && row.parentId === group.parentId && row.slug === group.slug,
      ) ??
      mem.rows.find(
        (row) => row.languageId === target.languageId && row.kind === 'GROUP' && row.parentId === group.parentId && row.title === group.title,
      );
    if (found) {
      found.position = group.position;
      return found.id;
    }
    const row = {
      id: `row-${mem.nextId++}`,
      kind: 'GROUP' as const,
      languageId: target.languageId,
      parentId: group.parentId,
      slug: group.slug,
      title: group.title,
      icon: group.icon,
      position: group.position,
    };
    mem.rows.push(row);
    return row.id;
  },
  upsertLeafPage: async (
    target: { languageId: string },
    page: {
      parentId: string | null;
      slug: string;
      title: string;
      content: string;
      translationKey?: string;
      description?: string;
      icon?: string;
      config?: unknown;
      position?: number;
    },
  ) => {
    const found = mem.rows.find(
      (row) => row.languageId === target.languageId && row.kind === 'PAGE' && row.parentId === page.parentId && row.slug === page.slug,
    );
    if (found) {
      found.title = page.title;
      found.content = page.content;
      found.translationKey = page.translationKey;
      found.description = page.description;
      found.icon = page.icon;
      found.config = page.config;
      found.position = page.position;
      return 'updated' as const;
    }
    mem.rows.push({
      id: `row-${mem.nextId++}`,
      kind: 'PAGE' as const,
      languageId: target.languageId,
      parentId: page.parentId,
      slug: page.slug,
      title: page.title,
      content: page.content,
      translationKey: page.translationKey,
      description: page.description,
      icon: page.icon,
      config: page.config,
      position: page.position,
    });
    return 'imported' as const;
  },
}));

import { prisma } from '@nibleaf/database';
import { findImportedAsset, storeAsset } from '../assets';
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
  it('refuses to promote when one page is missing after another page was staged', async () => {
    setNavigation([{ group: 'Docs', pages: ['intro', 'missing'] }]);
    mem.repoFiles.set('intro.mdx', '# Intro');
    await expect(runImport()).rejects.toMatchObject({ code: 'import:incomplete', details: { path: 'missing' } });
    expect(promoteImportReplacementBranch).not.toHaveBeenCalled();
    expect(prisma.branch.deleteMany).toHaveBeenCalled();
  });
  it('promotes the isolated replacement only after a complete import', async () => {
    setNavigation([{ group: 'Docs', pages: ['intro'] }]);
    mem.repoFiles.set('intro.mdx', '# Intro');

    await runImport();

    expect(promoteImportReplacementBranch).toHaveBeenCalledWith('project', 'import-branch', undefined, 'draft-before-source-read', true);
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

const preservingDocsTree = async () => {
  await runImport({ replaceExisting: false });
  const route = (id: string | null): string => {
    const row = mem.rows.find((candidate) => candidate.id === id);
    return row ? `${route(row.parentId)}/${row.slug}` : '';
  };
  const tree = () =>
    mem.rows.map(({ id: _id, parentId, content, ...row }) => ({
      ...row,
      parent: mem.rows.find((candidate) => candidate.id === parentId)?.slug ?? null,
      path: `${route(parentId)}/${row.slug}`,
      ...(content === undefined ? {} : { contentHash: createHash('sha256').update(content).digest('hex') }),
    }));
  const first = tree();
  const result = await runImport({ replaceExisting: false });
  expect(result.imported).toBe(0);
  expect(tree()).toEqual(first);
  return first;
};

it('matches the recorded Nibleaf docs golden in preserve mode', async () => {
  const files = unzipSync(readFileSync(new URL('./fixtures/nibleaf-docs.source.zip', import.meta.url)));
  const recording = JSON.parse(new TextDecoder().decode(files['recording.json'])) as { revision: string; paths: string[] };
  expect(recording.revision).toBe('72699708f3939eb503ab31053b136b2776988573');
  for (const path of recording.paths) {
    const text = files[path];
    mem.repoFiles.set(path, text ? new TextDecoder().decode(text) : '');
  }
  const first = await preservingDocsTree();
  await expect(`${JSON.stringify(first, null, 2)}\n`).toMatchFileSnapshot('./fixtures/nibleaf-docs.golden.json');
});

it('re-imports the current repository docs with identical language, routes, metadata and content', async () => {
  const root = resolve(import.meta.dirname, '../../../../..');
  for (const entry of readdirSync(resolve(root, 'docs'), { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = resolve(entry.parentPath, entry.name);
    const path = file.slice(root.length + 1).replaceAll('\\', '/');
    mem.repoFiles.set(path, /\.(?:mdx?|json)$/.test(path) ? readFileSync(file, 'utf8') : '');
  }
  await preservingDocsTree();
});

describe('mintlify importNodes slug collisions', () => {
  it('preserves code images and links through the full import while migrating only prose images', async () => {
    setNavigation([{ group: 'Docs', pages: ['intro'] }]);
    const source = 'https://cdn.example.com/shared.png';
    const hosted = 'https://storage.example.com/imported.png';
    vi.mocked(findImportedAsset).mockResolvedValue({ url: hosted } as never);
    const literal = [
      '````mdx',
      '<Steps>',
      "Literal replacement characters: $& $$ $' $`",
      `<img src="${source}" />`,
      '```',
      '![Missing repository example](/images/missing.png)',
      '[Hidden example](/hidden)',
      '</Steps>',
      '````',
      `\`<img src="${source}" />\``,
      "``Literal replacement characters: $& $$ $' $` ``",
      `[Source](${source})`,
    ].join('\n');
    mem.repoFiles.set('intro.mdx', `# Intro\n\n${literal}\n\n<img src="${source}" alt="Real" />`);
    mem.repoFiles.set('hidden.mdx', '# Must not be discovered from a code example');
    for (let attempt = 0; attempt < 2; attempt++) {
      const summary = await runImport();
      const pages = mem.rows.filter((row) => row.kind === 'PAGE');
      expect(pages).toHaveLength(1);
      expect(pages[0]?.content).toBe(`# Intro\n\n${literal}\n\n![Real](${hosted})`);
      expect(summary.warnings).toEqual(['Replaced the existing draft navigation only after the complete Mintlify import succeeded.']);
    }
    expect(findImportedAsset).toHaveBeenCalledTimes(2);
    expect(storeAsset).not.toHaveBeenCalled();
  });

  it('persists literal MDX examples unchanged across import and re-import', async () => {
    setNavigation([{ group: 'Docs', pages: ['intro'] }]);
    const example = ['# Intro', '', '```mdx', '<Steps>', '<Step title="Literal">', 'Example', '</Step>', '</Steps>', '```'].join('\n');
    mem.repoFiles.set('intro.mdx', example);

    await runImport();
    expect(mem.rows.find((row) => row.kind === 'PAGE')?.content).toBe(example);
    await runImport();
    const pages = mem.rows.filter((row) => row.kind === 'PAGE');
    expect(pages).toHaveLength(1);
    expect(pages[0]?.content).toBe(example);
  });

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
  it('does not duplicate cross-linked English and Arabic documentation into the opposite language', async () => {
    for (const file of ['docs.json', 'intro.mdx', 'ar/intro.mdx']) {
      mem.repoFiles.set(file, readFileSync(new URL(`./fixtures/multilingual-linked-pages/${file}`, import.meta.url), 'utf8'));
    }
    const summary = await runImport();
    expect(summary.imported).toBe(2);
    expect(mem.rows.filter((row) => row.kind === 'PAGE').map(({ languageId, translationKey }) => ({ languageId, translationKey }))).toEqual([
      { languageId: 'lang-en', translationKey: 'intro' },
      { languageId: 'lang-ar', translationKey: 'intro' },
    ]);
    expect(summary.warnings.some((warning) => warning.includes('declares lang'))).toBe(false);
    expect(summary.warnings.some((warning) => warning.includes('linked page'))).toBe(false);
    const english = mem.rows.find((row) => row.kind === 'PAGE' && row.languageId === 'lang-en');
    const arabic = mem.rows.find((row) => row.kind === 'PAGE' && row.languageId === 'lang-ar');
    const arabicGroup = mem.rows.find((row) => row.id === arabic?.parentId);
    expect(english?.content).toContain(`[Arabic guide](/${arabicGroup?.slug}/intro?lang=ar)`);
    expect(arabic?.content).toContain('[English guide](/guides/intro?lang=en)');
  });

  it.each([
    ['ar', 'AR'],
    ['AR', 'ar'],
  ])('uses stored locale %s when navigation declares %s', async (storedCode, navigationCode) => {
    mem.languages.set(storedCode, { id: 'lang-ar', code: storedCode });
    for (const file of ['docs.json', 'intro.mdx', 'ar/intro.mdx']) {
      const content = readFileSync(new URL(`./fixtures/multilingual-linked-pages/${file}`, import.meta.url), 'utf8');
      mem.repoFiles.set(file, file === 'docs.json' ? content.replace('"language": "ar"', `"language": "${navigationCode}"`) : content);
    }
    expect((await runImport()).imported).toBe(2);
    expect(mem.rows.find((row) => row.kind === 'PAGE' && row.languageId === 'lang-en')?.content).toContain(`?lang=${storedCode})`);
    expect(mem.rows.find((row) => row.kind === 'PAGE' && row.languageId === 'lang-ar')?.content).toContain('?lang=en)');
  });
  it('keeps recursive same-language and undeclared linked pages while excluding a different declared language', async () => {
    setNavigation({ languages: [{ language: 'en', default: true, pages: ['intro'] }] });
    mem.repoFiles.set('intro.mdx', '---\nlang: en\n---\n[More](./more)');
    mem.repoFiles.set('more.mdx', '---\nlang: EN\n---\n[Next](./next)');
    mem.repoFiles.set('next.mdx', '[Arabic](./arabic)');
    mem.repoFiles.set('arabic.mdx', '---\nlang: ar\n---\n# مقدمة');

    const summary = await runImport();
    expect(summary.imported).toBe(3);
    expect(mem.rows.filter((row) => row.kind === 'PAGE').map((row) => row.slug)).toEqual(['intro', 'more', 'next']);
  });

  it('retains explicit navigation even when frontmatter declares a different language', async () => {
    setNavigation({ languages: [{ language: 'en', default: true, pages: ['intro'] }] });
    mem.repoFiles.set('intro.mdx', '---\nlang: ar\ntranslation_key: intro\n---\n# مقدمة');

    const summary = await runImport();
    expect(summary.imported).toBe(1);
    expect(summary.warnings.some((warning) => warning.includes('declares lang'))).toBe(true);
    expect(mem.rows.find((row) => row.kind === 'PAGE')).toMatchObject({ languageId: 'lang-en', translationKey: 'intro' });
  });

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
  it('counts GROUP nodes against the cap and refuses to promote an incomplete tree', async () => {
    const total = MAX_IMPORT_FILES + 1; // 251 groups of one page each = 502 potential nodes
    setNavigation(Array.from({ length: total }, (_, i) => ({ group: `Group ${i}`, pages: [`page-${i}`] })));
    for (let i = 0; i < total; i++) {
      mem.repoFiles.set(`page-${i}.mdx`, `# Page ${i}`);
    }

    await expect(runImport()).rejects.toMatchObject({ code: 'import:limit' });
    const groups = mem.rows.filter((row) => row.kind === 'GROUP');
    const pages = mem.rows.filter((row) => row.kind === 'PAGE');
    // Groups and leaves alternate, so half the node budget goes to each.
    expect(groups).toHaveLength(MAX_IMPORT_FILES / 2);
    expect(pages).toHaveLength(MAX_IMPORT_FILES / 2);
    expect(mem.rows).toHaveLength(MAX_IMPORT_FILES);
    expect(promoteImportReplacementBranch).not.toHaveBeenCalled();
  });
});
