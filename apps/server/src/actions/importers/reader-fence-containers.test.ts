import { extractHeadings } from '@nibleaf/shared';
import { readerSections } from '@nibleaf/shared/reader-headings';
import { normalizeMdxBlocks } from '@nibleaf/shared/reader-markdown';
import { describe, expect, it, vi } from 'vitest';
import { convertGitBookMarkdown } from './gitbook-markdown';
import { importCodeLines } from './import-markdown-code';
import { rewriteMintlifyInternalLinks } from './mintlify-links';
import { normalizeMintlifyMdx } from './mintlify-mdx';

// Some tests here work through large generated case sets or whole documentation
// corpora. On a loaded CI runner such tests have taken ~28x as long as on a laptop
// (5.5 s against 0.19 s), past Vitest's 5 s default, so the file gets an explicit
// timeout. Their cost stays linear; the *.growth.test.ts files pin that.
vi.setConfig({ testTimeout: 60_000 });

describe.each([
  ['GitBook', (source: string) => convertGitBookMarkdown(source, { resolveFile: () => undefined }).content],
  ['Mintlify', normalizeMintlifyMdx],
] as const)('%s container fences remain compatible with the published reader', (_name, convert) => {
  it('keeps later headings, sections and embeds visible', () => {
    const examples = [
      '> ```md\n> example\n>```',
      '> ```md\n> example\n> ```',
      '> > ```md\n> > example\n>>```',
      '> ```md\n>\texample\n>```',
      '>\t```md\n>\texample\n>\t```',
      '- ```md\n  example\n  ```',
      '- ```md\n\texample\n  ```',
    ];
    const results = examples.map((example) => {
      const source = `${example}\n\n# After\n\n<iframe src="https://www.youtube-nocookie.com/embed/abcdefghijk" title="Tour"></iframe>\n\n[Next](/next)`;
      const content = convert(source);
      return {
        headings: extractHeadings(content).map(({ text }) => text),
        sections: readerSections(content).map(({ text }) => text),
        embed: normalizeMdxBlocks(content).includes('<mdxembed'),
      };
    });
    expect(results).toEqual(examples.map(() => ({ headings: ['After'], sections: ['After'], embed: true })));
  });
  it('rewrites following prose links after optional quoted fence closers', () => {
    const examples = ['> ```md\n> example\n>```', '> > ```md\n> > example\n>>```', '> ```md\n>\texample\n>```'];
    const rewritten = examples.map((example) =>
      rewriteMintlifyInternalLinks(convert(`${example}\n\n[Next](/next)`), 'intro', new Map([['next', '/guide/next']])).includes(
        '[Next](/guide/next)',
      ),
    );
    expect(rewritten).toEqual([true, true, true]);
  });

  it.each([
    ['quote tab', '>\t', '>\t', 4],
    ['quote tab inside ordered list', '1. >\t', '   >\t', 5],
  ])('protects literal provider links and source bytes in %s', (_form, opener, body, length) => {
    const literal = `${opener}\`\`\`md\n${body}[Tour](https://youtu.be/abcdefghijk)\n${body}${'`'.repeat(length)}`;
    const source = `<CodeGroup>\n${literal}\n</CodeGroup>\n\n[After](/next)`;
    const lines = importCodeLines(source);
    expect(lines.slice(1, 4)).toEqual([true, true, true]);
    expect(lines.at(-1)).toBe(false);
    const content = rewriteMintlifyInternalLinks(convert(source), 'intro', new Map([['next', '/guide/next']]));
    expect(content).toContain(literal);
    expect(content).not.toContain('<iframe');
    expect(content).toContain('[After](/guide/next)');
  });

  it.each([
    ['unindented quote', '> ```md\n> [Literal](/literal)'],
    ['indented list with a blank line', '    - ```md\n      [Literal](/literal)\n\n      [Still literal](/literal)'],
  ])('ends an unclosed %s fence at the component closer', (_name, example) => {
    const source = `<CodeGroup>\n${example}\n</CodeGroup>\n\n[After](/next)`;
    const content = rewriteMintlifyInternalLinks(
      convert(source),
      'intro',
      new Map([
        ['next', '/rewritten'],
        ['literal', '/changed'],
      ]),
    );
    expect(content).toContain('[Literal](/literal)');
    if (example.includes('Still literal')) expect(content).toContain('[Still literal](/literal)');
    expect(content).not.toContain('/changed');
    expect(content).toContain('[After](/rewritten)');
    expect(normalizeMintlifyMdx(content)).not.toContain('</CodeGroup>');
  });

  it.each([
    ['multiline', '<Image\n  src="/cover.png"\n/>'],
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
  ])('preserves indented code after a %s component while rewriting prose', (_form, component) => {
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
});
