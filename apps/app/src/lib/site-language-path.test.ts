import { describe, expect, it } from 'vitest';
import { matchSiteLanguage, resolveLanguagePathRedirect } from './site-language-path';

const languages = [
  { code: 'en', isDefault: true },
  { code: 'ar', isDefault: false },
];
const ARABIC_SLUG = 'دليل-البدء';
const ENCODED_ARABIC_SLUG = encodeURIComponent(ARABIC_SLUG);

const resolve = (splat: string, overrides: Partial<Parameters<typeof resolveLanguagePathRedirect>[0]> = {}) =>
  resolveLanguagePathRedirect({ splat, languages, projectId: 'p1', isCustomDomain: false, ...overrides });

describe('matchSiteLanguage', () => {
  it('matches a site language code case-insensitively', () => {
    expect(matchSiteLanguage('ar', languages)?.code).toBe('ar');
    expect(matchSiteLanguage('AR', languages)?.code).toBe('ar');
    expect(matchSiteLanguage('fr', languages)).toBeUndefined();
    expect(matchSiteLanguage('', languages)).toBeUndefined();
  });

  it('accepts the base code of a regional language and prefers an exact match', () => {
    const regional = [
      { code: 'en-US', isDefault: true },
      { code: 'ar-SA', isDefault: false },
    ];
    expect(matchSiteLanguage('ar', regional)?.code).toBe('ar-SA');
    expect(matchSiteLanguage('ar-sa', regional)?.code).toBe('ar-SA');
    expect(matchSiteLanguage('en', regional)?.code).toBe('en-US');

    const both = [
      { code: 'ar-SA', isDefault: false },
      { code: 'ar', isDefault: false },
    ];
    expect(matchSiteLanguage('ar', both)?.code).toBe('ar');
    expect(matchSiteLanguage('ar-SA', both)?.code).toBe('ar-SA');
  });
});

describe('resolveLanguagePathRedirect', () => {
  it('sends the Arabic root to the site root with ?lang', () => {
    expect(resolve('ar')).toBe('/sites/p1?lang=ar');
    expect(resolve('/ar/')).toBe('/sites/p1?lang=ar');
  });

  it('keeps the rest of the path under the language prefix', () => {
    expect(resolve('ar/guides/intro')).toBe('/sites/p1/guides/intro?lang=ar');
  });

  it('drops the prefix and the ?lang param for the default language', () => {
    expect(resolve('en')).toBe('/sites/p1');
    expect(resolve('en/guides/intro')).toBe('/sites/p1/guides/intro');
    expect(resolve('en', { search: '?lang=ar&ref=nav' })).toBe('/sites/p1?ref=nav');
  });

  it('returns null when the first segment is not a site language', () => {
    expect(resolve('')).toBeNull();
    expect(resolve('guides/ar')).toBeNull();
    expect(resolve('fr')).toBeNull();
    expect(resolve('ar', { languages: [] })).toBeNull();
  });

  it('produces one valid href for encoded and decoded Arabic slugs', () => {
    const expected = `/sites/p1/${ENCODED_ARABIC_SLUG}?lang=ar`;
    expect(resolve(`ar/${ENCODED_ARABIC_SLUG}`)).toBe(expected);
    expect(resolve(`ar/${ARABIC_SLUG}`)).toBe(expected);
  });

  it('preserves other search params and lets the path language override ?lang', () => {
    expect(resolve('ar', { search: '?lang=en&version=2' })).toBe('/sites/p1?lang=ar&version=2');
    expect(resolve('ar/guides', { search: 'ref=nav' })).toBe('/sites/p1/guides?ref=nav&lang=ar');
  });

  it('uses the domain root on a custom domain', () => {
    expect(resolve('ar', { isCustomDomain: true })).toBe('/?lang=ar');
    expect(resolve('ar/guides/intro', { isCustomDomain: true })).toBe('/guides/intro?lang=ar');
    expect(resolve('en', { isCustomDomain: true })).toBe('/');
    expect(resolve('en/guides', { isCustomDomain: true })).toBe('/guides');
  });

  it('redirects with the site language code, not the typed segment', () => {
    const regional = [
      { code: 'en-US', isDefault: true },
      { code: 'ar-SA', isDefault: false },
    ];
    expect(resolve('AR/guides', { languages: regional })).toBe('/sites/p1/guides?lang=ar-SA');
    expect(resolve('en/guides', { languages: regional })).toBe('/sites/p1/guides');
  });
});
