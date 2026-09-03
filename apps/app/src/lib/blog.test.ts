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

  it('uses the Arabic homepage owner in Arabic article breadcrumbs', () => {
    const entry = BLOG_ENTRIES.find((candidate) => candidate.language === 'ar');
    expect(entry).toBeDefined();
    const breadcrumb = JSON.parse(articleHead(entry as BlogEntry).scripts[1]?.children ?? '{}') as {
      itemListElement: { item: string }[];
    };

    expect(new URL(breadcrumb.itemListElement[0]?.item ?? '').pathname).toBe('/ar');
  });

  it('keeps the Arabic RTL checklist linked to the Arabic Markdown guide owner', () => {
    const source = sourceBySlug.get('arabic-technical-documentation-rtl-checklist') ?? '';

    expect(source).toContain('/blog/docs-should-live-in-plain-markdown-ar');
    expect(source).not.toMatch(/\/blog\/docs-should-live-in-plain-markdown\)/u);
  });

  it('keeps the Arabic RTL checklist Read Next cards on Arabic paired owners', () => {
    const entry = BLOG_ENTRIES.find((candidate) => candidate.slug === 'arabic-technical-documentation-rtl-checklist');
    const bySlug = new Map(BLOG_ENTRIES.map((candidate) => [candidate.slug, candidate]));
    const relatedOwners = entry?.related?.filter((slug) => slug !== entry.translationOf) ?? [];

    expect(relatedOwners).toEqual(['docs-should-live-in-plain-markdown-ar', 'self-host-documentation-site-docker-compose-ar']);
    for (const slug of relatedOwners) expect(bySlug.get(slug)?.language).toBe('ar');
  });

  it('keeps dated primary sources on the MCP and OpenAPI academy pairs', () => {
    const expectedSources = {
      'mcp-documentation-security-threat-model': [
        'https://modelcontextprotocol.io/specification/latest',
        'https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization',
        'https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html',
      ],
      'openapi-try-it-security-versioning': [
        'https://spec.openapis.org/oas/latest.html',
        'https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS',
        'https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html',
      ],
    } as const;

    for (const [englishSlug, urls] of Object.entries(expectedSources)) {
      const english = BLOG_ENTRIES.find((candidate) => candidate.slug === englishSlug);
      expect(english?.translationOf).toBeDefined();
      for (const slug of [englishSlug, english?.translationOf]) {
        const source = sourceBySlug.get(slug ?? '') ?? '';
        expect(source).toContain('2026-09-03');
        for (const url of urls) expect(source).toContain(url);
      }
    }
  });

  it('uses the current live information-architecture references', () => {
    const english = sourceBySlug.get('documentation-information-architecture-collaboration') ?? '';
    const arabic = sourceBySlug.get('documentation-information-architecture-collaboration-ar') ?? '';

    expect(english).toContain('https://starlight.astro.build/guides/sidebar/');
    expect(english).not.toContain('](https://starlight.astro.build/guides/)');
    expect(arabic).toContain('https://developers.google.com/search/docs/crawling-indexing/url-structure');
    expect(arabic).not.toContain('https://developers.google.com/search/docs/crawling-indexing/site-structure');
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
