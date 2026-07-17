import { describe, expect, it } from 'vitest';
import { buildMintlifyRouteMap, mintlifyInternalLinkTargets, rewriteMintlifyInternalLinks } from './mintlify-links';
import type { NavNode } from './mintlify-mapping';

const nodes: NavNode[] = [
  {
    kind: 'group',
    title: 'Documentation',
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
    expect(routes.get('quickstart')).toBe('/documentation/getting-started/quickstart');
    expect(routes.get('guides/python-fastapi')).toBe('/documentation/language-guides/python-fastapi');
  });
});

describe('rewriteMintlifyInternalLinks', () => {
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
    expect(result).toContain('[Node](/documentation/language-guides/nodejs-express)');
    expect(result).toContain('[Python](/documentation/language-guides/python-fastapi#install)');
    expect(result).toContain('href="/documentation/getting-started/quickstart?from=card"');
    expect(result).toContain('[External](https://example.com/nodejs-express)');
    expect(result).toContain('![Image](/nodejs-express.png)');
  });

  it('discovers linked source pages while ignoring external links, fragments, and images', () => {
    const content = '[Rules](../rules#syntax)\n<Card href="/ptrace">Ptrace</Card>\n[External](https://example.com)\n![Image](/ptrace.png)';
    expect(mintlifyInternalLinkTargets(content, 'guides/quickstart')).toEqual(['rules', 'ptrace']);
  });
});
