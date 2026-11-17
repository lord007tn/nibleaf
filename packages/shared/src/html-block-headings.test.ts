import { describe, expect, it } from 'vitest';
import { fencedMarkdownLines, markdownLineKinds } from './markdown-code';
import { readerSections } from './reader-headings';
import { extractHeadings } from './site';
import { HTML_BLOCK_HEADING_REPROS, HTML_BLOCK_REPEATED_HEADING, HTML_BLOCK_WITHOUT_BLANK, QUOTED_DOCTYPE_BLOCK } from './testing/fence-cases';

describe('headings inside an HTML block are not in the outline (#593)', () => {
  it.each(HTML_BLOCK_HEADING_REPROS)('lists only the heading after %s', (_name, source) => {
    expect(extractHeadings(source).map(({ text }) => text)).toEqual(['After']);
    expect(readerSections(source).map(({ text, line }) => [text, line])).toEqual([['After', source.split('\n').length - 1]]);
  });

  it('starts a section at the real heading, not at a repeat of it inside an HTML block', () => {
    expect(extractHeadings(HTML_BLOCK_REPEATED_HEADING).map(({ text }) => text)).toEqual(['After']);
    expect(readerSections(HTML_BLOCK_REPEATED_HEADING).map(({ text, line }) => [text, line])).toEqual([['After', 4]]);
  });

  it('keeps headings outside HTML blocks, including after a blank line ends one', () => {
    const source = '# Title\n\n<div>\n\n## Inside the div, after a blank line\n\n</div>\n\n```md\n# code\n```\n\n## Last';
    expect(extractHeadings(source).map(({ text }) => text)).toEqual(['Title', 'Inside the div, after a blank line', 'Last']);
    expect(markdownLineKinds(source.split('\n'))).toEqual([
      'prose',
      'prose',
      'html',
      'prose',
      'prose',
      'prose',
      'html',
      'prose',
      'code',
      'code',
      'code',
      'prose',
      'prose',
    ]);
  });

  it('leaves fencedMarkdownLines as the code lines of markdownLineKinds', () => {
    for (const [, source] of HTML_BLOCK_HEADING_REPROS) {
      const lines = source.split('\n');
      expect(fencedMarkdownLines(lines)).toEqual(markdownLineKinds(lines).map((kind) => kind === 'code'));
    }
  });
});

describe('the HTML block a heading consumer skips is exactly CommonMark’s', () => {
  it('ends a `<!DOCTYPE` block in a quote at a `>` in its content, not at the quote marker', () => {
    const lines = QUOTED_DOCTYPE_BLOCK.source.split('\n');
    expect(
      markdownLineKinds(lines)
        .map((kind) => (kind === 'html' ? 1 : 0))
        .join(''),
    ).toBe(QUOTED_DOCTYPE_BLOCK.html);
    expect(fencedMarkdownLines(lines).some(Boolean)).toBe(false);
  });

  it('keeps a heading right after an HTML block, with no blank line, inside the block', () => {
    expect(extractHeadings(HTML_BLOCK_WITHOUT_BLANK)).toEqual([]);
    expect(readerSections(HTML_BLOCK_WITHOUT_BLANK)).toEqual([]);
  });
});
