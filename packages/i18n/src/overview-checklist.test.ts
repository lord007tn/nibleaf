import { describe, expect, it } from 'vitest';
import { INTERFACE_LOCALES } from './locales';
import { overview_live_availableafterpublish } from './paraglide/messages/overview_live_availableafterpublish.js';
import { overview_live_willbeliveat } from './paraglide/messages/overview_live_willbeliveat.js';
import { overview_nudge_progress } from './paraglide/messages/overview_nudge_progress.js';

describe('first-publish checklist copy', () => {
  it.each(INTERFACE_LOCALES)('formats all progress counts and the reserved address in $code', ({ code: locale }) => {
    for (const count of [0, 1, 2, 3]) {
      const variables = { count: String(count), form: new Intl.PluralRules(locale).select(count) };
      const text = overview_nudge_progress(variables, { locale });
      expect(text).not.toMatch(/\{(?:count|form)\}/);
      expect(text).toContain('3');
      if (locale === 'en') expect(text).toBe(`${count} of 3 done`);
      if (locale === 'ar' && count === 1) expect(text).toBe('اكتملت خطوة واحدة من أصل 3');
      if (locale === 'ar' && count === 2) expect(text).toBe('اكتملت خطوتان من أصل 3');
    }
    expect(overview_live_willbeliveat({ url: 'https://docs.example.test' }, { locale })).toContain('https://docs.example.test');
    expect(overview_live_availableafterpublish(undefined, { locale }).trim()).not.toBe('');
  });

  it('uses formal German for the address availability explanation', () => {
    expect(overview_live_availableafterpublish(undefined, { locale: 'de' })).toContain('Sie');
  });
});
