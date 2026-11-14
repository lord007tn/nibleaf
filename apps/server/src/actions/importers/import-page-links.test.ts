import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { componentLinkFixtures, componentRepro } from './fixtures/component-links';
import { rewriteMainInternalLinks } from './fixtures/page-links.main-reference';
import corpus from './fixtures/page-links-corpus.json';
import { convertGitBookMarkdown } from './gitbook-markdown';
import { rewriteMintlifyInternalLinks } from './mintlify-links';
import { normalizeMintlifyMdx } from './mintlify-mdx';

// These corpus comparisons and seeded properties do linear work over hundreds of
// documents. As in #658, busy CI runners can exceed Vitest's five-second default.
// Growth tests pin the cost separately; give this file time to finish its assertions.
vi.setConfig({ testTimeout: 60_000 });

vi.mock('mdast-util-from-markdown', async (original) => {
  const module = await original<typeof import('mdast-util-from-markdown')>();
  return { ...module, fromMarkdown: vi.fn(module.fromMarkdown) };
});
beforeEach(() => vi.mocked(fromMarkdown).mockClear());
const routes = new Map([['next', '/topic/next']]);

describe('component-aware destination spans', () => {
  it.each(componentLinkFixtures)('parses $name once and preserves source bytes', ({ content }) => {
    const expected = rewriteMainInternalLinks(content, 'intro', routes);
    // Main did not rewrite definitions; those have a separate collision test.
    const actual = rewriteMintlifyInternalLinks(content, 'intro', routes, { rewriteDefinitions: false });
    expect(actual).toBe(expected);
    expect(fromMarkdown).toHaveBeenCalledTimes(1);
  });

  it('rewrites each component href and child destination exactly once', () => {
    const source = `<Card href="/next">\n${componentRepro}\n</Card>`;
    const mapped = new Map([
      ['next', '/topic/next'],
      ['topic/next', '/wrong'],
    ]);
    expect(rewriteMintlifyInternalLinks(source, 'intro', mapped)).toBe(
      '<Card href="/topic/next">\n<Steps>\n<Step title="One">\n[Go](/topic/next)\n</Step>\n</Steps>\n\n[Real](/topic/next)\n</Card>',
    );
    expect(fromMarkdown).toHaveBeenCalledTimes(1);
  });

  it('keeps directory-relative links and uppercase hrefs in the candidate check', () => {
    const source = `${componentRepro}\n\n[Parent](.)\n\n[Root](..)\n\n<Card HREF="/next" />`;
    const mapped = new Map([...routes, ['docs', '/docs-2'], ['.', '/home']]);
    expect(rewriteMintlifyInternalLinks(source, 'docs/intro', mapped)).toBe(rewriteMainInternalLinks(source, 'docs/intro', mapped));
    expect(rewriteMintlifyInternalLinks('[Parent](.)', 'docs/intro', new Map([['docs', '/docs-2']]))).toBe('[Parent](/docs-2)');
    expect(rewriteMintlifyInternalLinks('<Card HREF="/next" />', 'intro', routes)).toBe('<Card HREF="/topic/next" />');
  });

  it.each(['['.repeat(2 * 1024 * 1024), '[a](<b)'.repeat(299_594)])('skips parsing malformed two MiB input %#', (content) => {
    expect(rewriteMintlifyInternalLinks(content, 'intro', new Map())).toBe(content);
    expect(rewriteMintlifyInternalLinks(`${content}\n\nnext`, 'intro', routes)).toBe(`${content}\n\nnext`);
    expect(fromMarkdown).not.toHaveBeenCalled();
  });

  it('skips rewrite-only parsing but retains reporting without an imported candidate', () => {
    expect(rewriteMintlifyInternalLinks('[Other](/elsewhere)', 'intro', routes)).toBe('[Other](/elsewhere)');
    expect(fromMarkdown).not.toHaveBeenCalled();
    const report = vi.fn();
    expect(rewriteMintlifyInternalLinks('[Other](/elsewhere)', 'intro', routes, { onUnresolved: report })).toBe('[Other](/elsewhere)');
    expect(report).toHaveBeenCalledWith('/elsewhere');
    expect(fromMarkdown).toHaveBeenCalledTimes(1);
  });

  it('does not manufacture link syntax by removing inline component-shaped text', () => {
    const literals = '[Literal](<Note>next)\n\n[not-a-definition]: /next<Note>\n\n[also-not]: /next</Note>';
    expect(rewriteMintlifyInternalLinks(`${componentRepro}\n\n${literals}`, 'intro', routes)).toBe(
      `${componentRepro.replaceAll('(/next)', '(/topic/next)')}\n\n${literals}`,
    );
  });

  it.each(['[', '[a](<b)'])('bounds a pathological paragraph before a real component link: %s', (unit) => {
    const paragraph = unit.repeat(Math.ceil((2 * 1024 * 1024) / unit.length)).slice(0, 2 * 1024 * 1024);
    expect(rewriteMintlifyInternalLinks(`${paragraph}\n\n${componentRepro}`, 'intro', routes)).toBe(
      `${paragraph}\n\n${componentRepro.replaceAll('(/next)', '(/topic/next)')}`,
    );
    expect(fromMarkdown).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fromMarkdown).mock.calls[0]?.[0].length).toBeLessThan(1024);
  });
});

it.each(['mintlify', 'gitbook'] as const)('%s: main differential covers 291 repository docs and component fixtures', (kind) => {
  const root = resolve(import.meta.dirname, '../../../../..');
  const docs = corpus.map((path) => ({ name: path, source: path.replace(/\.mdx?$/i, ''), content: readFileSync(resolve(root, path), 'utf8') }));
  const corpusRoutes = new Map(docs.map(({ source }, index) => [source, `/corpus/p${index}`]));
  let changedDocuments = 0;
  const inputs = [...docs, ...componentLinkFixtures.map((fixture) => ({ ...fixture, source: 'intro' }))];
  for (const input of inputs) {
    const mapping = input.source === 'intro' ? routes : corpusRoutes;
    const converted = kind === 'mintlify' ? input.content : convertGitBookMarkdown(input.content, { resolveFile: () => undefined }).content;
    const baseline = rewriteMainInternalLinks(converted, input.source, mapping);
    if (input.source !== 'intro' && baseline !== converted) changedDocuments++;
    const head = rewriteMintlifyInternalLinks(converted, input.source, mapping, { rewriteDefinitions: false });
    const finish = kind === 'mintlify' ? normalizeMintlifyMdx : (content: string) => content;
    // Full-string equality pins destinations AND every byte outside them.
    expect(finish(head), input.name).toBe(finish(baseline));
  }
  expect(changedDocuments).toBeGreaterThan(0);
  console.info(
    `${kind} differential: ${docs.length} repo docs, ${changedDocuments} with rewritten destinations, ${componentLinkFixtures.length} component fixtures`,
  );
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
    const expected = rewriteMainInternalLinks(source, 'docs/intro', routes);
    const actual = rewriteMintlifyInternalLinks(source, 'docs/intro', routes, { rewriteDefinitions: false });
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

it('exposes lowercase prose while retaining opaque HTML, comments, attributes and code', () => {
  const literal =
    '<script>\n[Script](/next)\n</script>\n\n<style>\n[Style](/next)\n</style>\n\n<textarea>\n[Text](/next)\n</textarea>\n\n<title>\n[Title](/next)\n</title>\n\n<pre>\n<a href="/next">Code</a>\n</pre>\n\n<code>[Code](/next)</code-sample>[Still code](/next)</code>\n\n<!-- [Comment](/next) -->\n\n<div title="[Attribute](/next)">\n~~~md\n[Code](/next)\n~~~\n</div>';
  const prose = '<Note>\n<div>\n[Go](/next?x=1#part)\n</div>\n</Note>';
  expect(rewriteMintlifyInternalLinks(`${literal}\n\n${prose}`, 'intro', routes)).toBe(`${literal}\n\n${prose.replace('(/next?', '(/topic/next?')}`);
});
