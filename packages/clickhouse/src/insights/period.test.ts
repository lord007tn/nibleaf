import { describe, expect, it } from 'vitest';
import { resolveInsightsMeta } from './period';

describe('insights periods', () => {
  it('resolves inclusive local days across DST with preceding local calendar dates', () => {
    const meta = resolveInsightsMeta({ range: 'custom', from: '2026-03-08', to: '2026-03-08', timezone: 'America/New_York', compare: 'previous' });
    expect(meta.current).toEqual({ from: '2026-03-08T05:00:00.000Z', to: '2026-03-09T04:00:00.000Z' });
    expect(meta.previous).toEqual({ from: '2026-03-07T05:00:00.000Z', to: '2026-03-08T05:00:00.000Z' });
  });
  it.each([
    ['America/New_York', '2026-11-01', '2026-10-31T04:00:00.000Z', '2026-11-01T04:00:00.000Z'],
    ['Asia/Riyadh', '2026-11-01', '2026-10-30T21:00:00.000Z', '2026-10-31T21:00:00.000Z'],
    ['Asia/Riyadh', '2026-03-08', '2026-03-06T21:00:00.000Z', '2026-03-07T21:00:00.000Z'],
  ])('compares calendar dates in %s on %s', (timezone, day, from, to) => {
    expect(resolveInsightsMeta({ range: 'custom', from: day, to: day, timezone, compare: 'previous' }).previous).toEqual({ from, to });
  });
  it('handles non-hour offsets and preset rolling periods', () => {
    const meta = resolveInsightsMeta({ range: 'custom', from: '2026-11-01', to: '2026-11-01', timezone: 'Asia/Kathmandu', compare: 'none' });
    expect(meta.current.from).toBe('2026-10-31T18:15:00.000Z');
    const rolling = resolveInsightsMeta({ range: '24h', timezone: 'Europe/Berlin', compare: 'none' }, new Date('2026-11-06T12:00:00Z'));
    expect(rolling.current.from).toBe('2026-11-05T12:00:00.000Z');
    expect(rolling.granularity).toBe('hour');
    expect(rolling.previous).toBeNull();
  });
});
