import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SiteSnapshot, SnapshotPage } from '@nibleaf/shared/site';
import { createLinkResolver } from '@nibleaf/shared/site-links';
import { describe, expect, it, vi } from 'vitest';
import { componentLinkFixtures } from './fixtures/component-links';
import { extendedImportWrappers } from './fixtures/link-discovery-extended';
import { linkDiscoveryRepros } from './fixtures/link-discovery-repros';
import { assertDefinitionDiscoveryDelta, traceLinkDiscovery, withMainLinkScanner } from './fixtures/link-discovery-trace';
import { rewriteMainInternalLinks } from './fixtures/page-links.main-reference';
import corpus from './fixtures/page-links-corpus.json';
import { convertGitBookMarkdown as convertHeadGitBookMarkdown } from './gitbook-markdown';
import { buildMintlifyLanguageRouteMaps, buildMintlifyRouteMap, mintlifyInternalLinkTargets, rewriteMintlifyInternalLinks } from './mintlify-links';
import { parseMintlifyLanguages } from './mintlify-mapping';
import { normalizeMintlifyMdx } from './mintlify-mdx';

// Linear corpus comparisons can exceed the five-second default on busy CI (#658).
// Growth files bound the cost independently of this assertion timeout.
vi.setConfig({ testTimeout: 60_000 });
const routes = new Map([
  ['next', '/topic/next'],
  ['topic/next', '/topic-2/next'],
  ['getting-started', '/getting-started-2'],
]);

const convertGitBookMarkdown = (source: string) => {
  const convert = () => convertHeadGitBookMarkdown(source, { resolveFile: () => undefined });
  const head = convert();
  expect(head, 'GitBook conversion and fidelity must equal main').toEqual(withMainLinkScanner(convert));
  return head;
};

const assertDiscoveryParity = (
  source: string,
  page: string,
  mapping: ReadonlyMap<string, string> = routes,
  options: Parameters<typeof rewriteMainInternalLinks>[3] = {},
) => {
  const main = traceLinkDiscovery(rewriteMainInternalLinks, source, page, mapping, options);
  const head = traceLinkDiscovery(rewriteMintlifyInternalLinks, source, page, mapping, options);
  const delta = assertDefinitionDiscoveryDelta(source, main, head);
  expect(rewriteMintlifyInternalLinks(source, page, mapping, options), `${page}: rewrite-only fast path`).toBe(delta.expected);
  return { main, head, ...delta };
};

describe('link discovery compatibility', () => {
  it('deduplication changes target strings at the same main offsets and leaves code literal', () => {
    const prose = '<Note>\n<div title="[Example](/next)">\n[^f]\n\n[^f]: [Go](/next?x=1#part)\n</div>\n</Note>\n\n</code>\n\n[Again](/next)';
    const code = '\n\n`[Code](/next)`\n\n~~~md\n[Code](/next)\n~~~';
    const main = traceLinkDiscovery(rewriteMainInternalLinks, prose + code, 'intro', new Map([['next', '/topic/next']]));
    const head = traceLinkDiscovery(rewriteMintlifyInternalLinks, prose + code, 'intro', new Map([['next', '/topic-2/next']]));
    expect(head.visits).toEqual(main.visits);
    expect(main.output).toBe(prose.replaceAll('(/next', '(/topic/next') + code);
    expect(head.output).toBe(prose.replaceAll('(/next', '(/topic-2/next') + code);
    expect(head.reports).toEqual(main.reports);
  });
  it.each(linkDiscoveryRepros.map((fixture) => ({ ...fixture, label: fixture.name.replace(/^round[- ]\d+:\s*/i, '') })))(
    '$label: preserves reference offsets and reports',
    ({ content }) => {
      assertDiscoveryParity(content, 'intro', routes, { sourceUrl: 'https://help.test', languageCode: 'en' });
    },
  );
  it.each(componentLinkFixtures)('component compatibility: $name', ({ content }) => {
    assertDiscoveryParity(content, 'intro');
  });
  it('keeps an invalid definition byte-identical', () => {
    const source = '[x]: /topic/next extra text';
    const result = assertDiscoveryParity(source, 'intro');
    expect(result.main.output).toBe(source);
    expect(result.head.visits).toEqual([]);
  });
  it('records UTF-8 byte offsets after Arabic, emoji and excluded code', () => {
    const source = '\u0645\u0631\u062d\u0628\u0627 \u{1f331}\n\n`[Code](/next)`\n\n~~~md\n[Code](/next)\n~~~\n\n[Go](/next?x=1#part)';
    const { head } = assertDiscoveryParity(source, 'ar/intro');
    expect(head.visits).toEqual([
      { page: 'ar/intro', byteOffset: Buffer.byteLength(source.slice(0, source.lastIndexOf('/next'))), original: '/next?x=1#part' },
    ]);
  });
  it.each(['[', '[a](<b)'])('keeps main discovery linear on two MiB malformed input: %s', (unit) => {
    const source = unit.repeat(Math.ceil((2 * 1024 * 1024) / unit.length)).slice(0, 2 * 1024 * 1024);
    expect(rewriteMintlifyInternalLinks(source, 'intro', new Map())).toBe(source);
    expect(rewriteMintlifyInternalLinks(`${source}\n\n[Go](/next)`, 'intro', routes)).toBe(`${source}\n\n[Go](/topic/next)`);
  });
});

it.each(['mintlify', 'gitbook'] as const)('%s: 291-doc corpus, every earlier repro and same-offset discovery', (kind) => {
  const root = resolve(import.meta.dirname, '../../../../..');
  const docs = corpus.map((path) => ({ name: path, source: path.replace(/\.mdx?$/i, ''), content: readFileSync(resolve(root, path), 'utf8') }));
  const mappings = new Map(docs.map(({ source }, index) => [source, `/corpus/p${index}`]));
  const inputs = [
    ...docs,
    ...componentLinkFixtures.map((f) => ({ ...f, source: 'intro' })),
    ...linkDiscoveryRepros.map((f) => ({ ...f, source: 'intro' })),
  ];
  let destinations = 0;
  let rewrittenLinks = 0;
  let definitions = 0;
  for (const input of inputs) {
    const body = kind === 'mintlify' ? input.content : convertGitBookMarkdown(input.content).content;
    const observed = assertDiscoveryParity(body, input.source, input.source === 'intro' ? routes : mappings);
    const finish = kind === 'mintlify' ? normalizeMintlifyMdx : (value: string) => value;
    expect(finish(observed.head.output), input.name).toBe(finish(observed.expected));
    destinations += observed.head.visits.length;
    rewrittenLinks += observed.head.rewrites.length;
    definitions += observed.definitions;
  }
  console.info('corpus source-offset differential', {
    kind,
    repoDocs: docs.length,
    repros: linkDiscoveryRepros.length,
    componentFixtures: componentLinkFixtures.length,
    destinations,
    rewrittenLinks,
    offsetMismatches: 0,
    definitionVisits: definitions,
  });
});

// The independent reviewer's seeded wrapper/URL matrix, pinned for repeatability.
it('seed 0x663618: 512 documents retain every main rewrite and all code bytes', () => {
  let seed = 0x66_36_18;
  const rand = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return seed >>> 0;
  };
  const bodies = [
    '[Go](/next?x=1#part)',
    '[Relative](../next#part)',
    '[Other](/other/next)',
    '[External](https://example.com/next)',
    '[Anchor](#next)',
    '[Go](</next>)',
    '[Go][ref]\n\n[ref]: /next "Title"',
  ];
  const wrappers: Array<readonly [string, string]> = [
    ['', ''],
    ['<Steps><Step>', '</Step></Steps>'],
    ['<Steps>\n<Step>\n', '\n</Step>\n</Steps>'],
    ['<Note>\n', '\n</Note>'],
    ['<Card href="/next">\n', '\n</Card>'],
    ['<div>\n', '\n</div>'],
    ['<section>\n', '\n</section>'],
    ['> ', ''],
    ['- ', ''],
    ['| Text |\n| --- |\n| ', ' |'],
    ['<Unknown.Widget>\n', '\n</Unknown.Widget>'],
    ['<Columns>\n  <Note>\n    ', '\n  </Note>\n</Columns>'],
    ['<Note\n title="Hello"\n>\n', '\n</Note>'],
    ['<Card href="/next" />\n<Note>\n', '\n</Note>'],
  ];
  const failures: Array<{ i: number; source: string; main: string; head: string }> = [];
  let codeChanges = 0;
  let rewrittenLinks = 0;
  const routes = new Map([
    ['next', '/topic-2/next'],
    ['other/next', '/other-2/next'],
    ['intro', '/intro-2'],
  ]);
  for (let i = 0; i < 512; i++) {
    const [a, b] = wrappers[rand() % wrappers.length] ?? ['', ''];
    const body = bodies[rand() % bodies.length];
    const source = `${a + body + b}\n\n\`[Code](/next)\`\n\n~~~md\n[Code](/next)\n~~~\n\n[Sentinel](/next)`;
    const observed = assertDiscoveryParity(source, 'docs/intro', routes);
    rewrittenLinks += observed.head.rewrites.length;
    const expected = observed.expected;
    const actual = observed.head.output;
    if (!actual.includes('`[Code](/next)`') || !actual.includes('~~~md\n[Code](/next)\n~~~')) codeChanges++;
    if (actual !== expected) failures.push({ i, source, main: expected, head: actual });
  }
  console.info('seeded document differential', { seed: '0x663618', cases: 512, rewrittenLinks, misses: failures.length, codeChanges });
  expect(failures.slice(0, 1)).toEqual([]);
  expect(codeChanges).toBe(0);
});

it('seed 0x618663: fidelity reports equal main with and without rewrite candidates', () => {
  let state = 0x61_86_63;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  const urls = [
    'https://help.test//evil.test/next',
    'https://nibleaf.com/pages//evil.test/next',
    String.raw`https://help.test/\evil.test/next`,
    String.raw`https://nibleaf.com/pages/\evil.test/next`,
    String.raw`/\evil.test`,
    '/unmapped',
    '../missing.md',
    '/missing?lang=ar',
    'https://help.test/custom/hidden',
    'https://help.test/custom/hidden?lang=ar',
    '/next?lang=en&lang=ar',
    '/next?lang=',
    '/next',
    '#part',
    'https://example.test/external',
  ];
  const wrappers: Array<readonly [string, string]> = [
    ['', ''],
    ['<Note>\n<div>\n', '\n</div>\n</Note>'],
    ['<section>\n', '\n</section>'],
    ['> ', ''],
    ['<Steps>\n<Step>\n', '\n</Step>\n</Steps>'],
  ];
  const mappings = [new Map<string, string>(), new Map([['unrelated', '/guides/unrelated']]), routes];
  let mainReports = 0;
  let headReports = 0;
  for (let index = 0; index < 1024; index++) {
    const url = urls[random() % urls.length] ?? '/unmapped';
    const [open, close] = wrappers[random() % wrappers.length] ?? ['', ''];
    const source = `${open}[Target](${url})${close}\n\n<Card href="${url}" />\n\n[Real](/next)`;
    const mapping = mappings[random() % mappings.length] ?? routes;
    const baseline: string[] = [];
    const actual: string[] = [];
    const options = { sourceUrl: 'https://help.test', languageCode: 'en' };
    rewriteMainInternalLinks(source, 'docs/intro', mapping, { ...options, onUnresolved: (href) => baseline.push(href) });
    rewriteMintlifyInternalLinks(source, 'docs/intro', mapping, { ...options, onUnresolved: (href) => actual.push(href) });
    expect(actual, `fidelity case ${index}`).toEqual(baseline);
    mainReports += baseline.length;
    headReports += actual.length;
  }
  console.info('fidelity differential', { seed: '0x618663', cases: 1024, mainReports, headReports, mismatches: 0 });
  expect(mainReports).toBeGreaterThan(0);
});

it('extended discovery and malformed angle destinations match the reference scanner', () => {
  let documents = 0;
  let rewrittenLinks = 0;
  const shapes: string[] = [];
  for (const depth of [1, 2, 3, 8, 32, 128])
    for (const gap of ['', 'x'.repeat(257), 'x'.repeat(4097)]) {
      shapes.push(
        `${'[a](<b)'.repeat(depth)}${gap}`,
        `${'['.repeat(depth)}[a](<${gap})`,
        `${'[a](<b'.repeat(depth)}${gap}${')'.repeat(depth)}`,
        `[a](<${'<'.repeat(depth)}${gap})`,
        `[a](<${gap}\\>) [Real](</next>)`,
        `[a](<${gap}\\)>) [Real](</next>)`,
        `[a](<${gap}\n/next>) [Real](/next)`,
        `[a](<${gap}\r\n/next>) [Real](/next)`,
        `[a](<${gap})${gap}> [Real](/next)`,
        `[a](<${gap}[nested](/next)) [Real](/next)`,
        `[a](<${gap}(nested)) [Real](/next)`,
        `![outer [a](<${gap})](/next) [Real](/next)`,
      );
    }
  const links = ['[Go](/next?x=1#part)', '[Missing](/missing)', '[Go](</next>)', '[Go](/next?lang=ar)'];
  for (const [open, close] of [['', ''], ...extendedImportWrappers])
    for (const shape of [...shapes, ...links]) {
      const source = `${open}${shape} [Valid](/next)${close}\n\n\`[Code](/next)\`\n\n<Note>\n[Following](/next)\n</Note>`;
      const { head } = assertDiscoveryParity(source, 'docs/intro', routes, { sourceUrl: 'https://help.test', languageCode: 'en' });
      rewrittenLinks += head.rewrites.length;
      documents++;
    }
  console.info('extended link discovery differential', { documents, rewrittenLinks, mismatches: 0, fidelityMismatches: 0 });
});

describe('Imported link destinations', () => {
  it('prefers the exact application destination over a conflicting source key and basename', () => {
    const routes = new Map([
      ['next', '/guides/next'],
      ['api/next', '/next'],
    ]);
    expect(rewriteMintlifyInternalLinks('[Next](https://nibleaf.com/pages/next#start)', 'intro', routes)).toBe('[Next](/next#start)');
    expect(rewriteMintlifyInternalLinks('[Next](https://nibleaf.com/pages/guides/next)', 'intro', routes)).toBe('[Next](/guides/next)');
    expect(
      rewriteMintlifyInternalLinks(
        '[Next](https://nibleaf.com/pages/next)',
        'intro',
        new Map([
          ['a/page', '/next'],
          ['b/page', '/guides/next'],
        ]),
      ),
    ).toBe('[Next](/next)');
  });

  it('reports an ambiguous basename without guessing', () => {
    const url = 'https://nibleaf.com/pages/next';
    const issues: string[] = [];
    expect(
      rewriteMintlifyInternalLinks(
        `[Next](${url})`,
        'intro',
        new Map([
          ['a/page', '/guides/next'],
          ['b/page', '/api/next'],
        ]),
        {
          onUnresolved: (value) => issues.push(value),
        },
      ),
    ).toBe(`[Next](${url})`);
    expect(issues).toEqual([url]);
  });

  it('decodes HTML language query entities and escapes the rewritten href', () => {
    const source = '<a href="https://nibleaf.com/pages/next?x=1&amp;lang=ar#start">Next</a>';
    const options = {
      languageCode: 'en',
      languageRoutes: new Map([
        ['en', new Map([['next', '/english/next']])],
        ['ar', new Map([['next', '/arabic/next']])],
      ]),
    };
    expect(rewriteMintlifyInternalLinks(source, 'intro', new Map([['next', '/english/next']]), options)).toBe(
      '<a href="/arabic/next?x=1&amp;lang=ar#start">Next</a>',
    );
    const markdown = '[Next](https://external.test/next?x=1&amp;lang=ar)';
    expect(rewriteMintlifyInternalLinks(markdown, 'intro', new Map(), options)).toBe(markdown);
    expect(
      rewriteMintlifyInternalLinks('[Next](https://nibleaf.com/pages/next?x=1&amp;lang=ar)', 'intro', new Map([['next', '/english/next']]), options),
    ).toBe('[Next](/english/next?x=1&amp;lang=ar)');
  });

  it.each(['guides/café', 'guides/مرحبا', 'guides/%broken'])('resolves encoded and plain segments to the same page: %s', (path) => {
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    const routes = buildMintlifyRouteMap([{ kind: 'page', path }]);
    expect([...buildMintlifyRouteMap([{ kind: 'page', path: encoded }]).keys()]).toEqual([path]);
    const issues: string[] = [];
    for (const reference of [path, encoded]) {
      expect(mintlifyInternalLinkTargets(`[Next](/${reference})`, 'intro')).toEqual([path]);
      expect(
        rewriteMintlifyInternalLinks(`[Next](https://help.test/${reference}?lang=ar#start)`, 'intro', routes, {
          sourceUrl: 'https://help.test',
          onUnresolved: (url) => issues.push(url),
        }),
      ).toBe(`[Next](${routes.get(path)}?lang=ar#start)`);
    }
    expect(issues).toEqual([]);
  });
});

describe('Localized imported destinations', () => {
  const page = (id: string, path: string, languageCode: string, versionId = 'v1'): SnapshotPage => ({
    id,
    path,
    languageCode,
    versionId,
    slug: 'next',
    title: id,
    parentId: null,
    kind: 'PAGE',
    content: '',
    description: null,
    icon: null,
    updatedAt: '2026-11-13T00:00:00Z',
    position: 0,
    hidden: false,
    config: null,
    translationKey: null,
  });
  const snapshot: SiteSnapshot = {
    generatedAt: '2026-11-13T00:00:00Z',
    project: {
      id: 'synthetic',
      slug: 'synthetic',
      name: 'Synthetic',
      description: null,
      icon: null,
      config: null,
      languages: [
        { code: 'en', label: 'English', direction: 'LTR', isDefault: true, config: null },
        { code: 'ar', label: 'Arabic', direction: 'RTL', isDefault: false, config: null },
      ],
      versions: [
        { id: 'v1', name: 'Latest', slug: 'latest', isDefault: true },
        { id: 'v2', name: 'v2', slug: 'v2', isDefault: false },
      ],
    },
    pages: [
      page('from', 'intro', 'en'),
      page('en-next', 'english/next', 'en'),
      page('ar-next', 'arabic/next', 'ar'),
      page('v2-from', 'intro', 'en', 'v2'),
      page('v2-ar-next', 'arabic/next', 'ar', 'v2'),
    ],
  };

  it('resolves an explicit Arabic link to the Arabic page', () => {
    const result = rewriteMintlifyInternalLinks(
      '[Next](https://nibleaf.com/pages/next?lang=ar#start)',
      'intro',
      new Map([['next', '/english/next']]),
      {
        languageCode: 'en',
        languageRoutes: new Map([
          ['en', new Map([['next', '/english/next']])],
          ['ar', new Map([['next', '/arabic/next']])],
        ]),
      },
    );
    expect(result).toBe('[Next](/arabic/next?lang=ar#start)');
    expect(createLinkResolver(snapshot)('/arabic/next?lang=ar#start', snapshot.pages[0] as SnapshotPage)).toMatchObject({
      id: 'ar-next',
      languageCode: 'ar',
    });
  });

  it('reports a missing Arabic page without falling back to English', () => {
    const issues: string[] = [];
    const url = 'https://nibleaf.com/pages/next?lang=ar#start';
    expect(
      rewriteMintlifyInternalLinks(`[Next](${url})`, 'intro', new Map([['next', '/english/next']]), {
        languageCode: 'en',
        languageRoutes: new Map([
          ['en', new Map([['next', '/english/next']])],
          ['ar', new Map()],
        ]),
        onUnresolved: (href) => issues.push(href),
      }),
    ).toBe(`[Next](${url})`);
    expect(issues).toEqual([url]);
  });

  it('keeps an explicit language link in the selected version', () => {
    const { languages } = parseMintlifyLanguages({
      navigation: {
        languages: [
          {
            language: 'en',
            versions: [
              { version: 'v1', default: true, pages: ['en/next'] },
              { version: 'v2', pages: ['en/next'] },
            ],
          },
          {
            language: 'ar',
            versions: [
              { version: 'v1', default: true, pages: ['ar/next'] },
              { version: 'v2', groups: [{ group: 'Arabic', pages: ['ar/next'] }] },
            ],
          },
        ],
      },
    });
    const url = 'https://nibleaf.com/pages/next?lang=ar#start';
    const rewritten = rewriteMintlifyInternalLinks(`[Next](${url})`, 'intro', new Map([['next', '/english/next']]), {
      languageCode: 'en',
      languageRoutes: buildMintlifyLanguageRouteMaps(languages, 'v2'),
    });
    expect(rewritten).toBe('[Next](/arabic/next?lang=ar#start)');
    expect(createLinkResolver(snapshot)('/arabic/next?lang=ar#start', snapshot.pages[3] as SnapshotPage)).toMatchObject({ id: 'v2-ar-next' });
    const missing: string[] = [];
    expect(
      rewriteMintlifyInternalLinks(`[Next](${url})`, 'intro', new Map([['next', '/english/next']]), {
        languageCode: 'en',
        languageRoutes: buildMintlifyLanguageRouteMaps(languages, 'v3'),
        onUnresolved: (href) => missing.push(href),
      }),
    ).toBe(`[Next](${url})`);
    expect(missing).toEqual([url]);
  });
});
