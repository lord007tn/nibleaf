import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { BLOG_ENTRIES, type BlogEntry } from './blog';
import { articleHead } from './blog-seo';

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

const sourceBySlug = new Map(
  Object.entries(sourceModules).map(([file, source]) => [file.split('/').pop()?.replace(MDX_EXTENSION_RE, '') ?? file, source]),
);

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

  it('emits reciprocal canonical, language, and x-default links for every translated article', () => {
    const bySlug = new Map(BLOG_ENTRIES.map((entry) => [entry.slug, entry]));
    for (const entry of BLOG_ENTRIES) {
      if (!entry.translationOf) continue;
      const translation = bySlug.get(entry.translationOf);
      expect(translation).toBeDefined();
      const links = articleHead(entry, translation).links;
      expect(links).toContainEqual({ rel: 'canonical', href: expect.stringMatching(`/blog/${entry.slug}$`) });
      expect(links).toContainEqual({ rel: 'alternate', hrefLang: entry.language ?? 'en', href: expect.stringMatching(`/blog/${entry.slug}$`) });
      expect(links).toContainEqual({
        rel: 'alternate',
        hrefLang: translation?.language ?? 'en',
        href: expect.stringMatching(`/blog/${translation?.slug}$`),
      });
      expect(links).toContainEqual({
        rel: 'alternate',
        hrefLang: 'x-default',
        href: expect.stringMatching(`/blog/${(entry.language ?? 'en') === 'en' ? entry.slug : translation?.slug}$`),
      });
    }
  });

  it('keeps the corrective bilingual owners substantive rather than summary translations', () => {
    const slugs = [
      'ai-ready-documentation',
      'coolify-documentation-502-503-recovery',
      'docs-should-live-in-plain-markdown',
      'documentation-information-architecture-collaboration',
      'documentation-migration-seo-cutover-lab',
      'documentation-production-readiness-decision',
      'open-source-documentation-tools',
      'self-host-documentation-site-docker-compose',
      'versioned-documentation-release-lifecycle',
      'private-documentation-ai-access-verification',
      'mcp-documentation-security-threat-model',
      'openapi-try-it-security-versioning',
    ];
    for (const slug of slugs) {
      const entry = BLOG_ENTRIES.find((candidate) => candidate.slug === slug);
      expect(entry?.translationOf).toBeDefined();
      for (const pairSlug of [slug, entry?.translationOf]) {
        const source = sourceBySlug.get(pairSlug ?? '') ?? '';
        const body = source.replace(/^---\r?\n[\s\S]*?\r?\n---/, '');
        expect(body.match(/^## /gm)?.length ?? 0, `${pairSlug} needs task-complete sections`).toBeGreaterThanOrEqual(4);
        expect(body.split(/\s+/u).filter(Boolean).length, `${pairSlug} is too thin`).toBeGreaterThan(250);
      }
    }
  });
});
