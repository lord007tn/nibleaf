// @vitest-environment node
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { common_cancel } from './paraglide/messages/common_cancel.js';
import { cookieName } from './paraglide/runtime.js';
import { requestInterfaceLocale, withInterfaceLocale } from './request-locale';
import { getLocale, renderedLocale } from './runtime';

const request = (headers: Record<string, string>) => new Request('https://app.nibleaf.test/sign-in', { headers });

describe('the interface locale of a request', () => {
  it('follows the browser strategy: the locale cookie, then Accept-Language, then English', () => {
    expect(requestInterfaceLocale(request({ cookie: `theme=dark; ${cookieName}=ar` }))).toBe('ar');
    expect(requestInterfaceLocale(request({ 'accept-language': 'ar-TN,ar;q=0.9,en;q=0.5' }))).toBe('ar');
    expect(requestInterfaceLocale(request({ 'accept-language': 'en-US,en;q=0.9,ar;q=0.8' }))).toBe('en');
    expect(requestInterfaceLocale(request({}))).toBe('en');
  });

  it('lets the cookie win over Accept-Language, and skips a cookie it does not support', () => {
    expect(requestInterfaceLocale(request({ cookie: `${cookieName}=en`, 'accept-language': 'ar' }))).toBe('en');
    expect(requestInterfaceLocale(request({ cookie: `${cookieName}=ar`, 'accept-language': 'en' }))).toBe('ar');
    expect(requestInterfaceLocale(request({ cookie: `${cookieName}=xx`, 'accept-language': 'ar' }))).toBe('ar');
  });
});

describe('a request-scoped interface locale', () => {
  it('answers getLocale(), message functions and the hydration snapshot only inside its scope', () => {
    expect(getLocale()).toBe('en');
    withInterfaceLocale('ar', 'https://app.nibleaf.test', () => {
      expect(getLocale()).toBe('ar');
      expect(renderedLocale()).toBe('ar');
      expect(common_cancel()).toBe('إلغاء');
    });
    expect(getLocale()).toBe('en');
    expect(common_cancel()).toBe('Cancel');
  });

  it('never leaks between concurrent requests in different locales', async () => {
    const locales = ['ar', 'en', 'fr', 'ur', 'de', 'ar', 'en', 'zh-CN'] as const;
    // Every render yields several times with different delays, so the requests'
    // async steps interleave; each must keep reading its own locale throughout.
    const render = (locale: (typeof locales)[number], index: number) =>
      withInterfaceLocale(locale, 'https://app.nibleaf.test', async () => {
        const seen: string[] = [];
        for (let step = 0; step < 5; step++) {
          await delay(((index + step) % 4) * 3);
          seen.push(getLocale(), renderedLocale());
          await Promise.resolve();
          seen.push(common_cancel({}, {}) === common_cancel({}, { locale }) ? locale : `leak:${getLocale()}`);
        }
        return seen;
      });
    const results = await Promise.all(locales.map(render));
    results.forEach((seen, index) => {
      expect(new Set(seen)).toEqual(new Set([locales[index]]));
    });
    expect(getLocale()).toBe('en');
  });
});
