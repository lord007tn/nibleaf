import { translateFn } from '@nibleaf/i18n';
import { describe, expect, it } from 'vitest';
import { countVariables, formatCurrency, localeTag, viewsTrend } from './format';

const series = (...views: number[]) => views.map((v, i) => ({ date: `d${i}`, views: v }));

describe('viewsTrend', () => {
  it('returns null with too few points to compare', () => {
    expect(viewsTrend([])).toBeNull();
    expect(viewsTrend(series(1, 2, 3))).toBeNull();
  });

  it('reports an upward trend (recent half greater than older half)', () => {
    // older = 1+1 = 2, recent = 3+3 = 6 → +200%
    const t = viewsTrend(series(1, 1, 3, 3));
    expect(t?.direction).toBe('up');
    expect(t?.pct).toBeCloseTo(200);
  });

  it('reports a downward trend', () => {
    // older = 10+10 = 20, recent = 5+5 = 10 → -50%
    const t = viewsTrend(series(10, 10, 5, 5));
    expect(t?.direction).toBe('down');
    expect(t?.pct).toBeCloseTo(-50);
  });

  it('reports flat when within ±1%', () => {
    const t = viewsTrend(series(100, 100, 100, 100));
    expect(t?.direction).toBe('flat');
    expect(t?.pct).toBe(0);
  });

  it('handles a zero older half without dividing by zero', () => {
    const t = viewsTrend(series(0, 0, 5, 5));
    expect(t).toEqual({ pct: 100, direction: 'up' });
  });

  it('returns null when there is no traffic at all', () => {
    expect(viewsTrend(series(0, 0, 0, 0))).toBeNull();
  });
});

describe('localeTag', () => {
  it('requests Western digits for Arabic and passes other locales through', () => {
    expect(localeTag('ar')).toBe('ar-u-nu-latn');
    expect(localeTag('ar-SA')).toBe('ar-SA-u-nu-latn');
    expect(localeTag('en')).toBe('en');
    expect(localeTag('fr')).toBe('fr');
  });
});

describe('formatCurrency', () => {
  it('formats a whole amount without trailing cents', () => {
    expect(formatCurrency('en', 0)).toBe('$0');
    expect(formatCurrency('en', 12)).toBe('$12');
  });

  it('keeps cents for fractional amounts', () => {
    expect(formatCurrency('en', 9.5)).toBe('$9.50');
  });

  it('uses Western digits under the Arabic tag', () => {
    expect(formatCurrency(localeTag('ar'), 0)).toContain('0');
    expect(formatCurrency(localeTag('ar'), 0)).not.toMatch(/[٠-٩]/);
  });
});

describe('counted dashboard messages', () => {
  const counts = [0, 1, 2, 3, 7, 11, 100];
  const say = (key: Parameters<typeof translateFn>[0], locale: 'en' | 'ar' | 'ru', value: number) =>
    translateFn(key, countVariables(locale, value), locale);

  it('picks the plural form from the number, with Western digits in Arabic', () => {
    expect(countVariables('ar', 3)).toEqual({ count: '3', form: 'few' });
    expect(countVariables('en', 1)).toEqual({ count: '1', form: 'one' });
    expect(countVariables('en', 1200).count).toBe('1,200');
  });

  it('says page counts in English singular and plural', () => {
    expect(counts.map((value) => say('dashboard.pages', 'en', value))).toEqual([
      '0 pages',
      '1 page',
      '2 pages',
      '3 pages',
      '7 pages',
      '11 pages',
      '100 pages',
    ]);
  });

  it('uses every Arabic form for pages and days', () => {
    expect(counts.map((value) => say('dashboard.pages', 'ar', value))).toEqual([
      'لا توجد صفحات',
      'صفحة واحدة',
      'صفحتان',
      '3 صفحات',
      '7 صفحات',
      '11 صفحة',
      '100 صفحة',
    ]);
    expect(counts.map((value) => say('settings.apiKeys.expiryDays', 'ar', value))).toEqual([
      '0 يوم',
      'يوم واحد',
      'يومان',
      '3 أيام',
      '7 أيام',
      '11 يومًا',
      '100 يوم',
    ]);
  });

  it('covers language coverage and Russian counts too', () => {
    expect(say('settings.languages.coverage.sourcePages', 'en', 1)).toBe('1 source page');
    expect(say('settings.languages.coverage.missing', 'ar', 2)).toBe('صفحتان مفقودتان');
    expect(say('settings.exports.workflow.pageCount', 'ru', 5)).toBe('5 страниц');
    expect(say('settings.authentication.reader.pageCount', 'ru', 21)).toBe('21 страница');
  });
});
