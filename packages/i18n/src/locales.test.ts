import { describe, expect, it } from 'vitest';
import { INTERFACE_LOCALES, isRtl, resolveLocale } from './locales';

describe('interface locales', () => {
  it('normalizes BCP-47 variants and preserves RTL direction', () => {
    expect(resolveLocale('pt_PT')).toBe('pt-BR');
    expect(resolveLocale('ar-SA')).toBe('ar');
    expect(isRtl('ar')).toBe(true);
    expect(isRtl('ur')).toBe(true);
    expect(INTERFACE_LOCALES.find(({ code }) => code === 'de')?.native).toBe('Deutsch');
  });
});
