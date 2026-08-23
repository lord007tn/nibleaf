import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SitePage, SiteShell } from '@/hooks/api/types';
import { canonicalSiteBase, changelogFeedUrl, pageHead, siteHead } from './site-seo';

// Keep the canonical tests hermetic: a developer's local .env may configure a
// VITE_SITE_BASE_DOMAIN, which would flip the default canonical to a subdomain.
beforeEach(() => {
  vi.stubEnv('VITE_SITE_BASE_DOMAIN', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

/** Find the value of a meta tag emitted by pageHead (matches name or property). */
const meta = (head: ReturnType<typeof pageHead>, key: string): string | undefined =>
  head.meta?.find((m) => m.name === key || m.property === key)?.content;
const title = (head: ReturnType<typeof pageHead>): string | undefined => head.meta?.find((m) => 'title' in m)?.title;
const canonical = (head: ReturnType<typeof pageHead>): string | undefined => head.links?.find((l) => l.rel === 'canonical')?.href;
const hreflangs = (head: ReturnType<typeof pageHead>): Record<string, string> =>
  Object.fromEntries((head.links ?? []).filter((l) => l.rel === 'alternate').map((l) => [l.hrefLang, l.href]));

const base = (over: Partial<SitePage> = {}): SitePage => ({
  project: {
    id: 'p1',
    name: 'Acme Docs',
    slug: 'acme',
    description: 'Site default description',
    primaryDomain: null,
    config: { seo: { metaTitle: 'Acme', metaDescription: 'Site SEO desc', socialImage: 'https://cdn/site-og.png' } },
  },
  activeLanguage: 'en',
  activeVersion: 'main',
  versions: [{ id: 'main', name: 'main', slug: 'main', isDefault: true }],
  page: {
    id: 'pg',
    createdAt: '2025-12-15T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
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
  it('uses the page-authored description before the project-wide default', () => {
    const head = pageHead(base(), 'p1');
    expect(title(head)).toBe('Quickstart — Acme');
    expect(meta(head, 'description')).toBe('Page own description');
    expect(meta(head, 'og:image')).toBe('https://cdn/site-og.png');
  });

  it('falls back to the project SEO description when the page has no summary', () => {
    const head = pageHead(base({ page: { ...base().page, description: '' } }), 'p1');
    expect(meta(head, 'description')).toBe('Site SEO desc');
  });

  it('lets the language override the site name, social image, and description', () => {
    const head = pageHead(
      base({
        page: { ...base().page, description: '' },
        languageConfig: { seo: { metaTitle: 'Acme Docs AR', metaDescription: 'Lang desc', socialImage: 'https://cdn/lang-og.png' } },
      }),
      'p1',
    );
    expect(title(head)).toBe('Quickstart — Acme Docs AR');
    expect(meta(head, 'description')).toBe('Lang desc');
    expect(meta(head, 'og:image')).toBe('https://cdn/lang-og.png');
  });

  it("uses the language's localized site name when no SEO meta title overrides it", () => {
    const head = pageHead(
      base({
        project: { ...base().project, config: { seo: { metaDescription: 'Site SEO desc' } } },
        languageConfig: { name: 'وثائق أكمي' },
      }),
      'p1',
    );
    expect(title(head)).toBe('Quickstart — وثائق أكمي');
  });

  it('lets SEO meta titles (language, then project) win over the localized site name', () => {
    // Project SEO metaTitle beats the language's localized name…
    const withProjectSeo = pageHead(base({ languageConfig: { name: 'وثائق أكمي' } }), 'p1');
    expect(title(withProjectSeo)).toBe('Quickstart — Acme');
    // …and the language's own SEO metaTitle beats both.
    const withLangSeo = pageHead(base({ languageConfig: { name: 'وثائق أكمي', seo: { metaTitle: 'Acme AR SEO' } } }), 'p1');
    expect(title(withLangSeo)).toBe('Quickstart — Acme AR SEO');
  });

  it("falls back to the language's localized description before the project description", () => {
    const head = pageHead(
      base({
        project: { ...base().project, config: null },
        page: { ...base().page, description: '' },
        languageConfig: { description: 'وصف مترجم' },
      }),
      'p1',
    );
    expect(meta(head, 'description')).toBe('وصف مترجم');
  });

  it("names the JSON-LD WebSite with the language's localized site name", () => {
    const head = pageHead(base({ languageConfig: { name: 'وثائق أكمي' } }), 'p1');
    const article = (head.scripts ?? [])
      .filter((s) => s.type === 'application/ld+json')
      .map((s) => JSON.parse(s.children ?? '{}') as { '@type'?: string; isPartOf?: { name?: string } })
      .find((block) => block['@type'] === 'TechArticle');
    expect(article?.isPartOf?.name).toBe('وثائق أكمي');
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
    expect(Object.keys(hreflangs(head))).toHaveLength(0);
  });

  it('emits noindex when the page sets noindex, even if the site allows indexing', () => {
    const head = pageHead(base({ page: { ...base().page, config: { seo: { noindex: true } } } }), 'p1');
    expect(meta(head, 'robots')).toBe('noindex,nofollow');
    expect(Object.keys(hreflangs(head))).toHaveLength(0);
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
});

describe('canonical consolidation across origins', () => {
  /** A page payload whose project carries a verified primary custom domain. */
  const withPrimary = (over: Partial<SitePage> = {}): SitePage => {
    const data = base(over);
    data.project.primaryDomain = 'docs.acme.com';
    return data;
  };

  it('canonicalizes to the primary custom domain on the app origin', () => {
    const head = pageHead(withPrimary(), 'p1', 'en');
    expect(canonical(head)).toBe('https://docs.acme.com/quickstart');
    expect(meta(head, 'og:url')).toBe('https://docs.acme.com/quickstart');
  });

  it('canonicalizes to the primary domain even when the request arrived on another origin', () => {
    // A secondary verified domain still serves the site — its canonical must
    // point at the primary, not at itself (no split SEO equity).
    const head = pageHead(withPrimary(), 'p1', 'en', 'https://old-docs.acme.com');
    expect(canonical(head)).toBe('https://docs.acme.com/quickstart');
  });

  it('builds hreflang alternates and x-default on the same canonical base', () => {
    const head = pageHead(
      withPrimary({
        activeLanguage: 'ar',
        languages: [
          { code: 'en', isDefault: true, path: 'quickstart' },
          { code: 'ar', isDefault: false, path: 'quickstart' },
        ],
      }),
      'p1',
      'ar',
      'https://old-docs.acme.com',
    );
    const alts = hreflangs(head);
    expect(alts.en).toBe('https://docs.acme.com/quickstart');
    expect(alts.ar).toBe('https://docs.acme.com/quickstart?lang=ar');
    expect(alts['x-default']).toBe('https://docs.acme.com/quickstart');
  });

  it('points the TechArticle isPartOf at the canonical base', () => {
    const head = pageHead(withPrimary(), 'p1');
    const article = (head.scripts ?? [])
      .filter((s) => s.type === 'application/ld+json')
      .map((s) => JSON.parse(s.children ?? '{}') as { '@type'?: string; isPartOf?: { url?: string } })
      .find((block) => block['@type'] === 'TechArticle');
    expect(article?.isPartOf?.url).toBe('https://docs.acme.com');
  });

  it('falls back to the slug subdomain when a base domain is configured and no primary exists', () => {
    vi.stubEnv('VITE_SITE_BASE_DOMAIN', 'nibleaf.site');
    const head = pageHead(base(), 'p1', 'en');
    expect(canonical(head)).toBe('https://acme.nibleaf.site/quickstart');
  });

  it('keeps canonicalizing a custom-domain request to itself when nothing better is known', () => {
    const head = pageHead(base(), 'p1', 'en', 'https://docs.custom.com');
    expect(canonical(head)).toBe('https://docs.custom.com/quickstart');
  });
});

describe('canonicalSiteBase priority', () => {
  it('primary domain > slug subdomain > request origin > app origin', () => {
    expect(
      canonicalSiteBase('p1', { primaryDomain: 'docs.acme.com', slug: 'acme', baseDomain: 'nibleaf.site', requestOrigin: 'https://x.example' }),
    ).toBe('https://docs.acme.com');
    expect(canonicalSiteBase('p1', { slug: 'acme', baseDomain: 'nibleaf.site', requestOrigin: 'https://x.example' })).toBe(
      'https://acme.nibleaf.site',
    );
    expect(canonicalSiteBase('p1', { slug: 'acme', baseDomain: null, requestOrigin: 'https://x.example' })).toBe('https://x.example');
    expect(canonicalSiteBase('p1', { baseDomain: null })).toBe('http://localhost:4310/sites/p1');
  });

  it('normalizes the primary domain host', () => {
    expect(canonicalSiteBase('p1', { primaryDomain: ' Docs.Acme.COM ' })).toBe('https://docs.acme.com');
  });
});

describe('changelogFeedUrl', () => {
  it('appends rss.xml before a localized page query string', () => {
    expect(changelogFeedUrl('https://docs.example.com/changelog?lang=fr')).toBe('https://docs.example.com/changelog/rss.xml?lang=fr');
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
    (head.scripts ?? []).filter((s) => s.type === 'application/ld+json').map((s) => JSON.parse(s.children ?? '{}') as Record<string, unknown>);

  it('emits a TechArticle for the page', () => {
    const article = ld(pageHead(base(), 'p1')).find((block) => block['@type'] === 'TechArticle');
    expect(article).toBeDefined();
    expect(article?.headline).toBe('Quickstart');
    expect(article?.url).toBe('http://localhost:4310/sites/p1/quickstart');
    expect(article?.datePublished).toBe('2025-12-15T00:00:00.000Z');
    expect(article?.dateModified).toBe('2026-01-01T00:00:00.000Z');
    expect(article).not.toHaveProperty('author');
    expect(article).not.toHaveProperty('publisher');
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
    expect(list?.itemListElement).toHaveLength(2);

    expect(ld(pageHead(base(), 'p1')).some((block) => block['@type'] === 'BreadcrumbList')).toBe(false);
  });
});

describe('siteHead analytics scripts', () => {
  const shell = (config: SiteShell['project']['config'], languageConfig: SiteShell['languageConfig'] = null): SiteShell => ({
    project: {
      id: 'p1',
      name: 'Acme Docs',
      slug: 'acme',
      description: null,
      primaryDomain: null,
      config,
    },
    nav: [],
    languages: [],
    versions: [],
    activeLanguage: 'en',
    activeVersion: 'main',
    languageConfig,
    version: 1,
    generatedAt: '2026-07-01T00:00:00.000Z',
  });

  it('advertises the project name as og:site_name, localized by the active language', () => {
    const plain = siteHead(shell(null));
    expect(plain.meta?.find((m) => m.property === 'og:site_name')?.content).toBe('Acme Docs');
    const localized = siteHead(shell(null, { name: 'وثائق أكمي' }));
    expect(localized.meta?.find((m) => m.property === 'og:site_name')?.content).toBe('وثائق أكمي');
  });

  it('advertises the sitemap on the canonical custom domain', () => {
    const site = shell(null);
    site.project.primaryDomain = 'docs.acme.com';
    expect(siteHead(site).links?.find((link) => link.rel === 'sitemap')?.href).toBe('https://docs.acme.com/sitemap.xml');
  });

  it('emits configured analytics scripts when consent is not required', () => {
    const head = siteHead(shell({ analytics: { ga4: 'G-ABC123', plausible: 'docs.example.com' } }));
    expect(head.scripts?.some((script) => script.src === 'https://www.googletagmanager.com/gtag/js?id=G-ABC123')).toBe(true);
    expect(head.scripts?.some((script) => script.src === 'https://plausible.io/js/script.js' && script['data-domain'] === 'docs.example.com')).toBe(
      true,
    );
  });

  it('withholds third-party analytics scripts when cookie consent is required', () => {
    const head = siteHead(shell({ analytics: { ga4: 'G-ABC123', plausible: 'docs.example.com', cookieConsent: true } }));
    expect(head.scripts).toBeUndefined();
  });
});

describe('pageHead not-found (soft-404)', () => {
  it('emits robots noindex + a distinct title for a missing page so crawlers de-index dead URLs', () => {
    const head = pageHead(null, 'p1');
    expect(title(head)).toBe('Page not found');
    expect(meta(head, 'robots')).toBe('noindex,nofollow');
    // No canonical for a page that does not exist.
    expect(canonical(head)).toBeUndefined();
  });

  it('does NOT mark a real, indexable page as noindex', () => {
    const head = pageHead(base(), 'p1');
    expect(meta(head, 'robots')).toBeUndefined();
  });
});
