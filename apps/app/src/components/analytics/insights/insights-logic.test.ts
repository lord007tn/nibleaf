import { describe, expect, it } from 'vitest';
import { customRangeError, toInsightsQuery, validateInsightsSearch } from './filters';
import { alignWithPrevious, dataFreshness, groupCrawlerSeries, mergeSeries, sortWorstFirst } from './insights-data';
import { compareDelta, deltaTone } from './metrics';
import { aiFixture, feedbackFixture } from './test-fixtures';
import { findPageIdForPath } from './use-page-links';
import { rateVital } from './web-vitals';

describe('insights URL filters', () => {
  it('keeps the default view out of the URL and drops invalid values', () => {
    expect(validateInsightsSearch({})).toEqual({});
    expect(validateInsightsSearch({ range: '30d', compare: 'previous' })).toEqual({});
    expect(validateInsightsSearch({ range: '7d', compare: 'none', path: 'x' })).toEqual({ range: '7d', compare: 'none' });
    expect(validateInsightsSearch({ range: 'forever' })).toEqual({});
  });

  it('accepts a valid custom range and rejects reversed, partial or overlong ones', () => {
    expect(validateInsightsSearch({ range: 'custom', from: '2026-10-01', to: '2026-10-31' })).toEqual({
      range: 'custom',
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(validateInsightsSearch({ range: 'custom', from: '2026-10-31', to: '2026-10-01' })).toEqual({});
    expect(validateInsightsSearch({ range: 'custom', from: '2026-10-01' })).toEqual({});
    expect(customRangeError('2025-01-01', '2026-06-01')).toBe('tooLong');
    expect(customRangeError('2026-10-01', '2026-10-01')).toBeNull();
  });

  it('builds the API query with the browser timezone and comparison state', () => {
    expect(toInsightsQuery({}, 'Asia/Riyadh')).toEqual({ range: '30d', timezone: 'Asia/Riyadh', compare: 'previous' });
    expect(toInsightsQuery({ range: 'custom', from: '2026-10-01', to: '2026-10-02', compare: 'none' }, 'UTC')).toEqual({
      range: 'custom',
      from: '2026-10-01',
      to: '2026-10-02',
      timezone: 'UTC',
      compare: 'none',
    });
  });
});

describe('period comparison', () => {
  it('expresses counts as a relative change and rates as percentage points', () => {
    expect(compareDelta({ value: 120, previous: 100 }, 'count')).toEqual({ mode: 'percent', amount: 20, direction: 'up' });
    const rate = compareDelta({ value: 0.12, previous: 0.08 }, 'rate');
    expect(rate?.mode).toBe('points');
    expect(rate?.amount).toBeCloseTo(4);
  });

  it('never invents a change from unknown values and marks a first appearance as new', () => {
    expect(compareDelta({ value: null, previous: 10 }, 'count')).toBeNull();
    expect(compareDelta({ value: 10, previous: null }, 'count')).toBeNull();
    expect(compareDelta({ value: 5, previous: 0 }, 'count')).toEqual({ mode: 'new', amount: 0, direction: 'up' });
    expect(compareDelta({ value: 100, previous: 100.2 }, 'count')?.direction).toBe('flat');
  });

  it('colours a rise in zero-result searches as bad and a rise in views as good', () => {
    const rise = compareDelta({ value: 0.2, previous: 0.1 }, 'rate');
    if (!rise) throw new Error('expected a delta');
    expect(deltaTone(rise, 'lower_is_better')).toBe('bad');
    expect(deltaTone(rise, 'higher_is_better')).toBe('good');
    expect(deltaTone(rise, 'neutral')).toBe('neutral');
  });
});

describe('web vitals ratings', () => {
  it('uses the published Google thresholds', () => {
    expect(rateVital('lcp', 2500)).toBe('good');
    expect(rateVital('lcp', 3000)).toBe('needs_improvement');
    expect(rateVital('lcp', 4001)).toBe('poor');
    expect(rateVital('inp', 200)).toBe('good');
    expect(rateVital('inp', 501)).toBe('poor');
    expect(rateVital('cls', 0.1)).toBe('good');
    expect(rateVital('cls', 0.2)).toBe('needs_improvement');
    expect(rateVital('cls', null)).toBeNull();
  });
});

describe('data freshness', () => {
  const now = Date.parse('2026-11-06T12:00:00Z');
  it('distinguishes never received, recent and stale data', () => {
    expect(dataFreshness(undefined, now)).toBe('unknown');
    expect(dataFreshness(null, now)).toBe('never');
    expect(dataFreshness('2026-11-06T11:00:00Z', now)).toBe('fresh');
    expect(dataFreshness('2026-11-04T11:00:00Z', now)).toBe('stale');
  });
});

describe('series helpers', () => {
  it('overlays the previous period by position and merges multiple series by bucket', () => {
    expect(alignWithPrevious([{ bucket: '2026-11-02', value: 3 }], [{ bucket: '2026-10-02', value: 1 }])).toEqual([
      { bucket: '2026-11-02', current: 3, previous: 1 },
    ]);
    expect(
      mergeSeries([
        { key: 'a', points: [{ bucket: '2026-11-02', value: 1 }] },
        { key: 'b', points: [{ bucket: '2026-11-01', value: 2 }] },
      ]),
    ).toEqual([
      { bucket: '2026-11-01', b: 2 },
      { bucket: '2026-11-02', a: 1 },
    ]);
  });

  it('folds minor crawler categories into "other" for the five-colour chart', () => {
    const grouped = groupCrawlerSeries(aiFixture().crawlerSeries);
    expect(grouped.map((entry) => entry.key).sort()).toEqual(['ai_training', 'other']);
    expect(grouped.find((entry) => entry.key === 'other')?.points).toEqual([
      { bucket: '2026-11-01', value: 6 },
      { bucket: '2026-11-02', value: 7 },
    ]);
  });
});

describe('row helpers', () => {
  it('lists the least helpful pages first and unrated pages last', () => {
    expect(sortWorstFirst(feedbackFixture().pages).map((page) => page.path)).toEqual(['bad', 'good', 'unrated']);
  });

  const languages = [
    { id: 'en', code: 'en', isDefault: true },
    { id: 'ar', code: 'ar', isDefault: false },
  ];

  it('maps an analytics path to its editor page in the language the path is in', () => {
    const pages = [
      { id: 'p1', path: 'guides/install', kind: 'PAGE', languageId: 'en' },
      { id: 'p1-ar', path: 'guides/install', kind: 'PAGE', languageId: 'ar' },
      { id: 'g1', path: 'guides', kind: 'GROUP', languageId: 'en' },
    ];
    expect(findPageIdForPath(pages, '/guides/install/', languages)).toBe('p1');
    // The Arabic row opens the Arabic page, not whichever came first.
    expect(findPageIdForPath(pages, 'ar/guides/install', languages)).toBe('p1-ar');
    expect(findPageIdForPath(pages, 'guides', languages)).toBeNull();
  });

  it('never strips a first segment that is not a language, and never guesses between matches', () => {
    const pages = [
      { id: 'guide', path: 'guide', kind: 'PAGE', languageId: 'en' },
      { id: 'a', path: 'dup', kind: 'PAGE' },
      { id: 'b', path: 'dup', kind: 'PAGE' },
    ];
    // "section/guide" was deleted; "guide" is a different page.
    expect(findPageIdForPath(pages, 'section/guide', languages)).toBeNull();
    // Without language data, two pages with the same path stay ambiguous.
    expect(findPageIdForPath(pages, 'dup')).toBeNull();
  });

  it('matches encoded and raw Arabic slugs alike', () => {
    const pages = [{ id: 'start', path: 'البداية', kind: 'PAGE', languageId: 'ar' }];
    expect(findPageIdForPath(pages, `ar/${encodeURIComponent('البداية')}`, languages)).toBe('start');
  });
});
