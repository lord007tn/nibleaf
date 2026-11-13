import { extractHeadings } from '@nibleaf/shared';
import { readerSections } from '@nibleaf/shared/reader-headings';
import { normalizeMdxBlocks } from '@nibleaf/shared/reader-markdown';
import { describe, expect, it } from 'vitest';
import { convertGitBookMarkdown } from './gitbook-markdown';
import { rewriteMintlifyInternalLinks } from './mintlify-links';
import { normalizeMintlifyMdx } from './mintlify-mdx';

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
});
