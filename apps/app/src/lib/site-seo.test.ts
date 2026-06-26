import { describe, expect, it } from 'vitest';
import type { SitePage } from '@/hooks/api/types';
import { pageHead } from './site-seo';

/** Find the value of a meta tag emitted by pageHead (matches name or property). */
const meta = (head: ReturnType<typeof pageHead>, key: string): string | undefined =>
  head.meta?.find((m) => m.name === key || m.property === key)?.content;
const title = (head: ReturnType<typeof pageHead>): string | undefined => head.meta?.find((m) => 'title' in m)?.title;
const canonical = (head: ReturnType<typeof pageHead>): string | undefined => head.links?.find((l) => l.rel === 'canonical')?.href;
const hreflangs = (head: ReturnType<typeof pageHead>): Record<string, string> =>
  Object.fromEntries((head.links ?? []).filter((l) => l.rel === 'alternate').map((l) => [l.hreflang, l.href]));

const base = (over: Partial<SitePage> = {}): SitePage => ({
  project: {
    id: 'p1',
    name: 'Acme Docs',
    slug: 'acme',
    description: 'Site default description',
    color: '#5546e8',
    logoUrl: 'https://cdn/logo.png',
    faviconUrl: null,
    config: { seo: { metaTitle: 'Acme', metaDescription: 'Site SEO desc', socialImage: 'https://cdn/site-og.png' } },
  },
  activeLanguage: 'en',
  page: {
    id: 'pg',
    title: 'Quickstart',
    description: 'Page own description',
    icon: null,
    path: 'quickstart',
    content: '',
    headings: [],
    config: null,
  },
  languageConfig: null,
  languages: [{ code: 'en', isDefault: true, path: 'quickstart' }],
  breadcrumbs: [],
  prev: null,
  next: null,
  ...over,
});

describe('pageHead SEO cascade', () => {
  it('uses the explicit site SEO title/description/image when nothing overrides', () => {
    const head = pageHead(base(), 'p1');
    expect(title(head)).toBe('Quickstart — Acme');
    // Explicit project SEO description wins over the auto-derived body excerpt.
    expect(meta(head, 'description')).toBe('Site SEO desc');
    expect(meta(head, 'og:image')).toBe('https://cdn/site-og.png');
  });

  it('falls back to the page body description only when no SEO override exists', () => {
    const head = pageHead(base({ project: { ...base().project, config: { seo: { metaTitle: 'Acme' } } } }), 'p1');
    expect(meta(head, 'description')).toBe('Page own description');
  });

  it('lets the language override the site name, social image, and description', () => {
    const head = pageHead(
      base({ languageConfig: { seo: { metaTitle: 'Acme Docs AR', metaDescription: 'Lang desc', socialImage: 'https://cdn/lang-og.png' } } }),
      'p1',
    );
    expect(title(head)).toBe('Quickstart — Acme Docs AR');
    expect(meta(head, 'description')).toBe('Lang desc');
    expect(meta(head, 'og:image')).toBe('https://cdn/lang-og.png');
  });

  it('lets the page win over both language and site (title, description, image, canonical)', () => {
    const head = pageHead(
      base({
        languageConfig: { seo: { metaTitle: 'Acme AR', socialImage: 'https://cdn/lang-og.png' } },
        page: {
          ...base().page,
          config: {
            seo: {
              metaTitle: 'Custom Title',
              metaDescription: 'Custom desc',
              ogImage: 'https://cdn/page-og.png',
              canonicalUrl: 'https://example.com/canonical',
            },
          },
        },
      }),
      'p1',
    );
    expect(title(head)).toBe('Custom Title');
    expect(meta(head, 'og:title')).toBe('Custom Title');
    expect(meta(head, 'description')).toBe('Custom desc');
    expect(meta(head, 'og:image')).toBe('https://cdn/page-og.png');
    expect(canonical(head)).toBe('https://example.com/canonical');
  });

  it('emits noindex when the page sets noindex, even if the site allows indexing', () => {
    const head = pageHead(base({ page: { ...base().page, config: { seo: { noindex: true } } } }), 'p1');
    expect(meta(head, 'robots')).toBe('noindex,nofollow');
  });

  it('emits noindex when the language disallows indexing', () => {
    const head = pageHead(base({ languageConfig: { seo: { allowIndex: false } } }), 'p1');
    expect(meta(head, 'robots')).toBe('noindex,nofollow');
  });
});

describe('pageHead canonical + hreflang', () => {
  it('canonicalizes the default language to a clean (param-less) URL', () => {
    const head = pageHead(base({ activeLanguage: 'en' }), 'p1', 'en');
    expect(canonical(head)).toBe('http://localhost:4310/sites/p1/quickstart');
  });

  it('uses the resolved language for canonical even when the request fell back', () => {
    // Requested ?lang=ar but the page only exists in the default (en) → resolved en.
    const head = pageHead(base({ activeLanguage: 'en' }), 'p1', 'ar');
    expect(canonical(head)).toBe('http://localhost:4310/sites/p1/quickstart');
  });

  it('emits hreflang only for languages that actually have the page, default param-less', () => {
    const head = pageHead(
      base({
        activeLanguage: 'ar',
        languages: [
          { code: 'en', isDefault: true, path: 'quickstart' },
          { code: 'ar', isDefault: false, path: 'quickstart' },
          { code: 'fr', isDefault: false, path: null }, // no French page → omitted
        ],
      }),
      'p1',
      'ar',
    );
    const alts = hreflangs(head);
    expect(alts.en).toBe('http://localhost:4310/sites/p1/quickstart');
    expect(alts.ar).toBe('http://localhost:4310/sites/p1/quickstart?lang=ar');
    expect(alts['x-default']).toBe('http://localhost:4310/sites/p1/quickstart');
    expect(alts.fr).toBeUndefined();
    // Non-default active language canonicalizes WITH its ?lang param.
    expect(canonical(head)).toBe('http://localhost:4310/sites/p1/quickstart?lang=ar');
  });

  it('omits hreflang entirely when only one language has the page', () => {
    const head = pageHead(
      base({
        languages: [
          { code: 'en', isDefault: true, path: 'quickstart' },
          { code: 'ar', isDefault: false, path: null },
        ],
      }),
      'p1',
    );
    expect(Object.keys(hreflangs(head))).toHaveLength(0);
  });

  it('does not append ?lang=en for a legacy snapshot with no Language rows', () => {
    // P1-style: the snapshot predates the languages feature → languages: [] →
    // the default is unknown, so the canonical must stay param-less (matching the
    // sitemap) instead of emitting a duplicate ?lang=en URL.
    const head = pageHead(base({ languages: [], activeLanguage: 'en' }), 'p1', 'en');
    expect(canonical(head)).toBe('http://localhost:4310/sites/p1/quickstart');
  });
});

describe('pageHead og:locale', () => {
  it('advertises the active language as og:locale', () => {
    expect(meta(pageHead(base(), 'p1'), 'og:locale')).toBe('en_US');
  });

  it('lists the other real translations as og:locale:alternate', () => {
    const head = pageHead(
      base({
        activeLanguage: 'ar',
        languages: [
          { code: 'ar', isDefault: false, path: 'quickstart' },
          { code: 'en', isDefault: true, path: 'quickstart' },
        ],
      }),
      'p1',
      'ar',
    );
    expect(meta(head, 'og:locale')).toBe('ar_AR');
    expect(head.meta?.some((m) => m.property === 'og:locale:alternate' && m.content === 'en_US')).toBe(true);
  });
});

describe('pageHead JSON-LD', () => {
  const ld = (head: ReturnType<typeof pageHead>): Array<Record<string, unknown>> =>
    (head.scripts ?? []).filter((s) => s.type === 'application/ld+json').map((s) => JSON.parse(s.children) as Record<string, unknown>);

  it('emits a TechArticle for the page', () => {
    const article = ld(pageHead(base(), 'p1')).find((block) => block['@type'] === 'TechArticle');
    expect(article).toBeDefined();
    expect(article?.headline).toBe('Quickstart');
    expect(article?.url).toBe('http://localhost:4310/sites/p1/quickstart');
  });

  it('emits a BreadcrumbList when breadcrumbs exist, and omits it otherwise', () => {
    const withCrumbs = pageHead(
      base({
        breadcrumbs: [
          { title: 'Guides', path: 'guides' },
          { title: 'Quickstart', path: 'quickstart' },
        ],
      }),
      'p1',
    );
    const list = ld(withCrumbs).find((block) => block['@type'] === 'BreadcrumbList');
    expect(list).toBeDefined();
    expect((list?.itemListElement as unknown[]).length).toBe(2);

    expect(ld(pageHead(base(), 'p1')).some((block) => block['@type'] === 'BreadcrumbList')).toBe(false);
  });
});
