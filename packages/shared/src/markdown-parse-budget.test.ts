import { describe, expect, it } from 'vitest';
import { markdownParseLimit } from './page-limits';
import { pageContentFacts } from './publish-checks';
import { readerHeadings } from './reader-headings';
import { arabicParagraph, ORDINARY_PAGES } from './testing/markdown-parse-budget-cases';

describe('the Markdown parse budget on ordinary pages', () => {
  it('measures what the review measured', () => {
    const sizes = Object.fromEntries(ORDINARY_PAGES.map(([name, content]) => [name, content]));
    expect(sizes['65 Promise<User> in fenced TypeScript']?.length).toBeGreaterThan(6000);
    expect(sizes['an inline <svg> with a long path']?.length).toBeGreaterThan(8000);
    expect(sizes['minified one-line JSON in a fenced block']?.length).toBeGreaterThan(9500);
    expect(new TextEncoder().encode(arabicParagraph).length).toBeGreaterThan(27_000);
    expect(sizes['a 64k-character Arabic line']?.length).toBeGreaterThanOrEqual(65_536);
  });

  it.each(ORDINARY_PAGES)('keeps %s within budget, parsed as on main', (_name, content) => {
    expect(markdownParseLimit(content)).toBeNull();
    // The facts are read from the parse: a link beside the content is still checked.
    expect(pageContentFacts(`[Guide](/guide)\n\n${content}`, false).links).toEqual(['/guide']);
  });
});

describe('a page with one block over the budget', () => {
  const deep = `${'<div>'.repeat(70)}Deep${'</div>'.repeat(70)}`;
  const content = ['# Guide', '', '[Before](/before)', '', deep, '', '## After', '', '[After](/after)'].join('\n');

  it('checks and renders the rest of the page', () => {
    expect(markdownParseLimit(content)).toBe('nesting');
    expect(pageContentFacts(content, false).links).toEqual(['/before', '/after']);
    expect(readerHeadings(content).map(({ text }) => text)).toEqual(['Guide', 'After']);
  });
});
