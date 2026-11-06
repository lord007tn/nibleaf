import { describe, expect, it } from 'vitest';
import { LANGUAGE_CATALOG } from './languages';
import { RTL_BASE_LANGUAGES, resolveReaderDirection } from './text-direction';

describe('resolveReaderDirection', () => {
  it('lists exactly the right-to-left languages of the catalog', () => {
    const catalog = new Set(LANGUAGE_CATALOG.filter((language) => language.rtl).map((language) => language.code.split('-')[0]));
    expect([...RTL_BASE_LANGUAGES].sort()).toEqual([...catalog].sort());
  });

  it('prefers the configured direction and otherwise infers it from the language', () => {
    expect(resolveReaderDirection('ltr', 'ar')).toBe('ltr');
    expect(resolveReaderDirection(undefined, 'ar-SA')).toBe('rtl');
    expect(resolveReaderDirection(undefined, 'fa_IR')).toBe('rtl');
    expect(resolveReaderDirection(undefined, 'en')).toBe('ltr');
    expect(resolveReaderDirection()).toBe('ltr');
  });
});
