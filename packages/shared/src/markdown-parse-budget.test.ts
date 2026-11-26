import { describe, expect, it } from 'vitest';
import { collectPageContentFacts } from './page-content-facts';
import { markdownParseLimit } from './page-limits';
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
    expect(collectPageContentFacts(`[Guide](/guide)\n\n${content}`).links[0]).toBe('/guide');
  });

  it('still resolves links after a long run of reference definitions', () => {
    const definitions = Array.from({ length: 600 }, (_, index) => `[#${index}]: /releases/${index}`).join('\n');
    expect(collectPageContentFacts(`[Issue 17][#17]\n\n${definitions}`).links).toEqual(['/releases/17']);
  });

  it('reads math as raw content in the publish link check too', () => {
    const content = '$$\n[Display](/inside-display)\n$$\n\nUse $[Inline](/inside-inline)$ next.\n\n[Guide](/guide)';
    expect(collectPageContentFacts(content).links).toEqual(['/guide']);
  });
});

describe('a page with one block over the budget', () => {
  const deep = `${'<div>'.repeat(70)}Deep${'</div>'.repeat(70)}`;
  const content = ['# Guide', '', '[Before](/before)', '', deep, '', '## After', '', '[After](/after)'].join('\n');

  it('checks and renders the rest of the page', () => {
    expect(markdownParseLimit(content)).toBe('nesting');
    expect(collectPageContentFacts(content).links).toEqual(['/before', '/after']);
    expect(readerHeadings(content).map(({ text }) => text)).toEqual(['Guide', 'After']);
  });
});
