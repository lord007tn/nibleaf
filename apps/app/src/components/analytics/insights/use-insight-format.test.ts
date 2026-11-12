// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

const locale = vi.hoisted(() => ({ current: 'en' }));
vi.mock('@nibleaf/i18n/locale-state', () => ({
  getLocale: () => locale.current,
  renderedLocale: () => locale.current,
  subscribeLanguage: () => () => undefined,
}));

import { useInsightFormat } from './use-insight-format';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

async function formatFor(code: string) {
  locale.current = code;
  let captured: ReturnType<typeof useInsightFormat> | undefined;
  const Probe = () => {
    captured = useInsightFormat();
    return null;
  };
  const root = createRoot(document.createElement('div'));
  await act(async () => root.render(createElement(Probe)));
  await act(async () => root.unmount());
  if (!captured) throw new Error('format not captured');
  return captured;
}

describe('chart tooltip headings (bucketLong)', () => {
  it('names the month for daily buckets, in English and Arabic', async () => {
    expect((await formatFor('en')).bucketLong('2026-10-21', 'day')).toBe('Oct 21, 2026');
    // The medium date style is all digits in Arabic ("21‏/10‏/2026"); the month name reads better.
    expect((await formatFor('ar')).bucketLong('2026-10-21', 'day')).toBe('21 أكتوبر 2026');
  });

  it('keeps the day next to the hour for hourly buckets', async () => {
    expect((await formatFor('en')).bucketLong('2026-10-21T14:00', 'hour')).toBe('Oct 21, 2:00 PM');
  });

  it('formats AI spend and durations by kind', async () => {
    const format = await formatFor('en');
    expect(format.usd(0.0069)).toBe('$0.0069');
    expect(format.ms(320)).toBe('320 ms');
  });
});
