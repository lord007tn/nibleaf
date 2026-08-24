import { describe, expect, it } from 'vitest';
import { MARKETING_SITEMAP, marketingSitemap, marketingSitemapEntries } from './marketing-sitemap';

describe('marketing sitemap', () => {
  it('uses each route material-change date', () => {
    const lastmodByPath = Object.fromEntries(MARKETING_SITEMAP.map((entry) => [entry.path, entry.lastmod]));

    expect(lastmodByPath).toEqual({
      '/': '2026-08-24',
      '/ar': '2026-08-22',
      '/ar/documentation-platforms': '2026-08-22',
      '/cloud': '2026-07-13',
      '/pricing': '2026-08-24',
      '/self-hosting': '2026-08-15',
      '/about': '2026-08-24',
      '/contact': '2026-08-15',
      '/developers': '2026-08-24',
      '/tools/rtl-documentation-readiness': '2026-08-19',
      '/compare/nibleaf-vs-mintlify': '2026-08-17',
      '/compare/nibleaf-vs-gitbook': '2026-08-17',
      '/compare/nibleaf-vs-docusaurus': '2026-08-17',
      '/alternatives/mintlify': '2026-08-17',
      '/alternatives/gitbook': '2026-08-17',
      '/alternatives/readme': '2026-08-17',
      '/terms': '2026-08-15',
      '/privacy': '2026-08-15',
    });
  });

  it('renders one canonical XML entry per route with its recorded lastmod', () => {
    const entries = marketingSitemapEntries();
    const xml = marketingSitemap('https://nibleaf.com');

    expect(xml.match(/<url>/g)).toHaveLength(entries.length);
    expect(xml).toContain('<loc>https://nibleaf.com/pricing</loc>\n    <lastmod>2026-08-24</lastmod>');
    expect(xml).toContain('<loc>https://nibleaf.com/cloud</loc>\n    <lastmod>2026-07-13</lastmod>');
    expect(xml).not.toContain('<priority>');
    expect(xml).not.toContain('<changefreq>');
  });

  it('excludes route templates and intentionally blocked app and signup surfaces', () => {
    const paths = marketingSitemapEntries().map((entry) => entry.path);

    expect(paths).not.toContain('/sites/$projectId');
    expect(paths.some((path) => path === '/app' || path.startsWith('/app/'))).toBe(false);
    expect(paths).not.toContain('/sign-up');
  });
});
