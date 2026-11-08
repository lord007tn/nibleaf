// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/i18n/locale-state', () => ({ getLocale: () => 'en', subscribeLanguage: () => () => undefined }));

import { parseCalendarDate, useFormatters } from './format';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

describe('parseCalendarDate', () => {
  it('reads a "YYYY-MM-DD" bucket as a local calendar day', () => {
    const day = parseCalendarDate('2026-08-26');
    expect([day.getFullYear(), day.getMonth(), day.getDate(), day.getHours()]).toEqual([2026, 7, 26, 0]);
  });

  it('formats to the same calendar day in every process timezone', () => {
    // `new Date('2026-08-26')` would be UTC midnight and print "Aug 25" west of UTC.
    const label = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(parseCalendarDate('2026-08-26'));
    expect(label).toBe('Aug 26');
  });

  it('passes full timestamps through unchanged', () => {
    expect(parseCalendarDate('2026-08-26T10:30:00Z').getTime()).toBe(Date.UTC(2026, 7, 26, 10, 30));
  });

  it('yields an invalid date for garbage rather than throwing', () => {
    expect(Number.isNaN(parseCalendarDate('not-a-date').getTime())).toBe(true);
  });
});

describe('useFormatters dates and AI spend', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  async function formatters() {
    let captured: ReturnType<typeof useFormatters> | undefined;
    const Probe = () => {
      captured = useFormatters();
      return null;
    };
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(createElement(Probe)));
    await act(async () => root.unmount());
    if (!captured) throw new Error('formatters not captured');
    return captured;
  }

  it.each(['America/Los_Angeles', 'UTC', 'Asia/Riyadh', 'Pacific/Kiritimati'])(
    'keeps a daily bucket on its own day in %s (AI conversation charts)',
    async (tz) => {
      process.env.TZ = tz;
      const f = await formatters();
      expect(f.shortDate('2026-11-08')).toBe('Nov 8');
      expect(f.date('2026-11-08')).toBe('Nov 8, 2026');
    },
  );

  it('shows sub-cent AI spend with two significant digits and whole amounts without trailing zeros', async () => {
    const f = await formatters();
    expect(f.usd(0.0042)).toBe('$0.0042');
    expect(f.usd(12.5)).toBe('$12.50');
    expect(f.usd(3)).toBe('$3');
    expect(f.usd(0)).toBe('$0');
  });
});
