import { findBrokenInternalLinks, pageContentFacts } from '@nibleaf/shared/publish-checks';
import type { SiteSnapshot, SnapshotPage } from '@nibleaf/shared/site';
import { createLinkResolver } from '@nibleaf/shared/site-links';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Row {
  id: string;
  projectId: string;
  branchId: string;
  languageId: string;
  parentId: string | null;
  slug: string;
  path: string;
  title: string;
  kind: 'GROUP' | 'PAGE';
  content: string;
}

const mem = vi.hoisted(() => ({ rows: [] as Row[], files: new Map<string, string>(), next: 0, language: 'en' }));
const matches = (row: Row, where: Record<string, unknown>): boolean =>
  Object.entries(where).every(([key, value]) => {
    const actual = row[key as keyof Row];
    return typeof value === 'object' && value !== null && 'in' in value ? (value.in as unknown[]).includes(actual) : actual === value;
  });

vi.mock('@nibleaf/database', () => ({
  Prisma: {},
  prisma: {
    page: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => mem.rows.find((row) => matches(row, where)) ?? null,
      findMany: async ({ where }: { where: Record<string, unknown> }) => mem.rows.filter((row) => matches(row, where)),
      update: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
        const row = mem.rows.find((candidate) => matches(candidate, where));
        if (!row) throw new Error('Scoped page missing');
        Object.assign(row, data);
        return row;
      },
    },
    branch: { deleteMany: vi.fn(async () => ({ count: 1 })) },
    language: {
      findUniqueOrThrow: async () => ({ code: mem.language }),
      findFirst: async ({ where }: { where: { code: { equals: string } } }) => ({ id: `lang-${where.code.equals}`, code: where.code.equals }),
    },
  },
}));
vi.mock('../pages', () => ({
  assertPageContentFits: (content: string) => {
    if (Buffer.byteLength(content) > 2 * 1024 * 1024) throw new Error('Content too large');
  },
  // Match createPage's sibling namespace, including collisions across PAGE/GROUP.
  createPage: async (projectId: string, body: Partial<Row> & Pick<Row, 'slug' | 'title' | 'branchId' | 'languageId'>) => {
    const parentId = body.parentId ?? null;
    const parent = mem.rows.find((row) => row.id === parentId);
    let slug = body.slug;
    let suffix = 2;
    while (mem.rows.some((row) => matches(row, { projectId, branchId: body.branchId, languageId: body.languageId, parentId, slug }))) {
      slug = `${body.slug}-${suffix++}`;
    }
    const row: Row = {
      kind: 'PAGE',
      content: '',
      ...body,
      projectId,
      parentId,
      slug,
      id: `row-${mem.next++}`,
      path: `${parent ? `${parent.path}/` : ''}${slug}`,
    };
    mem.rows.push(row);
    return row;
  },
}));
vi.mock('../branches', () => ({
  getDefaultBranch: async () => ({ id: 'main' }),
  captureImportDraft: async () => 'fingerprint',
  createImportReplacementBranch: async () => {
    const originals = mem.rows.filter((row) => row.branchId === 'main');
    const ids = new Map(originals.map((row) => [row.id, `row-${mem.next++}`]));
    mem.rows.push(
      ...originals.map((row) => {
        const id = ids.get(row.id);
        const parentId = row.parentId ? ids.get(row.parentId) : null;
        if (!id || parentId === undefined) throw new Error('Incomplete fixture fork');
        return { ...row, id, parentId, branchId: 'staging' };
      }),
    );
    return { id: 'staging' };
  },
  promoteImportReplacementBranch: async () => {
    mem.rows = mem.rows.filter((row) => row.branchId === 'staging');
    for (const row of mem.rows) row.branchId = 'main';
  },
}));
vi.mock('../languages', () => ({
  getDefaultLanguage: async () => ({ id: `lang-${mem.language}` }),
  updateLanguage: async (_project: string, id: string) => ({ id, code: id.slice(5) }),
}));
vi.mock('../projects', () => ({ assertProjectInOrg: async () => ({ id: 'project', config: null }) }));
vi.mock('./github', () => ({
  getGitHubDefaultBranch: async () => 'main',
  getGitHubSnapshot: async () => ({ revision: 'pinned', files: [...mem.files.keys()].map((path) => ({ path, type: 'blob' })) }),
  getGitHubTextFile: async (_owner: string, _repo: string, _ref: string, path: string) => mem.files.get(path) ?? null,
}));
vi.mock('./ghost-assets', () => ({
  RemoteAssetMigrator: class {
    migrated = 0;
    skipped = 0;
    async rewrite(content: string) {
      return content;
    }
  },
}));
vi.mock('./persistence', async (original) => ({
  ...(await original<typeof import('./persistence')>()),
  removeImportPlaceholders: async () => 0,
}));

import { gitbookImporter } from './gitbook';
import { mintlifyImporter } from './mintlify';

beforeEach(() => {
  mem.rows = [];
  mem.files.clear();
  mem.next = 0;
  mem.language = 'en';
});

const seed = (slug: string, kind: Row['kind'], language = 'en', parent?: Row, title = `Existing ${slug}`): Row => {
  const row: Row = {
    id: `row-${mem.next++}`,
    projectId: 'project',
    branchId: 'main',
    languageId: `lang-${language}`,
    parentId: parent?.id ?? null,
    slug,
    path: `${parent ? `${parent.path}/` : ''}${slug}`,
    title,
    kind,
    content: 'Existing body.',
  };
  mem.rows.push(row);
  return row;
};

const snapshot = (): SiteSnapshot => ({
  project: {
    id: 'project',
    name: 'Fictional docs',
    slug: 'docs',
    description: null,
    icon: null,
    config: null,
    languages: ['en', 'ar'].map((code) => ({
      code,
      label: code,
      direction: code === 'ar' ? 'RTL' : 'LTR',
      isDefault: code === mem.language,
      config: null,
    })),
    versions: [{ id: 'main', name: 'Latest', slug: 'latest', isDefault: true }],
  },
  pages: mem.rows.map(
    (row): SnapshotPage => ({
      ...row,
      versionId: 'main',
      languageCode: row.languageId.slice(5),
      updatedAt: '2026-11-14T00:00:00.000Z',
      position: 0,
      hidden: false,
      icon: null,
      description: null,
      config: null,
      translationKey: null,
    }),
  ),
  generatedAt: '2026-11-14T00:00:00.000Z',
});

const assertPublishable = () => {
  const site = snapshot();
  const resolve = createLinkResolver(site);
  let links = 0;
  for (const page of site.pages) {
    for (const link of pageContentFacts(page.content).links) {
      links++;
      expect(resolve(link, page), `${page.languageCode}/${page.path}: ${link}`).toBeTruthy();
    }
  }
  expect(links).toBeGreaterThan(5);
  expect(findBrokenInternalLinks(site)).toEqual([]);
};

const run = (importer: typeof mintlifyImporter | typeof gitbookImporter) =>
  importer.run({
    organizationId: 'org',
    projectId: 'project',
    input: { repo: 'fictional/docs', replaceExisting: false },
  });

// These exact bodies are also checked with the production sources from main.
const assertNoCollision = async (importer: typeof mintlifyImporter | typeof gitbookImporter) => {
  const mintlify = importer === mintlifyImporter;
  const body = '[Start](guides/quickstart#section)\n\n[Reference][start]\n\n[start]: guides/quickstart#section "Start"';
  if (mintlify)
    mem.files.set(
      'docs.json',
      JSON.stringify({ navigation: { pages: ['intro', { group: 'Guides', pages: ['guides/index', 'guides/quickstart'] }] } }),
    );
  mem.files.set(`intro.${mintlify ? 'mdx' : 'md'}`, body);
  mem.files.set(`guides/index.${mintlify ? 'mdx' : 'md'}`, '[Relative](quickstart.md#section)');
  mem.files.set(`guides/quickstart.${mintlify ? 'mdx' : 'md'}`, '## Section\n\nLiteral `[/old](/old)` stays.');
  await run(importer);
  expect(
    mem.rows
      .filter((row) => row.kind === 'PAGE')
      .map(({ path, content }) => ({ path, content }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  ).toEqual([
    { path: 'guides/index', content: '[Relative](/guides/quickstart#section)' },
    { path: 'guides/quickstart', content: '## Section\n\nLiteral `[/old](/old)` stays.' },
    { path: 'intro', content: body.replace('(guides/quickstart#section)', '(/guides/quickstart#section)') },
  ]);
  mem.rows = [];
  mem.files.clear();
};

describe('final imported destinations', () => {
  it('Mintlify: the audit starter collision rewrites links into a newly suffixed group', async () => {
    seed('getting-started', 'PAGE');
    mem.files.set(
      'docs.json',
      JSON.stringify({ navigation: [{ group: 'Getting Started', pages: ['getting-started/introduction', 'getting-started/quickstart'] }] }),
    );
    mem.files.set(
      'getting-started/introduction.mdx',
      '[Start](/getting-started/quickstart#section)\n\n<Card href="/getting-started/quickstart#section" title="Start" />\n\n[Group](/getting-started)',
    );
    mem.files.set(
      'getting-started/quickstart.mdx',
      '## Section\n\n[Intro](/getting-started/introduction)\n\n[Again](/getting-started/quickstart#section)\n\n[Group](/getting-started)',
    );
    await run(mintlifyImporter);
    expect(mem.rows.find((row) => row.path === 'getting-started-2/introduction')?.content).toContain('/getting-started-2/quickstart#section');
    assertPublishable();
  });

  it('Mintlify: final groups, nested and top-level pages, index, languages and a second import', async () => {
    await assertNoCollision(mintlifyImporter);
    for (const code of ['en', 'ar']) {
      seed('api', 'GROUP', code);
      seed('getting-started', 'PAGE', code);
      // Title matching must reuse an already suffixed group, including its edited children.
      const group = seed('getting-started-2', 'GROUP', code, undefined, 'Getting Started');
      seed('quickstart', 'GROUP', code, group);
      seed('nested', 'PAGE', code, group);
    }
    const nodes = (code: string) => [
      'api',
      { group: 'Getting Started', pages: [`${code}/index`, `${code}/quickstart`, { group: 'Nested', pages: [`${code}/deep`] }] },
    ];
    // Each language uses its own source prefix, including cross-language links.
    mem.files.set('docs.json', JSON.stringify({ navigation: { languages: ['en', 'ar'].map((code) => ({ language: code, pages: nodes(code) })) } }));
    mem.files.set('api.mdx', '# API\n\n[English](/en/quickstart#section)\n\n[Arabic](/ar/quickstart#section)');
    for (const code of ['en', 'ar']) {
      const content = `# Section\n\n[Top](/api)\n\n[Relative](quickstart#section)\n\n[Index](index.md#section)\n\n[Deep](deep#section)\n\n[Group](/getting-started)\n\n<Card href="/${code}/quickstart#section" title="Start" />\n\n[Public](/getting-started/quickstart#section)\n\n[App](https://nibleaf.com/pages/getting-started/quickstart#section)\n\n[Reference][start]\n\n[start]: /${code}/quickstart#section "Start"\n\n> [Quoted][quoted]\n>\n> [quoted]: </${code}/quickstart#section> "Quoted"`;
      for (const file of ['index', 'quickstart', 'deep']) mem.files.set(`${code}/${file}.mdx`, content);
    }
    for (const suffix of [2, 3]) {
      await run(mintlifyImporter);
      assertPublishable();
      for (const code of ['en', 'ar']) {
        const pages = mem.rows.filter((row) => row.languageId === `lang-${code}`);
        expect(pages.find((row) => row.path === `api-${suffix}`)?.content).toContain('/getting-started-2/quickstart-');
        expect(pages.find((row) => row.path === `getting-started-2/quickstart-${suffix}`)?.content).toContain(`[Top](/api-${suffix})`);
        expect(pages.find((row) => row.path === 'getting-started-2/nested-2/deep')?.content).toContain('#section');
      }
    }
  });

  it.each(['en', 'ar'])('GitBook: final page/group routes, nested pages, index and repeated imports (%s)', async (code) => {
    await assertNoCollision(gitbookImporter);
    mem.language = code;
    seed('api', 'GROUP', code);
    seed('guides', 'PAGE', code);
    const group = seed('guides-2', 'GROUP', code, undefined, 'Guides');
    seed('quickstart', 'GROUP', code, group);
    mem.files.set('api.md', '# API\n\n[Start](guides/quickstart.md#section)\n\n[Group](/guides)');
    mem.files.set('guides/index.md', '# Section\n\n[Top](../api.md)\n\n[Start](quickstart.md#section)');
    mem.files.set(
      'guides/quickstart.md',
      `# Section\n\n[Top](../api.md)\n\n[Index](index.md#section)\n\n[Self](quickstart.md?lang=${code}#section)\n\n<Card href="/guides/quickstart.md#section" title="Start" />\n\n[Reference][start]\n\n[start]: quickstart.md#section "Start"\n\n> [Quoted][quoted]\n>\n> [quoted]:\n>   <quickstart.md#section> "Quoted"`,
    );
    // No SUMMARY: inference creates a real group rather than a virtual section.
    for (const suffix of [2, 3]) {
      await run(gitbookImporter);
      assertPublishable();
      const page = mem.rows.find((row) => row.path === `guides-2/quickstart-${suffix}`);
      expect(page).toBeDefined();
      expect(page?.content).toContain(`[Top](/api-${suffix})`);
      expect(page?.content).toContain(`[start]: /guides-2/quickstart-${suffix}#section "Start"`);
      expect(mem.rows.find((row) => row.path === `api-${suffix}`)?.content).toContain('[Group](/guides-2)');
    }
  });
});
