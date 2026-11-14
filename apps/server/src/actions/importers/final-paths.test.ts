import { findBrokenInternalLinks, pageContentFacts } from '@nibleaf/shared/publish-checks';
import type { SiteSnapshot, SnapshotPage } from '@nibleaf/shared/site';
import { createLinkResolver } from '@nibleaf/shared/site-links';
import MarkdownIt from 'markdown-it';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { componentLinkFixtures } from './fixtures/component-links';
import { extendedImportWrappers } from './fixtures/link-discovery-extended';
import { linkDiscoveryRepros } from './fixtures/link-discovery-repros';
import { traceLinkDiscovery } from './fixtures/link-discovery-trace';
import { rewriteMainInternalLinks } from './fixtures/page-links.main-reference';
import { convertGitBookMarkdown } from './gitbook-markdown';
import { rewriteMintlifyInternalLinks } from './mintlify-links';
import { normalizeMintlifyMdx } from './mintlify-mdx';

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
      const content = `# Section\n\n[Top](/api)\n\n[Relative](quickstart#section)\n\n[Index](index.md#section)\n\n[Deep](deep#section)\n\n[Group](/getting-started)\n\n<Card href="/${code}/quickstart#section" title="Start" />\n\n[Public](/getting-started/quickstart#section)\n\n[App](https://nibleaf.com/pages/getting-started/quickstart#section)`;
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
      `# Section\n\n[Top](../api.md)\n\n[Index](index.md#section)\n\n[Self](quickstart.md?lang=${code}#section)\n\n<Card href="/guides/quickstart.md#section" title="Start" />`,
    );
    // No SUMMARY: inference creates a real group rather than a virtual section.
    for (const suffix of [2, 3]) {
      await run(gitbookImporter);
      assertPublishable();
      const page = mem.rows.find((row) => row.path === `guides-2/quickstart-${suffix}`);
      expect(page).toBeDefined();
      expect(page?.content).toContain(`[Top](/api-${suffix})`);
      expect(mem.rows.find((row) => row.path === `api-${suffix}`)?.content).toContain('[Group](/guides)');
    }
  });
});

const rendered = (sourcePath: string, type: string, attribute: string): Array<string | null> => {
  const source = mem.rows.find((row) => row.path === sourcePath);
  expect(source).toBeDefined();
  return new MarkdownIt({ html: true })
    .parse(source?.content ?? '', {})
    .flatMap((token) => token.children ?? [])
    .filter((token) => token.type === type)
    .map((token) => token.attrGet(attribute));
};

const assertExactTarget = (sourcePath: string, href: string, targetPath: string) => {
  const site = snapshot();
  const source = site.pages.find((page) => page.path === sourcePath);
  const target = site.pages.find((page) => page.path === targetPath);
  if (!source || !target) throw new Error('Fixture source or target missing');
  expect(target.kind).toBe('PAGE');
  expect(createLinkResolver(site)(href, source)).toMatchObject({ id: target.id, path: targetPath, kind: 'PAGE' });
  expect(findBrokenInternalLinks(site)).toEqual([]);
};
describe('independent adversarial probes', () => {
  it('Mintlify: source document and group share an alias', async () => {
    mem.files.set(
      'docs.json',
      JSON.stringify({ navigation: { pages: ['intro', 'getting-started', { group: 'Getting Started', pages: ['quickstart'] }] } }),
    );
    mem.files.set('intro.mdx', '[Original document](/getting-started)');
    mem.files.set('getting-started.mdx', '# Original source document');
    mem.files.set('quickstart.mdx', '# Quickstart');
    await run(mintlifyImporter);
    expect(mem.rows.find((row) => row.path === 'intro')?.content).toBe('[Original document](/getting-started)');
    assertExactTarget('intro', '/getting-started', 'getting-started');
  });
  it.each(['mintlify', 'gitbook'])('%s: image reference definitions retain image destinations', async (kind) => {
    const mintlify = kind === 'mintlify';
    seed('getting-started', 'PAGE');
    if (mintlify)
      mem.files.set(
        'docs.json',
        JSON.stringify({ navigation: { pages: ['intro', { group: 'Getting Started', pages: ['getting-started/quickstart'] }] } }),
      );
    const body = '![Existing screenshot][shot]\n\n[shot]: /getting-started "Existing screenshot"';
    mem.files.set(`intro.${mintlify ? 'mdx' : 'md'}`, body);
    mem.files.set(`getting-started/quickstart.${mintlify ? 'mdx' : 'md'}`, '# Quickstart');
    await run(mintlify ? mintlifyImporter : gitbookImporter);
    expect(mem.rows.find((row) => row.path === 'intro')?.content).toBe(body);
    expect(rendered('intro', 'image', 'src')).toEqual(['/getting-started']);
    assertExactTarget('intro', '/getting-started', 'getting-started');
  });
  it.each(['mintlify', 'gitbook'])('%s: existing site page outside imported sources stays the target', async (kind) => {
    const mintlify = kind === 'mintlify';
    seed('getting-started', 'PAGE');
    if (mintlify)
      mem.files.set('docs.json', JSON.stringify({ navigation: { pages: ['intro', { group: 'Getting Started', pages: ['quickstart'] }] } }));
    mem.files.set(`intro.${mintlify ? 'mdx' : 'md'}`, '[Existing site onboarding](/getting-started)');
    mem.files.set(mintlify ? 'quickstart.mdx' : 'getting-started/quickstart.md', '# Imported quickstart');
    await run(mintlify ? mintlifyImporter : gitbookImporter);
    expect(mem.rows.find((row) => row.path === 'intro')?.content).toBe('[Existing site onboarding](/getting-started)');
    assertExactTarget('intro', '/getting-started', 'getting-started');
  });
});

describe('source identity and reference ownership', () => {
  it('GitBook: the root readme source and an inferred Readme group keep separate identities', async () => {
    mem.files.set('readme.md', '# Original source document');
    mem.files.set('intro.md', '[Original document](/readme.md)\n\n[Relative](./readme.md)');
    mem.files.set('readme/quickstart.md', '# Quickstart');
    await run(gitbookImporter);
    expect(rendered('intro', 'link_open', 'href')).toEqual(['/introduction', '/introduction']);
    assertExactTarget('intro', '/introduction', 'introduction');
    expect(mem.rows.find((row) => row.path === 'introduction')?.content).toBe('');
  });

  it.each([
    ['mintlify', false],
    ['mintlify', true],
    ['gitbook', false],
    ['gitbook', true],
  ] as const)('%s: a definition used by an image (shared=%s) keeps its target', async (kind, shared) => {
    const mintlify = kind === 'mintlify';
    const parent = seed('getting-started', 'PAGE');
    seed('quickstart', 'PAGE', 'en', mintlify ? undefined : parent);
    if (mintlify)
      mem.files.set('docs.json', JSON.stringify({ navigation: { pages: ['intro', { group: 'Getting Started', pages: ['quickstart'] }] } }));
    const existingPath = mintlify ? 'quickstart' : 'getting-started/quickstart';
    const sourceLink = mintlify ? './quickstart' : './getting-started/quickstart.md';
    const body = `![Screenshot][shot]\n\n${shared ? '[Shared link][shot]\n\n' : ''}[Imported document](${sourceLink})\n\n[shot]: /${existingPath} "Screenshot"`;
    mem.files.set(`intro.${mintlify ? 'mdx' : 'md'}`, body);
    mem.files.set(mintlify ? 'quickstart.mdx' : 'getting-started/quickstart.md', '# Imported quickstart');
    await run(mintlify ? mintlifyImporter : gitbookImporter);
    expect(rendered('intro', 'image', 'src')).toEqual([`/${existingPath}`]);
    expect(rendered('intro', 'link_open', 'href')).toEqual([...(shared ? [`/${existingPath}`] : []), '/getting-started-2/quickstart']);
    assertExactTarget('intro', `/${existingPath}`, existingPath);
    assertExactTarget('intro', '/getting-started-2/quickstart', 'getting-started-2/quickstart');
  });
});

describe('main discovery preserves reference definitions and literal lines', () => {
  const cases = [
    ['audit repro', ''],
    ['invalid definition with trailing text', '[also-not]: /topic/next "Quoted" extra text'],
    ['fenced and indented definitions', '```md\n[code]: /topic/next "Code"\n```\n\n    [indented]: /topic/next "Indented"'],
    [
      'escaped definitions, inline code and attribute text',
      '\\[escaped]: /topic/next\n\n\\[Escaped](/topic/next)\n\n`[Code](/topic/next)`\n\n<span title="[Attribute](/topic/next)">Example</span>\n\n<span title=\'href="/topic/next"\'>Example</span>\n\n<span href="/topic/next">Plain span</span>',
    ],
    ['valid definition with a quoted title', '[Reference][valid]\n\n[valid]: /topic/next "Quoted title"'],
    ['valid image definition', '![Image][shot]\n\n[shot]: /topic/next "Existing screenshot"'],
  ] as const;
  for (const kind of ['mintlify', 'gitbook'] as const) {
    it.each(cases)(`${kind}: %s alongside the literal repro`, async (_name, fragment) => {
      const mintlify = kind === 'mintlify';
      const topic = seed('topic', 'PAGE');
      seed('next', 'PAGE', 'en', topic);
      if (mintlify) mem.files.set('docs.json', JSON.stringify({ navigation: { pages: ['intro', { group: 'Topic', pages: ['topic/next'] }] } }));
      const literal = 'Literal example:\n\n[not-a-definition]: /topic/next extra text';
      const body = [literal, fragment, '[Go](/topic/next)'].filter(Boolean).join('\n\n');
      const converted = mintlify ? body : convertGitBookMarkdown(body, { resolveFile: () => undefined }).content;
      const mapped = rewriteMainInternalLinks(converted, 'intro', new Map([['topic/next', '/topic-2/next']]));
      const expected = mintlify ? normalizeMintlifyMdx(mapped) : mapped;
      mem.files.set(`intro.${mintlify ? 'mdx' : 'md'}`, body);
      mem.files.set(`topic/next.${mintlify ? 'mdx' : 'md'}`, 'Destination.');
      await run(mintlify ? mintlifyImporter : gitbookImporter);
      expect(mem.rows.find((row) => row.path === 'intro')?.content).toBe(expected);
      assertExactTarget('intro', '/topic-2/next', 'topic-2/next');
      if (_name === 'valid image definition') {
        expect(rendered('intro', 'image', 'src')).toEqual(['/topic/next']);
        assertExactTarget('intro', '/topic/next', 'topic/next');
      }
    });
  }
});

describe('component children retain main link destinations', () => {
  for (const kind of ['mintlify', 'gitbook'] as const) {
    it.each(componentLinkFixtures)(`${kind}: $name`, async ({ content }) => {
      const mintlify = kind === 'mintlify';
      if (mintlify) mem.files.set('docs.json', JSON.stringify({ navigation: { pages: ['intro', { group: 'Topic', pages: ['next'] }] } }));
      else {
        mem.files.set('SUMMARY.md', '* [Intro](intro.md)\n* [Topic](topic.md)\n  * [Next](next.md)');
        mem.files.set('topic.md', 'Topic.');
      }
      mem.files.set(`intro.${mintlify ? 'mdx' : 'md'}`, content);
      mem.files.set(`next.${mintlify ? 'mdx' : 'md'}`, 'Destination.');
      const converted = mintlify ? content : convertGitBookMarkdown(content, { resolveFile: () => undefined }).content;
      const main = rewriteMainInternalLinks(converted, 'intro', new Map([['next', '/topic/next']]));
      const expected = mintlify ? normalizeMintlifyMdx(main) : main;
      await run(mintlify ? mintlifyImporter : gitbookImporter);
      expect(mem.rows.find((row) => row.path === 'intro')?.content).toBe(expected);
      const page = snapshot().pages.find((row) => row.path === 'intro');
      if (!page) throw new Error('Missing imported intro');
      expect(pageContentFacts(page.content).links).toContain('/topic/next');
      expect(pageContentFacts(page.content).links).not.toContain('/next');
      assertExactTarget('intro', '/topic/next', 'topic/next');
    });
    it(`${kind}: follow-up - reference-style links preserve main's pre-dedup target`, async () => {
      const mintlify = kind === 'mintlify';
      seed('topic', mintlify ? 'PAGE' : 'GROUP');
      if (mintlify) mem.files.set('docs.json', JSON.stringify({ navigation: { pages: ['intro', { group: 'Topic', pages: ['next'] }] } }));
      else {
        mem.files.set('SUMMARY.md', '* [Intro](intro.md)\n* [Topic](topic.md)\n  * [Next](next.md)');
        mem.files.set('topic.md', 'Topic.');
      }
      const source = '[Go][r]\n\n[r]: /topic/next "Title"';
      mem.files.set(`intro.${mintlify ? 'mdx' : 'md'}`, source);
      mem.files.set(`next.${mintlify ? 'mdx' : 'md'}`, 'Destination.');
      await run(mintlify ? mintlifyImporter : gitbookImporter);
      const stored = mem.rows.find((row) => row.path === 'intro')?.content;
      const main = rewriteMainInternalLinks(
        source,
        'intro',
        new Map([
          ['topic/next', '/topic-2/next'],
          ['next', '/topic-2/next'],
        ]),
      );
      expect(main).toBe(source);
      expect(stored).toBe(main);
      expect(mem.rows.find((row) => row.path === 'topic-2/next')?.content).toBe('Destination.');
      expect(pageContentFacts(stored ?? '').links).toEqual(['/topic/next']);
      expect(findBrokenInternalLinks(snapshot())).toHaveLength(1);
      console.info('deferred reference definition', { kind, main, head: stored });
    });
  }
});

// Seed and wrapper matrix from the independent round-5 review.
it('independent generated collision imports across all containers', async () => {
  let state = 0x66_36_18;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  const wrappers: Array<readonly [string, string]> = [
    ['', ''],
    ['<Steps><Step>', '</Step></Steps>'],
    ['<Steps>\n<Step>\n', '\n</Step>\n</Steps>'],
    ['<Note>\n', '\n</Note>'],
    ['<Card\n href="/next"\n>\n', '\n</Card>'],
    ['<Note>\n<div>\n', '\n</div>\n</Note>'],
    ['<Note>\n<section>\n', '\n</section>\n</Note>'],
    ['> ', ''],
    ['- ', ''],
    ['| Text |\n| --- |\n| ', ' |'],
    ['<Unknown.Widget>\n', '\n</Unknown.Widget>'],
    ['<Columns>\n  <Note>\n    ', '\n  </Note>\n</Columns>'],
    ['<Note\n title="Hello"\n>\n', '\n</Note>'],
    ['<Card href="/next" />\n<Note>\n', '\n</Note>'],
  ];
  const failures: Array<{
    kind: string;
    i: number;
    collision: boolean;
    aTarget: string;
    bTarget: string;
    source: string;
    expected: string;
    stored: string;
  }> = [];
  let codeChanges = 0;
  let cases = 0;
  for (const kind of ['mintlify', 'gitbook'] as const)
    for (let i = 0; i < 128; i++) {
      mem.rows = [];
      mem.files.clear();
      mem.next = 0;
      mem.language = 'en';
      const mintlify = kind === 'mintlify';
      const collision = i % 2 === 1;
      if (collision) seed('topic', mintlify ? 'PAGE' : 'GROUP');
      if (mintlify)
        mem.files.set('docs.json', JSON.stringify({ navigation: { pages: ['docs/intro', { group: 'Topic', pages: ['next', 'other/next'] }] } }));
      else {
        mem.files.set('SUMMARY.md', '* [Intro](docs/intro.md)\n* [Topic](topic.md)\n  * [A](next.md)\n  * [B](other/next.md)');
        mem.files.set('topic.md', 'Topic.');
      }
      const [a, b] = wrappers[next() % wrappers.length] ?? ['', ''];
      const suffix = ['', '#part', '?x=1#part'][next() % 3];
      const source =
        a +
        `[Go](/next${suffix}) [Other](/other/next${suffix}) [Up](../next${suffix}) [External](https://example.test/next) [Anchor](#part)` +
        b +
        '\n\n[Reference][ref]\n\n[ref]: /next "Title"\n\n`[Code](/next)`\n\n~~~md\n[Code](/next)\n~~~\n\n<Note>\n~~~md\n[Code](/other/next)\n~~~\n</Note>\n\nExample:\n\n    [Code](/next)';
      mem.files.set(`docs/intro.${mintlify ? 'mdx' : 'md'}`, source);
      mem.files.set(`next.${mintlify ? 'mdx' : 'md'}`, 'TARGET_A.');
      mem.files.set(`other/next.${mintlify ? 'mdx' : 'md'}`, 'TARGET_B.');
      await run(mintlify ? mintlifyImporter : gitbookImporter);
      const stored = mem.rows.find((row) => row.path === 'intro')?.content;
      const aTarget = mem.rows.find((row) => row.content === 'TARGET_A.');
      const bTarget = mem.rows.find((row) => row.content === 'TARGET_B.');
      if (!aTarget || !bTarget || stored === undefined) throw new Error('Missing generated fixture pages');
      const routes = new Map([
        ['next', `/${aTarget.path}`],
        ['other/next', `/${bTarget.path}`],
      ]);
      const converted = mintlify ? source : convertGitBookMarkdown(source, { resolveFile: () => undefined }).content;
      const mainTrace = traceLinkDiscovery(rewriteMainInternalLinks, converted, 'docs/intro', routes);
      const headTrace = traceLinkDiscovery(rewriteMintlifyInternalLinks, converted, 'docs/intro', routes);
      expect(headTrace.visits).toEqual(mainTrace.visits);
      expect(headTrace.reports).toEqual(expect.arrayContaining(mainTrace.reports));
      let expected = mainTrace.output;
      if (mintlify) expected = normalizeMintlifyMdx(expected);
      if (stored !== expected) failures.push({ kind, i, collision, aTarget: aTarget.path, bTarget: bTarget.path, source, expected, stored });
      if (
        !stored.includes('`[Code](/next)`') ||
        !stored.includes('~~~md\n[Code](/next)\n~~~') ||
        !stored.includes('~~~md\n[Code](/other/next)\n~~~') ||
        !stored.includes('    [Code](/next)')
      )
        codeChanges++;
      cases++;
    }
  console.info('seeded full imports', { seed: '0x663618', cases, misses: failures.length, codeChanges });
  expect(failures.slice(0, 1)).toEqual([]);
  expect(codeChanges).toBe(0);
}, 60_000);

describe('lowercase HTML children through both importers', () => {
  for (const kind of ['mintlify', 'gitbook'] as const) {
    it.each([false, true])(`${kind}: lowercase wrappers, collision=%s`, async (collision) => {
      const mintlify = kind === 'mintlify';
      if (collision) seed('topic', mintlify ? 'PAGE' : 'GROUP');
      if (mintlify) mem.files.set('docs.json', JSON.stringify({ navigation: { pages: ['intro', { group: 'Topic', pages: ['next'] }] } }));
      else {
        mem.files.set('SUMMARY.md', '* [Intro](intro.md)\n* [Topic](topic.md)\n  * [Next](next.md)');
        mem.files.set('topic.md', 'Topic.');
      }
      const content = '<Note>\n<div>\n[Go](/next?x=1#part)\n</div>\n</Note>';
      mem.files.set(`intro.${mintlify ? 'mdx' : 'md'}`, content);
      mem.files.set(`next.${mintlify ? 'mdx' : 'md'}`, '## Part');
      await run(mintlify ? mintlifyImporter : gitbookImporter);
      const destination = `${collision ? 'topic-2' : 'topic'}/next`;
      expect(mem.rows.find((row) => row.path === 'intro')?.content).toContain(`[Go](/${destination}?x=1#part)`);
      assertExactTarget('intro', `/${destination}?x=1#part`, destination);
      expect(findBrokenInternalLinks(snapshot())).toEqual([]);
    });
  }
});

describe('round 6: full-import discovery matches main with and without collisions', () => {
  const shapes = linkDiscoveryRepros.filter((repro) => repro.name.startsWith('round 6:'));
  for (const kind of ['mintlify', 'gitbook'] as const)
    for (const collision of [false, true]) {
      it.each(shapes)(`${kind}, collision=${collision}: $name`, async ({ content }) => {
        const mintlify = kind === 'mintlify';
        if (collision) seed('topic', mintlify ? 'PAGE' : 'GROUP');
        if (mintlify) mem.files.set('docs.json', JSON.stringify({ navigation: { pages: ['intro', { group: 'Topic', pages: ['next'] }] } }));
        else {
          mem.files.set('SUMMARY.md', '* [Intro](intro.md)\n* [Topic](topic.md)\n  * [Next](next.md)');
          mem.files.set('topic.md', 'Topic.');
        }
        mem.files.set(`intro.${mintlify ? 'mdx' : 'md'}`, content);
        mem.files.set(`next.${mintlify ? 'mdx' : 'md'}`, '## Part');
        await run(mintlify ? mintlifyImporter : gitbookImporter);
        const target = collision ? '/topic-2/next' : '/topic/next';
        const converted = mintlify ? content : convertGitBookMarkdown(content, { resolveFile: () => undefined }).content;
        const main = traceLinkDiscovery(rewriteMainInternalLinks, converted, 'intro', new Map([['next', target]]));
        const head = traceLinkDiscovery(rewriteMintlifyInternalLinks, converted, 'intro', new Map([['next', target]]));
        expect(head.visits).toEqual(main.visits);
        const expected = mintlify ? normalizeMintlifyMdx(main.output) : main.output;
        expect(mem.rows.find((row) => row.path === 'intro')?.content).toBe(expected);
        expect(expected).toContain(`[Go](${target}?x=1#part)`);
        assertExactTarget('intro', `${target}?x=1#part`, target.slice(1));
        const missing = content.replaceAll('/next', '/missing');
        const missedMain = traceLinkDiscovery(rewriteMainInternalLinks, missing, 'intro', new Map());
        const missedHead = traceLinkDiscovery(rewriteMintlifyInternalLinks, missing, 'intro', new Map());
        expect(missedHead.visits).toEqual(missedMain.visits);
        expect(missedHead.reports).toEqual(expect.arrayContaining(missedMain.reports));
        expect(missedHead.reports).toContain('/missing?x=1#part');
      });
    }
});

it('round-6 reviewer extended matrix: 44 full imports have identical discovery offsets and code', async () => {
  let cases = 0;
  for (const kind of ['mintlify', 'gitbook'] as const)
    for (const collision of [false, true])
      for (const [open, close] of extendedImportWrappers) {
        mem.rows = [];
        mem.files.clear();
        mem.next = 0;
        mem.language = 'en';
        const mintlify = kind === 'mintlify';
        if (collision) seed('topic', mintlify ? 'PAGE' : 'GROUP');
        if (mintlify)
          mem.files.set('docs.json', JSON.stringify({ navigation: { pages: ['docs/intro', { group: 'Topic', pages: ['next', 'other/next'] }] } }));
        else {
          mem.files.set('SUMMARY.md', '* [Intro](docs/intro.md)\n* [Topic](topic.md)\n  * [A](next.md)\n  * [B](other/next.md)');
          mem.files.set('topic.md', 'Topic.');
        }
        const source = `${open}[Go](/next?x=1#part) [Other](/other/next) [Relative](../next#part) [External](https://example.test/next) [Anchor](#part)${close}\n\n\`[Code](/next)\`\n\n~~~md\n[Code](/next)\n~~~`;
        mem.files.set(`docs/intro.${mintlify ? 'mdx' : 'md'}`, source);
        mem.files.set(`next.${mintlify ? 'mdx' : 'md'}`, 'TARGET_A.');
        mem.files.set(`other/next.${mintlify ? 'mdx' : 'md'}`, 'TARGET_B.');
        await run(mintlify ? mintlifyImporter : gitbookImporter);
        const stored = mem.rows.find((row) => row.path === 'intro')?.content;
        const a = mem.rows.find((row) => row.content === 'TARGET_A.');
        const b = mem.rows.find((row) => row.content === 'TARGET_B.');
        if (!a || !b || stored === undefined) throw new Error('Missing fixture targets');
        const routes = new Map([
          ['next', `/${a.path}`],
          ['other/next', `/${b.path}`],
        ]);
        const converted = mintlify ? source : convertGitBookMarkdown(source, { resolveFile: () => undefined }).content;
        const main = traceLinkDiscovery(rewriteMainInternalLinks, converted, 'docs/intro', routes);
        const head = traceLinkDiscovery(rewriteMintlifyInternalLinks, converted, 'docs/intro', routes);
        expect(head.visits).toEqual(main.visits);
        expect(head.reports).toEqual(expect.arrayContaining(main.reports));
        expect(stored).toBe(mintlify ? normalizeMintlifyMdx(main.output) : main.output);
        expect(stored).toContain('`[Code](/next)`');
        expect(stored).toContain('~~~md\n[Code](/next)\n~~~');
        cases++;
      }
  expect(cases).toBe(44);
  console.info('reviewer extended imports', { cases, offsetMismatches: 0, codeChanges: 0, reportLosses: 0, exceptions: [] });
}, 60_000);
