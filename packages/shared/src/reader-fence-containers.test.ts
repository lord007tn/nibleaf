import { describe, expect, it } from 'vitest';
import { fencedMarkdownLines } from './markdown-code';
import { readerSections } from './reader-headings';
import { normalizeMdxBlocks } from './reader-markdown';
import { extractHeadings } from './site';
import { AFTER_FENCE, FENCE_CONTAINER_REPROS, INDENTED_FENCE_AFTER_QUOTE } from './testing/fence-cases';

describe('a fence in a quote or list item ends where CommonMark ends it (#587)', () => {
  it.each(FENCE_CONTAINER_REPROS)('the reader keeps the heading, section and embed after %s', (_name, example) => {
    const source = `${example}${AFTER_FENCE}`;
    const exampleLines = example.split('\n').length;
    expect(fencedMarkdownLines(source.split('\n'))).toEqual(source.split('\n').map((_line, index) => index < exampleLines));
    expect(extractHeadings(source).map(({ text }) => text)).toEqual(['After']);
    expect(readerSections(source).map(({ text }) => text)).toEqual(['After']);
    expect(normalizeMdxBlocks(source)).toContain('<mdxembed provider="youtube" videoid="M7lc1UVf-VE"');
  });

  it('keeps the heading, section and embed after indented code that looks like a fence, once a quote has ended (#590 council)', () => {
    const source = INDENTED_FENCE_AFTER_QUOTE;
    expect(fencedMarkdownLines(source.split('\n'))).toEqual([true, false, false, false, false, false, false]);
    expect(extractHeadings(source).map(({ text }) => text)).toEqual(['After']);
    expect(readerSections(source).map(({ text }) => text)).toEqual(['After']);
    expect(normalizeMdxBlocks(source)).toContain('<mdxembed provider="youtube" videoid="M7lc1UVf-VE"');
  });
});

const examples = [
  '> ```md\n> example\n>```',
  '> ```md\n> example\n> ```',
  '> > ```md\n> > example\n>>```',
  '> ```md\n>\texample\n>```',
  '>\t```md\n>\texample\n>\t```',
  '- ```md\n  example\n  ```',
  '- ```md\n\texample\n  ```',
] as const;
const article = (example: string) =>
  `${example}\n\n# After\n\n<iframe src="https://www.youtube-nocookie.com/embed/abcdefghijk" title="Tour"></iframe>`;

describe('reader container fence compatibility with main 93408093', () => {
  it('ends code before the following heading across optional quote spacing, nesting, tabs and lists', () => {
    expect(examples.map((example) => fencedMarkdownLines(article(example).split('\n'))[4])).toEqual(examples.map(() => false));
  });
  it('extractHeadings retains headings following valid container fences', () => {
    expect(examples.map((example) => extractHeadings(article(example)).map(({ text }) => text))).toEqual(examples.map(() => ['After']));
  });
  it('readerSections retains sections following valid container fences', () => {
    expect(examples.map((example) => readerSections(article(example)).map(({ text }) => text))).toEqual(examples.map(() => ['After']));
  });
  it('normalizes the following iframe into mdxembed after valid container fences', () => {
    expect(examples.map((example) => normalizeMdxBlocks(article(example)).includes('<mdxembed'))).toEqual(examples.map(() => true));
  });
});
