import { describe, expect, it } from 'vitest';
import { fencedMarkdownLines } from './markdown-code';
import { readerSections } from './reader-headings';
import { normalizeMdxBlocks } from './reader-markdown';
import { extractHeadings } from './site';
import { AFTER_FENCE, FENCE_CONTAINER_REPROS } from './testing/fence-cases';

describe('a fence in a quote or list item ends where CommonMark ends it (#587)', () => {
  it.each(FENCE_CONTAINER_REPROS)('the reader keeps the heading, section and embed after %s', (_name, example) => {
    const source = `${example}${AFTER_FENCE}`;
    const exampleLines = example.split('\n').length;
    expect(fencedMarkdownLines(source.split('\n'))).toEqual(source.split('\n').map((_line, index) => index < exampleLines));
    expect(extractHeadings(source).map(({ text }) => text)).toEqual(['After']);
    expect(readerSections(source).map(({ text }) => text)).toEqual(['After']);
    expect(normalizeMdxBlocks(source)).toContain('<mdxembed provider="youtube" videoid="M7lc1UVf-VE"');
  });
});
