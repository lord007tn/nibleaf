import { describe, expect, it } from 'vitest';
import type { SitePage } from '@/hooks/api/types';
import { pageHead } from './site-seo';

/** Find the value of a meta tag emitted by pageHead (matches name or property). */
const meta = (head: ReturnType<typeof pageHead>, key: string): string | undefined =>
  head.meta?.find((m) => m.name === key || m.property === key)?.content;
const title = (head: ReturnType<typeof pageHead>): string | undefined => head.meta?.find((m) => 'title' in m)?.title;
const canonical = (head: ReturnType<typeof pageHead>): string | undefined => head.links?.find((l) => l.rel === 'canonical')?.href;

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
  languages: [{ code: 'en', isDefault: true }],
  breadcrumbs: [],
  prev: null,
  next: null,
  ...over,
});

describe('pageHead SEO cascade', () => {
  it('falls back to the site SEO when neither page nor language override', () => {
    const head = pageHead(base(), 'p1');
    expect(title(head)).toBe('Quickstart — Acme');
    expect(meta(head, 'description')).toBe('Page own description');
    expect(meta(head, 'og:image')).toBe('https://cdn/site-og.png');
  });

  it('lets the language override the site name and social image', () => {
    const head = pageHead(base({ languageConfig: { seo: { metaTitle: 'Acme Docs AR', socialImage: 'https://cdn/lang-og.png' } } }), 'p1');
    expect(title(head)).toBe('Quickstart — Acme Docs AR');
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
