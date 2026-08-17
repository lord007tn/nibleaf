// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { translateStandalone } from './standalone';

describe('standalone translations', () => {
  afterEach(() => {
    window.localStorage.clear();
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
});
