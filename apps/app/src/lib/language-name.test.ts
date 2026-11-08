import { describe, expect, it } from 'vitest';
import { languageName } from './language-name';

describe('languageName', () => {
  const site = [
    { code: 'en', label: 'English' },
    { code: 'ar', label: 'العربية' },
    { code: 'x-kids', label: 'Kids edition' },
  ];

  it('uses the site’s own label for its languages', () => {
    expect(languageName('ar', site, 'en')).toBe('العربية');
    expect(languageName('x-kids', site, 'ar')).toBe('Kids edition');
  });

  it('names other codes in the interface language', () => {
    expect(languageName('fr', site, 'en')).toBe('French');
    expect(languageName('fr', site, 'ar')).toBe('الفرنسية');
    expect(languageName('de', undefined, 'en')).toBe('German');
  });

  it('falls back to the code for a custom or invalid one', () => {
    expect(languageName('x-legacy', site, 'en')).toBe('x-legacy');
    expect(languageName('not a tag', site, 'en')).toBe('not a tag');
  });
});
