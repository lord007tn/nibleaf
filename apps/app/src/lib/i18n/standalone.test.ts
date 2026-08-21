// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { syncStandaloneLocale, translateStandalone } from './standalone';

describe('standalone translations', () => {
  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
  });

  it('uses English when no preference is stored', () => {
    expect(translateStandalone('common.loading')).toBe('Loading…');
    expect(translateStandalone('notFound.title')).toBe('Page not found');
  });

  it('uses the persisted Arabic preference', () => {
    window.localStorage.setItem('nibleaf.locale', 'ar');
    expect(translateStandalone('common.loading')).toBe('جارٍ التحميل…');
    expect(translateStandalone('error.tryAgain')).toBe('حاول مجددًا');
  });

  it('uses another persisted interface language', () => {
    window.localStorage.setItem('nibleaf.locale', 'es');
    expect(translateStandalone('notFound.title')).toBe('Página no encontrada');
  });

  it('applies Urdu language and RTL direction to standalone boundaries', () => {
    window.localStorage.setItem('nibleaf.locale', 'ur');
    expect(syncStandaloneLocale()).toBe('ur');
    expect(document.documentElement.lang).toBe('ur');
    expect(document.documentElement.dir).toBe('rtl');
    expect(translateStandalone('notFound.title')).toBe('صفحہ نہیں ملا');
  });
});
