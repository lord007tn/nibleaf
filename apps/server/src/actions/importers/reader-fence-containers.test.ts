import { extractHeadings } from '@nibleaf/shared';
import { readerSections } from '@nibleaf/shared/reader-headings';
import { normalizeMdxBlocks } from '@nibleaf/shared/reader-markdown';
import { describe, expect, it, vi } from 'vitest';
import { convertGitBookMarkdown } from './gitbook-markdown';
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
});
