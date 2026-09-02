import { describe, expect, it } from 'vitest';
import { parseSeriesDate } from './chart-format';

describe('parseSeriesDate', () => {
  it('reads a "YYYY-MM-DD" bucket as a local calendar day', () => {
    const day = parseSeriesDate('2026-08-26');
    expect([day.getFullYear(), day.getMonth(), day.getDate(), day.getHours()]).toEqual([2026, 7, 26, 0]);
  });

  it('formats to the same calendar day in every process timezone', () => {
    // `new Date('2026-08-26')` would be UTC midnight and print "Aug 25" west of UTC.
    const label = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(parseSeriesDate('2026-08-26'));
    expect(label).toBe('Aug 26');
  });

  it('passes full timestamps through unchanged', () => {
    expect(parseSeriesDate('2026-08-26T10:30:00Z').getTime()).toBe(Date.UTC(2026, 7, 26, 10, 30));
  });

  it('yields an invalid date for garbage rather than throwing', () => {
    expect(Number.isNaN(parseSeriesDate('not-a-date').getTime())).toBe(true);
  });
});
