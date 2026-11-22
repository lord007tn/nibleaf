import { describe, expect, it } from 'vitest';
import { buildMintlifyLanguageRouteMap, buildMintlifyRouteMap, mintlifyInternalLinkTargets, rewriteMintlifyInternalLinks } from './mintlify-links';
import { type NavNode, parseMintlifyLanguages } from './mintlify-mapping';

const nodes: NavNode[] = [
  {
    kind: 'group',
    title: 'Documentation',
    slug: 'docs',
    origin: 'group',
    children: [
      { kind: 'group', title: 'Getting Started', origin: 'group', children: [{ kind: 'page', path: 'quickstart' }] },
      {
        kind: 'group',
        title: 'Language guides',
        origin: 'group',
        children: [
          { kind: 'page', path: 'nodejs-express' },
          { kind: 'page', path: 'guides/python-fastapi' },
        ],
      },
    ],
  },
];

describe('buildMintlifyRouteMap', () => {
  it('maps Mintlify source paths to their imported grouped public routes', () => {
    const routes = buildMintlifyRouteMap(nodes);
    expect(routes.get('quickstart')).toBe('/docs/getting-started/quickstart');
    expect(routes.get('guides/python-fastapi')).toBe('/docs/language-guides/python-fastapi');
  });
});

describe('rewriteMintlifyInternalLinks', () => {
  it.each([
    '[r]: </topic/next> "Quoted"',
    "[r]: /topic/next 'Single quotes'",
    '[r]: /topic/next (Parenthesized)',
    '> [r]: </topic/next>\n>   "Multiline title"',
    '- [r]: /topic/next "In a list"',
    '<Note>\n[r]: /topic/next "In a component"\n</Note>',
  ])('preserves definition spelling outside the final destination: %s', (definition) => {
    const source = `[Go][R]\n\n${definition}`;
    const routes = new Map([['topic/next', '/topic-2/next']]);
    expect(rewriteMintlifyInternalLinks(source, 'intro', routes)).toBe(source.replace('/topic/next', '/topic-2/next'));
  });

  it.each([
    '[r]: /topic/next "Title" extra text',
    '~~~\n[r]: /topic/next\n~~~',
    '    [r]: /topic/next',
    '<Note>\n    ~~~\n    [r]: /topic/next\n    ~~~\n</Note>',
    '`[r]: /topic/next`',
  ])('preserves definition look-alikes outside rendered links: %s', (definition) => {
    const source = `[Go][R]\n\n${definition}`;
    const routes = new Map([['topic/next', '/topic-2/next']]);
    expect(rewriteMintlifyInternalLinks(source, 'intro', routes)).toBe(source);
  });

  it('retains inline and HTML rewrites above the reference-definition parse limit', () => {
    const links = '[Inline](/topic/next) <Card href="/topic/next" /> [Reference][r]';
    const definition = '\n\n[r]: /topic/next "Title"\n\n';
    const routes = new Map([['topic/next', '/topic-2/next']]);
    const rewrittenLinks = links.replaceAll('/topic/next', '/topic-2/next');
    const withinLimit = 'a'.repeat(4096 - links.length - definition.length);
    expect(rewriteMintlifyInternalLinks(links + definition + withinLimit, 'intro', routes)).toBe(
      rewrittenLinks + definition.replace('/topic/next', '/topic-2/next') + withinLimit,
    );
    const overLimit = `${withinLimit}a`;
    expect(rewriteMintlifyInternalLinks(links + definition + overLimit, 'intro', routes)).toBe(rewrittenLinks + definition + overLimit);
  });

  it('keeps footnotes, empty destinations and definitions shared with images unchanged', () => {
    const source = '[^note] [Empty][empty] [Page][shared] ![Image][shared]\n\n[^note]: /topic/next\n[empty]: <>\n[shared]: /topic/next';
    const routes = new Map([['topic/next', '/topic-2/next']]);
    expect(rewriteMintlifyInternalLinks(source, 'intro', routes)).toBe(source);
  });

  it('does not discover or rewrite page links inside code examples', () => {
    const literal = ['~~~mdx', '[Hidden](./hidden)', '<Card href="./quickstart" />', '~~~', '`[Inline](./hidden)`'].join('\n');
    const input = `${literal}\n[Start](./quickstart)`;
    const routes = new Map([
      ['quickstart', '/docs/start'],
      ['hidden', '/docs/hidden'],
    ]);
    expect(mintlifyInternalLinkTargets(input, 'intro')).toEqual(['quickstart']);
    expect(rewriteMintlifyInternalLinks(input, 'intro', routes)).toBe(`${literal}\n[Start](/docs/start)`);
  });
  it('maps a translated target in the matching version while retaining query and fragment', () => {
    const { languages } = parseMintlifyLanguages({
      navigation: {
        languages: [
          { language: 'en', pages: ['intro'] },
          {
            language: 'ar',
            versions: [
              { version: 'v1', groups: [{ group: 'Old', pages: ['ar/intro'] }] },
              { version: 'v2', groups: [{ group: 'New', pages: ['ar/intro'] }] },
            ],
          },
        ],
      },
    });
    const routes = buildMintlifyLanguageRouteMap(languages, 'en', 'v2');
    expect(rewriteMintlifyInternalLinks('[Arabic](./ar/intro?from=guide#install)', 'intro', routes)).toBe(
      '[Arabic](/new/intro?from=guide&lang=ar#install)',
    );
    expect(buildMintlifyLanguageRouteMap(languages, 'en', 'missing').size).toBe(0);
  });

  it('rewrites root, relative Markdown, and MDX href links while preserving suffixes and external URLs', () => {
    const routes = buildMintlifyRouteMap(nodes);
    const content = [
      '[Node](/nodejs-express)',
      '[Python](guides/python-fastapi#install)',
      '<Card href="/quickstart?from=card">Start</Card>',
      '[External](https://example.com/nodejs-express)',
      '![Image](/nodejs-express.png)',
    ].join('\n');
    const result = rewriteMintlifyInternalLinks(content, 'quickstart', routes);
    expect(result).toContain('[Node](/docs/language-guides/nodejs-express)');
    expect(result).toContain('[Python](/docs/language-guides/python-fastapi#install)');
    expect(result).toContain('href="/docs/getting-started/quickstart?from=card"');
    expect(result).toContain('[External](https://example.com/nodejs-express)');
    expect(result).toContain('![Image](/nodejs-express.png)');
  });

  it('discovers linked source pages while ignoring external links, fragments, and images', () => {
    const content = '[Rules](../rules#syntax)\n<Card href="/ptrace">Ptrace</Card>\n[External](https://example.com)\n![Image](/ptrace.png)';
    expect(mintlifyInternalLinkTargets(content, 'guides/quickstart')).toEqual(['rules', 'ptrace']);
  });
});

it('discovers absolute source links to hidden pages', () => {
  expect(mintlifyInternalLinkTargets('[Hidden](https://help.example.test/hidden?lang=ar#start)', 'intro', 'https://help.example.test')).toEqual([
    'hidden',
  ]);
});
