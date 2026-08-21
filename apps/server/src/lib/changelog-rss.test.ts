import { describe, expect, it } from 'vitest';
import { buildChangelogRss } from './changelog-rss';

describe('buildChangelogRss', () => {
  it('escapes content and emits stable release links and dates', () => {
    const rss = buildChangelogRss({
      baseUrl: 'https://docs.example.com',
      title: 'Acme & Co',
      description: 'Product <updates>',
      entries: [{ version: 7, date: '2026-08-21T10:00:00.000Z', title: 'Search & exports', pages: 2 }],
    });
    expect(rss).toContain('<title>Acme &amp; Co changelog</title>');
    expect(rss).toContain('<description>Product &lt;updates&gt;</description>');
    expect(rss).toContain('https://docs.example.com/changelog#release-v7');
    expect(rss).toContain('<pubDate>Fri, 21 Aug 2026 10:00:00 GMT</pubDate>');
    expect(rss).toContain('href="https://docs.example.com/changelog/rss.xml"');
  });
});
