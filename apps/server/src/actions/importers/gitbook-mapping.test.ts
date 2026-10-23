import { describe, expect, it } from 'vitest';
import { resolveGitBookRepoPath, rewriteGitBookImages } from './gitbook-assets';
import {
  ensureGitBookReadme,
  findGitBookSpace,
  inferGitBookNavigation,
  mapGitBookRedirects,
  parseGitBookConfig,
  parseGitBookSummary,
  planGitBookNavigation,
} from './gitbook-mapping';

describe('findGitBookSpace / parseGitBookConfig', () => {
  it('prefers the config in the requested folder and resolves root/structure from it', () => {
    const paths = ['.gitbook.yaml', 'spaces/api/.gitbook.yaml', 'spaces/api/docs/INDEX.md'];
    expect(findGitBookSpace(paths)).toEqual({ configPath: '.gitbook.yaml', directory: '' });
    const space = findGitBookSpace(paths, 'spaces/api/');
    expect(space).toEqual({ configPath: 'spaces/api/.gitbook.yaml', directory: 'spaces/api' });
    const { config, warnings } = parseGitBookConfig(
      'root: ./docs/\nstructure:\n  readme: INDEX.md\n  summary: TOC.md\nredirects:\n  old/page: new/page.md\n',
      space?.configPath,
      space?.directory ?? '',
    );
    expect(warnings).toEqual([]);
    expect(config).toEqual({
      configPath: 'spaces/api/.gitbook.yaml',
      root: 'spaces/api/docs',
      readme: 'INDEX.md',
      summary: 'TOC.md',
      redirects: [{ from: 'old/page', to: 'new/page.md' }],
    });
  });

  it('falls back to the shallowest SUMMARY.md and rejects escaping paths', () => {
    expect(findGitBookSpace(['book/SUMMARY.md', 'book/a/SUMMARY.md'])).toEqual({ directory: 'book' });
    expect(findGitBookSpace([], '../etc')).toBeUndefined();
    const { config, warnings } = parseGitBookConfig('root: ../../outside', '.gitbook.yaml', '');
    expect(config.root).toBe('');
    expect(warnings).toHaveLength(1);
  });
});

describe('parseGitBookSummary', () => {
  it('builds sections and nested pages, with labels and relative paths', () => {
    const { sections, warnings } = parseGitBookSummary(
      [
        '# Table of contents',
        '',
        '* [Welcome](README.md)',
        '',
        '## Guides <a href="#guides" id="guides"></a>',
        '',
        '* [Getting started](guides/README.md "Start here")',
        '  * [Install](<guides/install guide.md>)',
        '    * [Linux](guides/linux.md)',
        '  * [Configure](guides/configure.md)',
        '* [GitHub](https://github.com/acme)',
        '* [Twice](guides/configure.md)',
        '* [Configure options](guides/configure.md#options)',
      ].join('\n'),
    );
    expect(sections).toEqual([
      { nodes: [{ kind: 'page', path: 'README.md', title: 'Welcome', children: [] }] },
      {
        title: 'Guides',
        nodes: [
          {
            kind: 'page',
            path: 'guides/README.md',
            title: 'Getting started',
            label: 'Start here',
            children: [
              {
                kind: 'page',
                path: 'guides/install guide.md',
                title: 'Install',
                children: [{ kind: 'page', path: 'guides/linux.md', title: 'Linux', children: [] }],
              },
              { kind: 'page', path: 'guides/configure.md', title: 'Configure', children: [] },
            ],
          },
        ],
      },
    ]);
    expect(warnings).toHaveLength(3);
    expect(warnings[2]).toMatch(/section shortcuts are not imported/);
  });
});

describe('inferGitBookNavigation', () => {
  it('turns folders into README pages or groups, ignoring .gitbook and SUMMARY', () => {
    const sections = inferGitBookNavigation(
      [
        'docs/README.md',
        'docs/b.md',
        'docs/a.md',
        'docs/guides/README.md',
        'docs/guides/x.md',
        'docs/ref/y.md',
        'docs/.gitbook/includes/z.md',
        'docs/SUMMARY.md',
      ],
      'docs',
      'README.md',
      'SUMMARY.md',
    );
    expect(sections[0]?.nodes.map((node) => [node.kind, node.kind === 'page' ? node.path : node.title, node.children.length])).toEqual([
      ['page', 'README.md', 0],
      ['page', 'a.md', 0],
      ['page', 'b.md', 0],
      ['page', 'guides/README.md', 1],
      ['group', 'Ref', 1],
    ]);
  });
});

describe('planGitBookNavigation', () => {
  it('keeps GitBook URLs: sections are categories, folder READMEs use the folder slug', () => {
    const { sections } = parseGitBookSummary(
      '* [Welcome](README.md)\n\n## Guides\n\n* [Guides](guides/README.md)\n  * [Setup](guides/setup.md)\n* [Setup again](other/setup.md)\n',
    );
    const { nodes, routes, warnings } = planGitBookNavigation(ensureGitBookReadme(sections, 'README.md', true), 'README.md');
    expect(nodes.map((node) => [node.slug, node.route, node.category])).toEqual([
      ['welcome', '/welcome', undefined],
      ['guides', '/guides', 'Guides'],
      ['setup', '/setup', 'Guides'],
    ]);
    expect(nodes[1]?.children[0]?.route).toBe('/guides/setup');
    expect(routes.get('guides')).toBe('/guides');
    expect(routes.get('guides/README')).toBe('/guides');
    expect(routes.get('.')).toBe('/welcome');
    expect(warnings).toEqual([]);
  });

  it('disambiguates sibling slug collisions deterministically', () => {
    const { sections } = parseGitBookSummary('* [A](a/intro.md)\n* [B](b/intro.md)\n');
    const { nodes, warnings } = planGitBookNavigation(sections, 'README.md');
    expect(nodes.map((node) => node.slug)).toEqual(['intro', 'b-intro']);
    expect(warnings).toHaveLength(1);
  });

  it('prepends a README missing from SUMMARY.md', () => {
    const sections = ensureGitBookReadme([{ nodes: [{ kind: 'page', path: 'a.md', title: 'A', children: [] }] }], 'README.md', true);
    expect(sections[0]?.nodes[0]).toMatchObject({ path: 'README.md' });
  });
});

describe('mapGitBookRedirects', () => {
  it('maps redirects to imported routes and reports unknown destinations', () => {
    const routes = new Map([['guides/setup', '/guides/setup']]);
    const { redirects, warnings } = mapGitBookRedirects(
      [
        { from: '/old/setup/', to: 'guides/setup.md' },
        { from: 'gone', to: 'missing.md' },
      ],
      routes,
    );
    expect(redirects).toEqual([{ from: '/old/setup', to: '/guides/setup' }]);
    expect(warnings).toHaveLength(1);
  });
});

describe('GitBook assets', () => {
  const blobs = new Set(['docs/.gitbook/assets/image (1).png', 'docs/guides/local.png']);

  it('resolves relative, root-absolute, and misplaced .gitbook/assets references', () => {
    expect(resolveGitBookRepoPath('../.gitbook/assets/image%20(1).png', 'docs/guides/page.md', blobs, 'docs')).toBe(
      'docs/.gitbook/assets/image (1).png',
    );
    expect(resolveGitBookRepoPath('/.gitbook/assets/image (1).png', 'docs/guides/page.md', blobs, 'docs')).toBe('docs/.gitbook/assets/image (1).png');
    expect(resolveGitBookRepoPath('.gitbook/assets/image (1).png', 'docs/guides/page.md', blobs, 'docs')).toBe('docs/.gitbook/assets/image (1).png');
    expect(resolveGitBookRepoPath('../../../etc/passwd', 'docs/page.md', blobs, 'docs')).toBeUndefined();
  });

  it('rewrites bracketed and bare image paths to encoded raw URLs', () => {
    const rawUrl = (path: string) => `https://raw.example/${path.split('/').map(encodeURIComponent).join('/')}`;
    const { content, missing } = rewriteGitBookImages(
      '![a](<../.gitbook/assets/image (1).png>) ![b](local.png "Title") ![c](nope.png)\n\n```\n![d](local.png)\n```',
      'docs/guides/page.md',
      blobs,
      'docs',
      rawUrl,
    );
    expect(content).toBe(
      '![a](https://raw.example/docs/.gitbook/assets/image%20%281%29.png) ![b](https://raw.example/docs/guides/local.png "Title") ![c](nope.png)\n\n```\n![d](local.png)\n```',
    );
    expect(missing).toEqual(['nope.png']);
  });
});
