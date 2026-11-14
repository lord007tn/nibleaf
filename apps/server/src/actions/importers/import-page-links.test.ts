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

  it('does not parse documents without an imported target candidate', () => {
    expect(rewriteMintlifyInternalLinks('[Other](/elsewhere)', 'intro', routes, { onUnresolved: vi.fn() })).toBe('[Other](/elsewhere)');
    expect(fromMarkdown).not.toHaveBeenCalled();
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
