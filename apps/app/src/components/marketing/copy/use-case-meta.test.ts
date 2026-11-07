import { describe, expect, it } from 'vitest';
import { findUseCaseMeta, getUseCaseHref, USE_CASE_META, USE_CASE_SLUGS, USE_CASES_TEASER } from './use-case-meta';
import { useCasesAr, useCasesTeaserAr } from './use-cases.ar';
import { useCasesEn, useCasesTeaserEn } from './use-cases.en';

describe('use-case metadata', () => {
  it.each([
    ['en', useCasesEn, useCasesTeaserEn],
    ['ar', useCasesAr, useCasesTeaserAr],
  ] as const)('matches the full %s copy verbatim', (lang, copies, teaser) => {
    expect(Object.keys(copies).sort()).toEqual([...USE_CASE_SLUGS].sort());
    for (const slug of USE_CASE_SLUGS) {
      const copy = copies[slug];
      expect(USE_CASE_META[lang][slug]).toEqual({
        slug,
        title: copy.meta.title,
        description: copy.meta.description,
        navLabel: copy.navLabel,
        cardSummary: copy.cardSummary,
      });
    }
    expect(USE_CASES_TEASER[lang]).toEqual(teaser);
  });

  it('accepts known slugs only', () => {
    expect(findUseCaseMeta('en', 'api-docs')?.title).toBe(useCasesEn['api-docs'].meta.title);
    expect(findUseCaseMeta('ar', 'support-teams')?.title).toBe(useCasesAr['support-teams'].meta.title);
    for (const slug of ['', 'unknown', 'API-DOCS', 'toString', '__proto__', 'constructor']) {
      expect(findUseCaseMeta('en', slug)).toBeUndefined();
    }
  });

  it('builds language-prefixed paths', () => {
    expect(getUseCaseHref('en', 'product-docs')).toBe('/use-cases/product-docs');
    expect(getUseCaseHref('ar', 'product-docs')).toBe('/ar/use-cases/product-docs');
  });
});
