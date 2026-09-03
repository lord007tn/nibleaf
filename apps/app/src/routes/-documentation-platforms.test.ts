import { describe, expect, it } from 'vitest';
import { arabicDocumentationPlatformsHead } from './ar/documentation-platforms';
import { documentationPlatformsHead } from './documentation-platforms';

describe('documentation platform route language pair', () => {
  it.each([
    ['en', documentationPlatformsHead, '/documentation-platforms'],
    ['ar', arabicDocumentationPlatformsHead, '/ar/documentation-platforms'],
  ] as const)('emits a self canonical and reciprocal alternates for %s', (_locale, headFactory, selfPath) => {
    const links = headFactory().links;
    expect(links).toContainEqual({ rel: 'canonical', href: expect.stringMatching(`${selfPath}$`) });
    expect(links).toContainEqual({ rel: 'alternate', hrefLang: 'en', href: expect.stringMatching('/documentation-platforms$') });
    expect(links).toContainEqual({ rel: 'alternate', hrefLang: 'ar', href: expect.stringMatching('/ar/documentation-platforms$') });
    expect(links).toContainEqual({ rel: 'alternate', hrefLang: 'x-default', href: expect.stringMatching('/documentation-platforms$') });
  });

  it.each([
    ['en', documentationPlatformsHead],
    ['ar', arabicDocumentationPlatformsHead],
  ] as const)('emits the six-platform ItemList for %s', (locale, headFactory) => {
    const script = headFactory().scripts.find((candidate) => JSON.parse(candidate.children)['@type'] === 'ItemList');
    expect(script).toBeDefined();
    const itemList = JSON.parse(script?.children ?? '{}') as {
      inLanguage: string;
      numberOfItems: number;
      itemListElement: unknown[];
    };

    expect(itemList.inLanguage).toBe(locale);
    expect(itemList.numberOfItems).toBe(6);
    expect(itemList.itemListElement).toHaveLength(6);
  });
});
