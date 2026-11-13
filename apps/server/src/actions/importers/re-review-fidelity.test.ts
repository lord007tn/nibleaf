import { describe, expect, it } from 'vitest';
import { rewriteGitBookImages } from './gitbook-assets';
import { convertGitBookMarkdown } from './gitbook-markdown';
import { importCodeLines } from './import-markdown-code';
import { rewriteMintlifyAssetReferences } from './mintlify-assets';
import { mintlifyInternalLinkTargets, rewriteMintlifyInternalLinks } from './mintlify-links';
import { normalizeMintlifyMdx } from './mintlify-mdx';

const converters = [
  ['GitBook', (source: string) => convertGitBookMarkdown(source, { resolveFile: () => undefined }).content],
  ['Mintlify', normalizeMintlifyMdx],
] as const;

describe('import-only fence context', () => {
  it.each(['> ```', '- ```', '1. ```'])('keeps a new container marker literal inside an importer fence: %s', (literal) => {
    expect(importCodeLines(['  ```md', `  ${literal}`, '  image', '  ```', 'after'].join('\n'))).toEqual([true, true, true, true, false]);
  });
  it('uses the opening quote/list context and permits ordinary fence indentation in imports', () => {
    expect(importCodeLines(['> - ```md', '>   > ```', '>   image', '>   ```', 'after'].join('\n'))).toEqual([true, true, true, true, false]);
    expect(importCodeLines(['  ```md', 'code', '```', 'after'].join('\n'))).toEqual([true, true, true, false]);
  });
});

describe.each(converters)('CodeRabbit re-review at e714fa49: %s', (_name, convert) => {
  it.each(['> ', '- ', '1. '])('3: a literal %s fence marker cannot close a component code example', (prefix) => {
    const source = `<CodeGroup>\n  \`\`\`md\n  ${prefix}\`\`\`\n  ![Example](./example.png)\n  \`\`\`\n</CodeGroup>`;
    const blobs = new Set(['example.png']);
    const raw = (path: string) => `https://assets.test/${path}`;
    const content = convert(`${source}\n\n![Real](./example.png)`);
    for (const rewritten of [
      rewriteMintlifyAssetReferences(content, 'intro.mdx', blobs, raw),
      rewriteGitBookImages(content, 'intro.md', blobs, '', raw),
    ]) {
      expect(rewritten.content).toContain('![Example](./example.png)');
      expect(rewritten.content).toContain('![Real](https://assets.test/example.png)');
    }
    expect(rewriteMintlifyAssetReferences(source, 'intro.mdx', blobs, raw).content).toBe(source);
  });

  it('3: a real quoted component fence closes in its opening container', () => {
    const source = '<CodeGroup>\n  > ```md\n  > ![Example](./example.png)\n  > ```\n</CodeGroup>\n\n![Real](./example.png)';
    const rewritten = rewriteMintlifyAssetReferences(convert(source), 'intro.mdx', new Set(['example.png']), (path) => `https://assets.test/${path}`);
    expect(rewritten.content).toContain('![Example](./example.png)');
    expect(rewritten.content).toContain('![Real](https://assets.test/example.png)');
  });

  it.each([
    ['multiline', '<Image\n  src="/cover.png"\n/>'],
    ['single-line', '<Image src="/cover.png" />'],
    ['quoted delimiters', '<Image\n  alt="Literal /> and >"\n/>'],
    ['expression delimiters', '<Image\n  alt={{ label: "/> and >", nested: { value: ">" } }}\n/>'],
    ['expression comparison', '<Image\n  size={3 > 2 ? "large />" : "small"}\n/>'],
    ['escaped quote', '<Image\n  alt="An \\"escaped\\" /> value"\n/>'],
    [
      'nested components',
      '<Outer>\n<Inner\n  label="Literal />"\n/>\n<CodeGroup>\n  ```md\n  [Nested](https://help.test/next)\n  ```\n</CodeGroup>\n</Outer>',
    ],
    [
      'multiline nested components',
      '<Outer\n  size={3 > 2 ? "/>" : ">"}\n>\n<Inner\n  label="Literal />"\n/>\n<CodeGroup>\n  ```md\n  [Nested](https://help.test/next)\n  ```\n</CodeGroup>\n</Outer>',
    ],
  ])('1: %s component leaves indented code protected and later prose rewritable', (_form, component) => {
    const code = '    ```md\n    [Literal](https://help.test/next)';
    const source = `${component}\n\n${code}\n\n[Next](https://help.test/next)\n\n[Tour](https://youtu.be/abcdefghijk)`;
    const issues: string[] = [];
    const content = rewriteMintlifyInternalLinks(convert(source), 'intro', new Map([['next', '/guide/next']]), {
      sourceUrl: 'https://help.test',
      onUnresolved: (value) => issues.push(value),
    });
    expect(content).toContain(code);
    if (_form.includes('nested components')) expect(content).toContain('[Nested](https://help.test/next)');
    expect(content).toContain('[Next](/guide/next)');
    expect(content).toContain('<iframe src="https://www.youtube-nocookie.com/embed/abcdefghijk" title="Tour"></iframe>');
    expect(issues).toEqual([]);
  });

  it('2: a catalog code is an ordinary folder unless configured as a language directory', () => {
    const source = convert('[Generate](https://help.test/id/generate)');
    expect(mintlifyInternalLinkTargets(source, 'intro', 'https://help.test', ['https://nibleaf.com'], 'en', ['en', 'ar'])).toEqual(['id/generate']);
  });

  it('2: configured Arabic and explicit Arabic queries never discover into English', () => {
    const source = convert('[Arabic](/ar/hidden)\n\n[Explicit](/id/hidden?lang=ar)\n\n[English](/id/generate?lang=en)');
    expect(mintlifyInternalLinkTargets(source, 'intro', undefined, undefined, 'en', ['en', 'ar'])).toEqual(['id/generate']);
  });
});
