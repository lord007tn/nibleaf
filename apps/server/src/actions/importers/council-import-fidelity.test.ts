import { pageContentFacts } from '@nibleaf/shared/publish-checks';
import { normalizeMdxBlocks } from '@nibleaf/shared/reader-markdown';
import type { SiteSnapshot, SnapshotPage } from '@nibleaf/shared/site';
import { createLinkResolver, importSiteHref } from '@nibleaf/shared/site-links';
import MarkdownIt from 'markdown-it';
import { describe, expect, it } from 'vitest';
import { convertGitBookMarkdown } from './gitbook-markdown';
import { buildMintlifyLanguageRouteMaps, rewriteMintlifyInternalLinks } from './mintlify-links';
import { parseMintlifyLanguages } from './mintlify-mapping';
import { normalizeMintlifyMdx } from './mintlify-mdx';

const gitbook = (source: string) => convertGitBookMarkdown(source, { resolveFile: () => undefined });
const converters = [
  ['GitBook', gitbook],
  [
    'Mintlify',
    (source: string) => {
      const issues: string[] = [];
      return { content: normalizeMintlifyMdx(source, (url) => issues.push(url)), issues };
    },
  ],
] as const;
const parser = new MarkdownIt({ html: true });
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

describe('Sol council #582 regressions (a164b695)', () => {
  it.each(converters)('P1: %s never reuses protected code as a derived embed title', (_name, convert) => {
    const code = '    "quoted <example>"';
    const result = convert(`Example:\n\n${code}\n\n<iframe src="https://youtu.be/abcdefghijk"></iframe>`);
    expect(result.content.split(code)).toHaveLength(2);
    expect(result.content).not.toContain('\uE000');
    expect(result.content).toMatch(/<iframe src="https:\/\/www.youtube-nocookie.com\/embed\/abcdefghijk" title="(?:Example:|Video)"><\/iframe>/);
  });
  it.each(converters)('P1: %s preserves indented and container code byte for byte', (_name, convert) => {
    for (const source of [
      'Example:\n\n    [Demo](https://youtu.be/abcdefghijk)\n    /\n    \\---',
      '- Example:\n\n      [Demo](https://youtu.be/abcdefghijk)\n      /\n      \\---',
      '> Example:\n>\n>     [Demo](https://youtu.be/abcdefghijk)\n>     /\n>     \\---',
      '- Example:\n\n  ```md\n  [Demo](https://youtu.be/abcdefghijk)\n  /\n  \\---\n  ```',
      '> ```md\n> [Demo](https://youtu.be/abcdefghijk)\n> /\n> \\---\n> ```',
    ]) {
      expect(convert(source).content).toBe(source);
      expect(convert(source).issues).toEqual([]);
    }
  });

  it.each([
    'https://help.test//evil.test/next',
    'https://nibleaf.com/pages//evil.test/next',
    'https://help.test/\\evil.test/next',
    'https://nibleaf.com/pages/\\evil.test/next',
  ])('P2 origin: retains and reports %s', (url) => {
    const result = importSiteHref(url, 'https://help.test', ['https://nibleaf.com']);
    expect(new URL(result, 'https://help.test').origin).toBe(new URL(url).origin);
    expect(result).toBe(url);
    const issues: string[] = [];
    expect(
      rewriteMintlifyInternalLinks(`[Next](${url})`, 'intro', new Map(), {
        sourceUrl: 'https://help.test',
        onUnresolved: (href) => issues.push(href),
      }),
    ).toBe(`[Next](${url})`);
    expect(issues).toEqual([url]);
  });

  it.each([
    'https://youtu.be\\abcdefghijk',
    'http://youtu.be/abcdefghijk',
    '//youtu.be/abcdefghijk',
    'javascript:alert(1)',
    'data:text/html,<video></video>',
    'https://youtu.be/abc\tdefghijk',
    'https://youtu.be/abc\ndefghijk',
    'https://youtu.be/abc\u0000defghijk',
    '\thttps://youtu.be/abcdefghijk',
    'https://youtu.be/abcdefghijk\r',
  ])('P2 media: rejected URL stays inert through reader and publish facts: %j', (url) => {
    for (const input of [`{% video src="${url}" %}`, `<iframe src="${url}" title="Demo"></iframe>`]) {
      const result = gitbook(input);
      expect(result.issues).toHaveLength(1);
      expect(result.content).not.toMatch(/<(?:iframe|video)\b/i);
      const reader = normalizeMdxBlocks(result.content);
      expect(reader).not.toMatch(/<(?:mdxembed|iframe|video)\b/i);
      const facts = pageContentFacts(result.content);
      expect(facts.untitledEmbeds).toEqual([]);
      expect(facts.embedsAsLinks).toEqual([]);
      expect(facts.insecureVideos).toEqual([]);
    }
  });

  it('P2 language: selects Arabic before rewriting and resolves to the Arabic page', () => {
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

  it('P2 language: reports a missing Arabic page instead of English fallback', () => {
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

  it('P2 language/version: resolves Arabic in v2 and reports an absent Arabic version', () => {
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

  it.each(converters)('P2 containers: %s keeps the video and following paragraph in the same list or quote', (_name, convert) => {
    for (const source of [
      '- Step one\n\n  [Demo](https://youtu.be/abcdefghijk)\n\n  Finish.',
      '- Outer\n\n  - Step one\n\n    [Demo](https://youtu.be/abcdefghijk)\n\n    Finish.',
      '> Step one\n>\n> [Demo](https://youtu.be/abcdefghijk)\n>\n> Finish.',
    ]) {
      const result = convert(source).content;
      const html = parser.render(result);
      if (source.startsWith('>')) expect(html).toMatch(/<blockquote>[\s\S]*<iframe[\s\S]*Finish\.[\s\S]*<\/blockquote>/);
      else {
        expect(result).toMatch(/\n {2,4}<iframe/);
        const item = html.slice(html.lastIndexOf('<li>'));
        expect(item.indexOf('<iframe')).toBeGreaterThan(0);
        expect(item.indexOf('Finish.')).toBeLessThan(item.indexOf('</li>'));
      }
    }
  });

  it.each(converters)('P2 metadata: %s retains a source video opener, poster, title and children', (_name, convert) => {
    const source =
      '<video controls poster="/poster.png" title="Training"><source src="https://media.test/training.mp4" type="video/mp4"><track kind="captions" src="/training.vtt" srclang="en" label="English"></video>';
    const result = convert(source);
    expect(result.content).toBe(source);
    expect(result.issues).toEqual([]);
  });

  it.each(converters)('P2 metadata: %s adds controls without discarding source-video attributes', (_name, convert) => {
    const result = convert(
      '<video poster="https://posters.test/training.png" title="Training"><source src="https://media.test/training.mp4"></video>',
    );
    expect(result.content).toContain('poster="https://posters.test/training.png" title="Training"');
    expect(result.content).toContain('controls="true"');
    expect(result.issues).toEqual([]);
    expect(pageContentFacts(result.content).hiddenPosters).toEqual(['https://posters.test/training.png']);
  });
});
