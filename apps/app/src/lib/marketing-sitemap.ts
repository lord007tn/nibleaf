import { BLOG_ENTRIES } from '@/lib/blog';

export interface MarketingSitemapEntry {
  path: string;
  lastmod: string;
}

/** Static marketing routes for the generated sitemap, each with its own lastmod
 * (rolled forward only when that page materially changes). Blog URLs are
 * appended from the article frontmatter registry. */
export const MARKETING_SITEMAP: MarketingSitemapEntry[] = [
  { path: '/', lastmod: '2026-08-24' },
  { path: '/ar', lastmod: '2026-08-22' },
  { path: '/ar/documentation-platforms', lastmod: '2026-08-22' },
  { path: '/cloud', lastmod: '2026-07-13' },
  { path: '/pricing', lastmod: '2026-08-24' },
  { path: '/self-hosting', lastmod: '2026-08-15' },
  { path: '/about', lastmod: '2026-08-24' },
  { path: '/contact', lastmod: '2026-08-15' },
  { path: '/developers', lastmod: '2026-08-24' },
  { path: '/tools/rtl-documentation-readiness', lastmod: '2026-08-19' },
  { path: '/compare/nibleaf-vs-mintlify', lastmod: '2026-08-17' },
  { path: '/compare/nibleaf-vs-gitbook', lastmod: '2026-08-17' },
  { path: '/compare/nibleaf-vs-docusaurus', lastmod: '2026-08-17' },
  { path: '/alternatives/mintlify', lastmod: '2026-08-17' },
  { path: '/alternatives/gitbook', lastmod: '2026-08-17' },
  { path: '/alternatives/readme', lastmod: '2026-08-17' },
  { path: '/terms', lastmod: '2026-08-15' },
  { path: '/privacy', lastmod: '2026-08-15' },
];

/** All marketing sitemap entries: static routes + /blog + one URL per article. */
export function marketingSitemapEntries(): MarketingSitemapEntry[] {
  const blogLastmod = BLOG_ENTRIES.reduce((max, entry) => (entry.dateModified > max ? entry.dateModified : max), '2026-07-13');
  return [
    ...MARKETING_SITEMAP,
    { path: '/blog', lastmod: blogLastmod },
    ...BLOG_ENTRIES.map((entry) => ({ path: `/blog/${entry.slug}`, lastmod: entry.dateModified })),
  ];
}

export function marketingSitemap(origin: string): string {
  const urls = marketingSitemapEntries()
    .map((entry) => `  <url>\n    <loc>${origin}${entry.path}</loc>\n    <lastmod>${entry.lastmod}</lastmod>\n  </url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
