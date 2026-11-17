import { scanAuthoredEmbeds } from '@nibleaf/shared/reader-embeds';
import { describe, expect, it } from 'vitest';
import { rewriteGitBookImages } from './gitbook-assets';
import { convertGitBookMarkdown } from './gitbook-markdown';
import { protectImportCode } from './import-markdown-code';
import { rewriteMintlifyAssetReferences } from './mintlify-assets';
import { mintlifyInternalLinkTargets, rewriteMintlifyInternalLinks } from './mintlify-links';
import { normalizeMintlifyMdx } from './mintlify-mdx';

const converters = [
  ['GitBook', (source: string) => convertGitBookMarkdown(source, { resolveFile: () => undefined }).content],
  ['Mintlify', normalizeMintlifyMdx],
] as const;
const origins = ['https://nibleaf.com'];

describe.each(converters)('full review at dbccca62: %s', (_name, convert) => {
  it.each(['https://help.test/ar/hidden?lang=ar', 'https://help.test/ar/hidden'])(
    '1: excludes foreign-language discovery without frontmatter: %s',
    (url) => {
      const body = convert(`[Foreign](${url})\n\n[English](https://help.test/en/hidden?lang=en)`);
      expect(mintlifyInternalLinkTargets(body, 'intro', 'https://help.test', origins, 'en', ['en', 'ar'])).toEqual(['en/hidden']);
    },
  );

  it('2: exact application destination wins over a conflicting source key and basename', () => {
    const routes = new Map([
      ['next', '/guides/next'],
      ['api/next', '/next'],
    ]);
    expect(rewriteMintlifyInternalLinks(convert('[Next](https://nibleaf.com/pages/next#start)'), 'intro', routes)).toBe('[Next](/next#start)');
    expect(rewriteMintlifyInternalLinks(convert('[Next](https://nibleaf.com/pages/guides/next)'), 'intro', routes)).toBe('[Next](/guides/next)');
    expect(
      rewriteMintlifyInternalLinks(
        convert('[Next](https://nibleaf.com/pages/next)'),
        'intro',
        new Map([
          ['a/page', '/next'],
          ['b/page', '/guides/next'],
        ]),
      ),
    ).toBe('[Next](/next)');
  });
  it('2: reports an ambiguous basename without guessing', () => {
    const url = 'https://nibleaf.com/pages/next';
    const issues: string[] = [];
    expect(
      rewriteMintlifyInternalLinks(
        convert(`[Next](${url})`),
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

  it('3: decodes HTML query entities for Arabic and re-escapes the destination', () => {
    const source = '<a href="https://nibleaf.com/pages/next?x=1&amp;lang=ar#start">Next</a>';
    const options = {
      languageCode: 'en',
      languageRoutes: new Map([
        ['en', new Map([['next', '/english/next']])],
        ['ar', new Map([['next', '/arabic/next']])],
      ]),
    };
    expect(rewriteMintlifyInternalLinks(convert(source), 'intro', new Map([['next', '/english/next']]), options)).toBe(
      '<a href="/arabic/next?x=1&amp;lang=ar#start">Next</a>',
    );
    const markdown = '[Next](https://external.test/next?x=1&amp;lang=ar)';
    expect(rewriteMintlifyInternalLinks(convert(markdown), 'intro', new Map(), options)).toBe(markdown);
    expect(
      rewriteMintlifyInternalLinks(
        convert('[Next](https://nibleaf.com/pages/next?x=1&amp;lang=ar)'),
        'intro',
        new Map([['next', '/english/next']]),
        options,
      ),
    ).toBe('[Next](/english/next?x=1&amp;lang=ar)');
  });

  it.each([
    ['label', '[Demo `a "b" <c>`](https://youtu.be/abcdefghijk)'],
    ['caption', '<Frame caption=\'Demo `a "b" <c>`\'>\n\n<iframe src="https://youtu.be/abcdefghijk"></iframe>\n\n</Frame>'],
  ])('4: keeps code-bearing %s out of generated title attributes', (_form, source) => {
    const content = convert(source);
    const embed = scanAuthoredEmbeds(content)[0];
    expect(content).not.toContain('\uE000');
    expect(embed?.closed).toBe(true);
    expect([...(embed?.attributes.keys() ?? [])]).toEqual(['src', 'title']);
    expect(embed?.attributes.get('title')).toBe('Video');
    expect(content).toContain('title="Video"></iframe>');
  });

  it.each([
    ['CR', '\r', '\r'],
    ['CRLF', '\r\n', '\r\n'],
    ['mixed', '\r\n', '\r'],
  ])('5: protects logical code lines with original delimiter bytes: %s', (_label, ending, codeEnding) => {
    const code = `    ![Example](./next.png)${codeEnding}    [Literal](https://help.test/next)`;
    const source = `Intro${ending}${ending}${code}`;
    const protectedCode = protectImportCode(source);
    expect(protectedCode.content).not.toContain('./next.png');
    expect(protectedCode.restore(protectedCode.content)).toBe(source);
    const converted = convert(source);
    const rewritten = rewriteMintlifyAssetReferences(converted, 'intro.mdx', new Set(['next.png']), (path) => `https://assets.test/${path}`);
    expect(rewritten.content).toContain(code);
    expect(rewritten.resolved).toEqual([]);
    expect(rewritten.missing).toEqual([]);
    expect(rewriteGitBookImages(converted, 'intro.md', new Set(['next.png']), '', (path) => `https://assets.test/${path}`).content).toContain(code);
    const component = `<CodeGroup>${ending}  \`\`\`md${ending}  ![Example](./next.png)${codeEnding}  [Literal](https://help.test/next)${ending}  \`\`\`${ending}</CodeGroup>`;
    expect(convert(component)).toContain(`![Example](./next.png)${codeEnding}`);
  });

  it('6: preserves a fenced image inside CodeGroup through conversion and asset rewriting', () => {
    const source = '<CodeGroup>\n  ```md\n  ![Example](./example.png)\n  ```\n</CodeGroup>';
    const blobs = new Set(['example.png']);
    const raw = (path: string) => `https://assets.example.test/${path}`;
    const before = rewriteMintlifyAssetReferences(source, 'intro.mdx', blobs, raw);
    expect(before.content).toBe(source);
    expect(before.resolved).toEqual([]);
    const converted = convert(source);
    expect(rewriteGitBookImages(converted, 'intro.md', blobs, '', raw).content).toBe(converted);
    expect(converted).toContain('![Example](./example.png)');
    const prose = rewriteMintlifyAssetReferences(`${source}\n\n![Real](./example.png)`, 'intro.mdx', blobs, raw);
    expect(prose.content).toBe(`${source}\n\n![Real](https://assets.example.test/example.png)`);
    const withBlank = '<CodeGroup>\n  ```md\n  ![Example](./example.png)\n\n  ![Example](./example.png)\n  ```\n</CodeGroup>';
    expect(rewriteMintlifyAssetReferences(withBlank, 'intro.mdx', blobs, raw).content).toBe(withBlank);
    expect(rewriteGitBookImages(convert(withBlank), 'intro.md', blobs, '', raw).content).not.toContain('https://assets.example.test');
    const repeated = `${withBlank}\n\n${withBlank}\n\n![Real](./example.png)`;
    expect(rewriteMintlifyAssetReferences(repeated, 'intro.mdx', blobs, raw).content).toBe(
      `${withBlank}\n\n${withBlank}\n\n![Real](https://assets.example.test/example.png)`,
    );
  });
  it('6 control: an indented literal fence does not protect following prose', () => {
    const content = convert('    ```md\n\n[Demo](https://youtu.be/abcdefghijk)');
    expect(content).toContain('    ```md');
    expect(content).toContain('<iframe src="https://www.youtube-nocookie.com/embed/abcdefghijk" title="Demo"></iframe>');
  });
  it('6 control: an indented false closer cannot expose code or hide following prose', () => {
    const code = '```md\n    ```\n<Frame>\n[Literal](https://youtu.be/abcdefghijk)\n```';
    const content = convert(`${code}\n\n[Demo](https://youtu.be/abcdefghijk)`);
    expect(content).toContain(code);
    expect(content).toContain('<iframe src="https://www.youtube-nocookie.com/embed/abcdefghijk" title="Demo"></iframe>');
    const mdx = '<CodeGroup>\n\n  ```md\n  ![Example](./example.png)\n    ```\n</CodeGroup>\n\n![Real](./example.png)';
    expect(rewriteMintlifyAssetReferences(mdx, 'intro.mdx', new Set(['example.png']), (path) => `https://assets.test/${path}`).content).toBe(
      '<CodeGroup>\n\n  ```md\n  ![Example](./example.png)\n    ```\n</CodeGroup>\n\n![Real](https://assets.test/example.png)',
    );
  });
});
