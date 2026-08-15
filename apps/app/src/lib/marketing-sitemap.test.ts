import { describe, expect, it } from 'vitest';
import { MARKETING_SITEMAP, marketingSitemap, marketingSitemapEntries } from './marketing-sitemap';

describe('marketing sitemap', () => {
  it('uses the material-change date only for routes updated on August 15', () => {
    const lastmodByPath = Object.fromEntries(MARKETING_SITEMAP.map((entry) => [entry.path, entry.lastmod]));

    expect(lastmodByPath).toEqual({
      '/': '2026-08-15',
      '/cloud': '2026-07-13',
      '/pricing': '2026-08-15',
      '/self-hosting': '2026-08-15',
      '/about': '2026-08-15',
      '/contact': '2026-08-15',
      '/compare/nibleaf-vs-mintlify': '2026-08-15',
      '/compare/nibleaf-vs-gitbook': '2026-08-15',
      '/compare/nibleaf-vs-docusaurus': '2026-08-15',
      '/alternatives/mintlify': '2026-08-15',
      '/alternatives/gitbook': '2026-08-15',
      '/alternatives/readme': '2026-08-15',
      '/terms': '2026-08-15',
      '/privacy': '2026-08-15',
    });
  });

  it('renders one canonical XML entry per route with its recorded lastmod', () => {
    const entries = marketingSitemapEntries();
    const xml = marketingSitemap('https://nibleaf.com');

    expect(xml.match(/<url>/g)).toHaveLength(entries.length);
    expect(xml).toContain('<loc>https://nibleaf.com/pricing</loc>\n    <lastmod>2026-08-15</lastmod>');
    expect(xml).toContain('<loc>https://nibleaf.com/cloud</loc>\n    <lastmod>2026-07-13</lastmod>');
    expect(xml).not.toContain('<priority>');
    expect(xml).not.toContain('<changefreq>');
  });
});
