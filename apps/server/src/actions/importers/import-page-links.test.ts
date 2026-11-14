import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { componentLinkFixtures } from './fixtures/component-links';
import { linkDiscoveryRepros } from './fixtures/link-discovery-repros';
import { traceLinkDiscovery } from './fixtures/link-discovery-trace';
import { rewriteMainInternalLinks } from './fixtures/page-links.main-reference';
import corpus from './fixtures/page-links-corpus.json';
import { convertGitBookMarkdown } from './gitbook-markdown';
import { rewriteMintlifyInternalLinks } from './mintlify-links';
import { normalizeMintlifyMdx } from './mintlify-mdx';

// Linear corpus comparisons can exceed the five-second default on busy CI (#658).
// Growth files bound the cost independently of this assertion timeout.
vi.setConfig({ testTimeout: 60_000 });
const routes = new Map([
  ['next', '/topic/next'],
  ['topic/next', '/topic-2/next'],
  ['getting-started', '/getting-started-2'],
]);

const assertDiscoveryParity = (
  source: string,
  page: string,
  mapping: ReadonlyMap<string, string> = routes,
  options: Parameters<typeof rewriteMainInternalLinks>[3] = {},
) => {
  const main = traceLinkDiscovery(rewriteMainInternalLinks, source, page, mapping, options);
  const head = traceLinkDiscovery(rewriteMintlifyInternalLinks, source, page, mapping, options);
  expect(head.visits, `${page}: source byte offsets and original destinations`).toEqual(main.visits);
  expect(head.output, `${page}: only main's target spans may change`).toBe(main.output);
  expect(rewriteMintlifyInternalLinks(source, page, mapping, options), `${page}: rewrite-only fast path`).toBe(main.output);
  expect(head.reports, `${page}: fidelity reports must include main's`).toEqual(expect.arrayContaining(main.reports));
  const encoded = Buffer.from(source);
  for (const visit of head.visits)
    expect(encoded.subarray(visit.byteOffset, visit.byteOffset + Buffer.byteLength(visit.original)).toString()).toBe(visit.original);
  return { main, head };
};

describe('main discovery: named repros from every review round', () => {
  it('deduplication changes target strings at the same main offsets and leaves code literal', () => {
    const prose = '<Note>\n<div title="[Example](/next)">\n[^f]\n\n[^f]: [Go](/next?x=1#part)\n</div>\n</Note>\n\n</code>\n\n[Again](/next)';
    const code = '\n\n`[Code](/next)`\n\n~~~md\n[Code](/next)\n~~~';
    const main = traceLinkDiscovery(rewriteMainInternalLinks, prose + code, 'intro', new Map([['next', '/topic/next']]));
    const head = traceLinkDiscovery(rewriteMintlifyInternalLinks, prose + code, 'intro', new Map([['next', '/topic-2/next']]));
    expect(head.visits).toEqual(main.visits);
    expect(main.output).toBe(prose.replaceAll('(/next', '(/topic/next') + code);
    expect(head.output).toBe(prose.replaceAll('(/next', '(/topic-2/next') + code);
    expect(head.reports).toEqual(expect.arrayContaining(main.reports));
  });
  it.each(linkDiscoveryRepros)('$name: identical source byte offsets, output and reports', ({ content }) => {
    assertDiscoveryParity(content, 'intro', routes, { sourceUrl: 'https://help.test', languageCode: 'en' });
  });
  it.each(componentLinkFixtures)('component compatibility: $name', ({ content }) => {
    assertDiscoveryParity(content, 'intro');
  });
  it('round 3: main leaves the invalid definition line byte-identical', () => {
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
  for (const input of inputs) {
    const body = kind === 'mintlify' ? input.content : convertGitBookMarkdown(input.content, { resolveFile: () => undefined }).content;
    const observed = assertDiscoveryParity(body, input.source, input.source === 'intro' ? routes : mappings);
    const finish = kind === 'mintlify' ? normalizeMintlifyMdx : (value: string) => value;
    expect(finish(observed.head.output), input.name).toBe(finish(observed.main.output));
    destinations += observed.head.visits.length;
  }
  console.info('corpus source-offset differential', {
    kind,
    repoDocs: docs.length,
    repros: linkDiscoveryRepros.length,
    componentFixtures: componentLinkFixtures.length,
    destinations,
    offsetMismatches: 0,
    exceptions: [],
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
    const expected = observed.main.output;
    const actual = observed.head.output;
    if (!actual.includes('`[Code](/next)`') || !actual.includes('~~~md\n[Code](/next)\n~~~')) codeChanges++;
    if (actual !== expected) failures.push({ i, source, main: expected, head: actual });
  }
  console.info('seeded document differential', { seed: '0x663618', cases: 512, misses: failures.length, codeChanges });
  expect(failures.slice(0, 1)).toEqual([]);
  expect(codeChanges).toBe(0);
});

it('seed 0x618663: fidelity reports are a superset of main with and without rewrite candidates', () => {
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
  const failures: Array<{ index: number; source: string; missing: string[] }> = [];
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
    const missing = [...new Set(baseline)].filter((href) => !actual.includes(href));
    mainReports += baseline.length;
    headReports += actual.length;
    if (missing.length) failures.push({ index, source, missing });
  }
  console.info('fidelity differential', { seed: '0x618663', cases: 1024, mainReports, headReports, misses: failures.length });
  expect(mainReports).toBeGreaterThan(0);
  expect(failures.slice(0, 1)).toEqual([]);
});
