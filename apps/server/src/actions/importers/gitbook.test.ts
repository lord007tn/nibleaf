import type { GitbookImportBody } from '@nibleaf/validators';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportSummary } from './types';

/**
 * Importer-level tests for the GitBook repository walk. GitHub access and page
 * persistence are replaced with in-memory fakes so these run without a
 * database or network.
 */

const mem = vi.hoisted(() => ({
  rows: [] as Array<{
    id: string;
    kind: 'GROUP' | 'PAGE';
    parentId: string | null;
    slug: string;
    title: string;
    content?: string;
    description?: string;
    config?: Record<string, unknown>;
    hidden?: boolean;
    position?: number;
  }>,
  nextId: 1,
  repoFiles: new Map<string, string>(),
  failing: new Set<string>(),
  reset() {
    this.rows.length = 0;
    this.nextId = 1;
    this.repoFiles.clear();
    this.failing.clear();
  },
}));

vi.mock('@nibleaf/database', () => ({ prisma: { branch: { deleteMany: vi.fn(async () => ({ count: 1 })) } } }));
vi.mock('../branches', () => ({
  captureImportDraft: vi.fn(async () => 'snapshot'),
  createImportReplacementBranch: vi.fn(async () => ({ id: 'import-branch' })),
  promoteImportReplacementBranch: vi.fn(async () => ({})),
}));
vi.mock('../projects', () => ({ assertProjectInOrg: vi.fn(async () => ({ id: 'project', config: null })) }));
vi.mock('../assets', () => ({ findImportedAsset: vi.fn(async () => ({ url: 'https://cdn.example/stored.png' })), storeAsset: vi.fn() }));
vi.mock('./github', () => ({
  getGitHubDefaultBranch: async () => 'main',
  getGitHubSnapshot: async () => ({ revision: 'pinned-commit', files: [...mem.repoFiles.keys()].map((path) => ({ path, type: 'blob' as const })) }),
  getGitHubTextFile: async (_owner: string, _name: string, _branch: string, path: string) => {
    expect(_branch).toBe('pinned-commit');
    return mem.failing.has(path) ? null : (mem.repoFiles.get(path) ?? null);
  },
  githubRawUrl: (_owner: string, _name: string, _branch: string, path: string) =>
    `https://raw.githubusercontent.com/acme/docs/main/${path.split('/').map(encodeURIComponent).join('/')}`,
}));
vi.mock('./persistence', () => ({
  defaultImportTarget: async (projectId: string) => ({ projectId, branchId: 'branch', languageId: 'lang-en' }),
  removeImportPlaceholders: async () => 0,
  ensureGroupPage: async (_target: unknown, group: { parentId: string | null; title: string; slug: string; position?: number }) => {
    const found = mem.rows.find((row) => row.kind === 'GROUP' && row.parentId === group.parentId && row.slug === group.slug);
    if (found) return found.id;
    const row = { id: `row-${mem.nextId++}`, kind: 'GROUP' as const, ...group };
    mem.rows.push(row);
    return row.id;
  },
  upsertPage: async (
    _target: unknown,
    page: { parentId: string | null; slug: string; title: string; content: string; config?: Record<string, unknown>; hidden?: boolean },
  ) => {
    const found = mem.rows.find((row) => row.kind === 'PAGE' && row.parentId === page.parentId && row.slug === page.slug);
    if (found) {
      Object.assign(found, page);
      return { outcome: 'updated' as const, id: found.id };
    }
    const row = { id: `row-${mem.nextId++}`, kind: 'PAGE' as const, ...page };
    mem.rows.push(row);
    return { outcome: 'imported' as const, id: row.id };
  },
}));

import { promoteImportReplacementBranch } from '../branches';
import { gitbookImporter } from './gitbook';

const runImport = (input: Partial<GitbookImportBody> = {}): Promise<ImportSummary> =>
  gitbookImporter.run({ organizationId: 'org', projectId: 'project', input: { repo: 'acme/docs', branch: 'main', ...input } as GitbookImportBody });

const page = (slug: string) => mem.rows.find((row) => row.slug === slug);

beforeEach(() => {
  vi.clearAllMocks();
  mem.reset();
});

describe('gitbook importer', () => {
  it('imports a Git Sync space with nested pages, sections, blocks, links, images, and redirects', async () => {
    mem.repoFiles.set('.gitbook.yaml', 'root: ./docs/\nredirects:\n  old-setup: guides/setup.md\n');
    mem.repoFiles.set(
      'docs/SUMMARY.md',
      '# Table of contents\n\n* [Welcome](README.md)\n\n## Guides\n\n* [Guides](guides/README.md)\n  * [Setup](guides/setup.md "Set up")\n',
    );
    mem.repoFiles.set('docs/README.md', '---\ndescription: Start here\n---\n\n# Welcome\n\nSee [setup](guides/setup.md#install).\n');
    mem.repoFiles.set('docs/guides/README.md', '# Guides\n\n{% content-ref url="setup.md" %}\n[setup.md](setup.md)\n{% endcontent-ref %}\n');
    mem.repoFiles.set(
      'docs/guides/setup.md',
      '---\nhidden: true\nlayout:\n  width: wide\n---\n\n# Setting up\n\n{% hint style="warning" %}\nBack up first.\n{% endhint %}\n\n<figure><img src="../.gitbook/assets/image (1).png" alt="Screen"><figcaption><p>The screen</p></figcaption></figure>\n\n{% include "../.gitbook/includes/support.md" %}\n',
    );
    mem.repoFiles.set('docs/.gitbook/assets/image (1).png', 'binary');
    mem.repoFiles.set('docs/.gitbook/includes/support.md', '---\ntitle: Support\n---\n\nContact support.');

    const summary = await runImport();

    expect(summary).toMatchObject({ imported: 3, updated: 0, skipped: 0, assetsImported: 0, assetsSkipped: 0 });
    expect(page('welcome')).toMatchObject({ parentId: null, title: 'Welcome', description: 'Start here', position: 0 });
    expect(page('welcome')?.content).toBe('See [setup](/guides/setup#install).');

    const guides = page('guides');
    expect(guides).toMatchObject({ parentId: null, config: { category: 'Guides', categoryOrder: 1 }, position: 1 });
    expect(guides?.content).toBe('<Card title="setup.md" href="/guides/setup"></Card>');

    const setup = page('setup');
    expect(setup).toMatchObject({
      parentId: guides?.id,
      title: 'Setting up',
      hidden: true,
      config: { sidebarTitle: 'Set up', mode: 'wide' },
    });
    expect(setup?.content).toBe(
      '<Warning>\n\nBack up first.\n\n</Warning>\n\n<Frame caption="The screen">\n\n![Screen](https://cdn.example/stored.png)\n\n</Frame>\n\nContact support.',
    );

    expect(promoteImportReplacementBranch).toHaveBeenCalledWith(
      'project',
      'import-branch',
      {
        redirects: [{ from: '/old-setup', to: '/guides/setup' }],
      },
      'snapshot',
    );
  });

  it('infers navigation from folders when SUMMARY.md is absent', async () => {
    mem.repoFiles.set('README.md', '# Home\n');
    mem.repoFiles.set('reference/api.md', '# API\n');
    const summary = await runImport();
    expect(summary.imported).toBe(2);
    expect(summary.warnings).toContain('No SUMMARY.md found — navigation was inferred from folders and file names.');
    const group = mem.rows.find((row) => row.kind === 'GROUP');
    expect(group).toMatchObject({ slug: 'reference', title: 'Reference' });
    expect(page('api')).toMatchObject({ parentId: group?.id, title: 'API' });
  });

  it('keeps links and redirects off pages that could not be downloaded', async () => {
    mem.repoFiles.set('.gitbook.yaml', 'redirects:\n  old: broken.md\n');
    mem.repoFiles.set('SUMMARY.md', '* [Home](README.md)\n* [Broken](broken.md)\n');
    mem.repoFiles.set('README.md', '# Home\n\nSee [broken](broken.md).\n');
    mem.repoFiles.set('broken.md', '# Broken\n');
    mem.failing.add('broken.md');

    await expect(runImport({ replaceExisting: true })).rejects.toThrow(/source content is missing/);
    expect(promoteImportReplacementBranch).not.toHaveBeenCalled();
  });

  it('rejects repositories without any GitBook content', async () => {
    mem.repoFiles.set('src/index.ts', 'export {};');
    await expect(runImport()).rejects.toThrow(/GitBook Git Sync repository/);
    expect(promoteImportReplacementBranch).not.toHaveBeenCalled();
  });
});

it.each([true, false])('does not promote when all source pages fail (replace=%s)', async (replaceExisting) => {
  mem.repoFiles.set('README.md', '# Home');
  mem.failing.add('README.md');
  await expect(runImport({ replaceExisting })).rejects.toThrow(/source content is missing/);
  expect(promoteImportReplacementBranch).not.toHaveBeenCalled();
});

it('does not promote when reusable source is unavailable', async () => {
  mem.repoFiles.set('README.md', '# Home\n\n{% include "missing.md" %}');
  await expect(runImport({ replaceExisting: true })).rejects.toThrow(/source content is missing/);
  expect(promoteImportReplacementBranch).not.toHaveBeenCalled();
});

it('does not promote when SUMMARY references an absent source file', async () => {
  mem.repoFiles.set('SUMMARY.md', '* [Absent](absent.md)');
  await expect(runImport({ replaceExisting: true })).rejects.toThrow(/source content is missing/);
  expect(promoteImportReplacementBranch).not.toHaveBeenCalled();
});

it('stops include budget overruns before promotion', async () => {
  mem.repoFiles.set('README.md', `# Home\n\n${'{% include "part.md" %}'.repeat(10_001)}`);
  mem.repoFiles.set('part.md', 'text');
  await expect(runImport({ replaceExisting: true })).rejects.toThrow(/include budget/);
  expect(promoteImportReplacementBranch).not.toHaveBeenCalled();
});

it('rejects an oversized expanded page before conversion or promotion', async () => {
  mem.repoFiles.set('README.md', '# Home\n\n{% include "part.md" %}{% include "part.md" %}');
  mem.repoFiles.set('part.md', 'x'.repeat(1024 * 1024 + 1));
  await expect(runImport()).rejects.toMatchObject({ code: 'import:limit', details: { path: 'README.md' } });
  expect(mem.rows).toHaveLength(0);
  expect(promoteImportReplacementBranch).not.toHaveBeenCalled();
});
it('names a missing navigation file', async () => {
  mem.repoFiles.set('SUMMARY.md', '* [Missing](missing.md)');
  await expect(runImport()).rejects.toMatchObject({ details: { path: 'missing.md' } });
});

it('reports the unchanged navigation limit before promotion', async () => {
  for (let index = 0; index < 501; index++) mem.repoFiles.set(`p${index}.md`, `# Page ${index}`);
  mem.repoFiles.set('SUMMARY.md', Array.from({ length: 501 }, (_, index) => `* [Page ${index}](p${index}.md)`).join('\n'));
  await expect(runImport()).rejects.toMatchObject({ code: 'import:limit', details: { limit: 500 } });
  expect(promoteImportReplacementBranch).not.toHaveBeenCalled();
});
