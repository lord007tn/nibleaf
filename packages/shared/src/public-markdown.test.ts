import { describe, expect, it } from 'vitest';
import { isPublicMarkdownPage, type PublicMarkdownPage } from './public-markdown';

const page = (overrides: Partial<PublicMarkdownPage> = {}): PublicMarkdownPage => ({
  project: { config: { visibility: 'public' } },
  languageConfig: null,
  page: { config: null },
  ...overrides,
});

describe('public Markdown eligibility', () => {
  it('allows only public, indexable, canonical pages', () => {
    expect(isPublicMarkdownPage(page())).toBe(true);
    expect(isPublicMarkdownPage(page({ project: { config: {} } }))).toBe(false);
    expect(isPublicMarkdownPage(page({ project: { config: { visibility: 'unknown' } } }))).toBe(false);
    expect(isPublicMarkdownPage(page({ project: { config: { visibility: 'private' } } }))).toBe(false);
    expect(isPublicMarkdownPage(page({ project: { config: { seo: { allowIndex: false } } } }))).toBe(false);
    expect(isPublicMarkdownPage(page({ languageConfig: { seo: { allowIndex: false } } }))).toBe(false);
    expect(isPublicMarkdownPage(page({ page: { config: { seo: { noindex: true } } } }))).toBe(false);
    expect(isPublicMarkdownPage(page({ page: { config: { seo: { canonicalUrl: 'https://origin.example/page' } } } }))).toBe(false);
  });
});
