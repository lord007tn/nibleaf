// @vitest-environment node
import { setTimeout as delay } from 'node:timers/promises';
import { expect, it } from 'vitest';
import { withInterfaceLocale } from './request-locale';
import { setLanguage } from './runtime';
import { translateFn } from './translate';

it('keeps synchronous dashboard text isolated across interleaved SSR requests', async () => {
  const requests = ['ar', 'en', 'ar', 'en'] as const;
  await Promise.all(
    requests.map((locale, index) =>
      withInterfaceLocale(locale, 'http://localhost:4310', async () => {
        for (let step = 0; step < 4; step++) {
          await delay((index + step) % 3);
          expect(translateFn('common.cancel')).toBe(locale === 'ar' ? 'إلغاء' : 'Cancel');
        }
      }),
    ),
  );
  expect(translateFn('common.cancel')).toBe('Cancel');
});

it('does not apply a browser language choice to concurrent server requests', async () => {
  await withInterfaceLocale('ar', 'http://localhost:4310', async () => {
    await setLanguage('de');
    expect(translateFn('common.cancel')).toBe('إلغاء');
  });
  expect(translateFn('common.cancel')).toBe('Cancel');
});
