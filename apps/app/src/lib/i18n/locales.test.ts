import { describe, expect, it } from 'vitest';
import { INTERFACE_LOCALES, localeDetails, resolveLocale } from './locales';

describe('interface locales', () => {
  it('ships English, Arabic, and ten additional complete locales', () => {
    expect(INTERFACE_LOCALES).toHaveLength(12);
    expect(INTERFACE_LOCALES.map((locale) => locale.code)).toEqual(['en', 'ar', 'zh-CN', 'hi', 'es', 'fr', 'bn', 'pt-BR', 'ru', 'ur', 'id', 'de']);
  });

  it('matches region variants and preserves RTL metadata', () => {
    expect(resolveLocale('fr-CA')).toBe('fr');
    expect(resolveLocale('pt-PT')).toBe('pt-BR');
    expect(resolveLocale('zh_Hans_CN')).toBe('zh-CN');
    expect(resolveLocale('it')).toBeNull();
    expect(localeDetails('ur').direction).toBe('rtl');
    expect(localeDetails('ar').direction).toBe('rtl');
  });
});
