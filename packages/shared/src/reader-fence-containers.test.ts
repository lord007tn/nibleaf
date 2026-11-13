import { describe, expect, it } from 'vitest';
import { fencedMarkdownLines } from './markdown-code';
import { readerSections } from './reader-headings';
import { normalizeMdxBlocks } from './reader-markdown';
import { extractHeadings } from './site';

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
