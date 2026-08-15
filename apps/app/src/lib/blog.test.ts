import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { BLOG_ENTRIES, type BlogEntry } from './blog';

const MDX_EXTENSION_RE = /\.mdx$/;
type Frontmatter = Omit<BlogEntry, 'slug'>;
const sourceModules = import.meta.glob<string>('../content/blog/*.mdx', { eager: true, query: '?raw', import: 'default' });

const sourceEntries = Object.entries(sourceModules)
  .map(([file, source]) => {
    const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
    if (!match?.[1]) throw new Error(`${file} is missing YAML frontmatter.`);
    const frontmatter = parse(match[1]) as Frontmatter;
    return { ...frontmatter, slug: file.split('/').pop()?.replace(MDX_EXTENSION_RE, '') ?? file };
  })
  .sort((a, b) => b.datePublished.localeCompare(a.datePublished) || a.slug.localeCompare(b.slug));

describe('blog metadata manifest', () => {
  it('matches every MDX frontmatter object so cards, sitemap, JSON-LD, and article content cannot drift', () => {
    expect(BLOG_ENTRIES).toEqual(sourceEntries);
  });

  it('has valid reciprocal translation links', () => {
    const bySlug = new Map(BLOG_ENTRIES.map((entry) => [entry.slug, entry]));
    for (const entry of BLOG_ENTRIES) {
      if (!entry.translationOf) continue;
      const translation = bySlug.get(entry.translationOf);
      expect(translation, `${entry.slug} translation is missing`).toBeDefined();
      expect(translation?.translationOf).toBe(entry.slug);
      expect(translation?.language ?? 'en').not.toBe(entry.language ?? 'en');
    }
  });
});
