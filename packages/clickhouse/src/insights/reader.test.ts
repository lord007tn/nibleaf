import { describe, expect, it } from 'vitest';
import { resolveInsightsMeta } from './period';
import { InsightsReader } from './reader';

const readerFor = (from: string, to: string, timezone = 'UTC') =>
  new InsightsReader({
    tenantId: 'grid',
    projectId: 'grid',
    visibility: 'visible',
    meta: resolveInsightsMeta({ range: 'custom', from, to, timezone, compare: 'previous' }, new Date('2026-11-06T12:00:00Z')),
  });
describe('complete insights grids', () => {
  it('fills missing days, including entirely empty previous periods, by calendar position', () => {
    const reader = readerFor('2026-11-01', '2026-11-03', 'America/New_York');
    expect(
      reader.grid(
        [
          { bucket: '2026-11-01', value: 2 },
          { bucket: '2026-11-03', value: 4 },
        ],
        { value: 0 },
      ),
    ).toEqual([
      { bucket: '2026-11-01', value: 2 },
      { bucket: '2026-11-02', value: 0 },
      { bucket: '2026-11-03', value: 4 },
    ]);
    expect(reader.grid([], { value: 0 }, 'previous')).toEqual([
      { bucket: '2026-10-29', value: 0 },
      { bucket: '2026-10-30', value: 0 },
      { bucket: '2026-10-31', value: 0 },
    ]);
  });
  it('keeps hourly offsets aligned across the repeated DST hour', () => {
    const reader = readerFor('2026-11-01', '2026-11-01', 'America/New_York');
    reader.scope.meta = resolveInsightsMeta({ range: '24h', timezone: 'America/New_York', compare: 'previous' }, new Date('2026-11-01T12:15:00Z'));
    const current = reader.grid([], { value: 0 });
    expect(current).toHaveLength(25);
    expect(reader.grid([], { value: 0 }, 'previous')).toHaveLength(current.length);
    expect(new Set(current.map((point) => point.bucket)).size).toBe(current.length);
  });
  it('starts hourly buckets at local hours in fractional-offset timezones', () => {
    const reader = readerFor('2026-11-01', '2026-11-01', 'Asia/Kathmandu');
    reader.scope.meta = resolveInsightsMeta({ range: '24h', timezone: 'Asia/Kathmandu', compare: 'previous' }, new Date('2026-11-02T12:30:00Z'));
    const series = reader.grid([], { value: 0 });
    expect(series[0]?.bucket).toBe('2026-11-01T12:15Z');
    expect(series).toHaveLength(25);
  });
  it('aligns rolling daily periods when DST changes the number of touched dates', () => {
    const reader = readerFor('2026-03-01', '2026-03-01', 'America/New_York');
    reader.scope.meta = resolveInsightsMeta({ range: '7d', timezone: 'America/New_York', compare: 'previous' }, new Date('2026-03-09T04:30:00Z'));
    expect(reader.grid([], { value: 0 })).toHaveLength(9);
    expect(reader.grid([], { value: 0 }, 'previous')).toHaveLength(9);
  });
  it('does not invent zeros outside retention coverage', () => {
    expect(readerFor('2020-01-01', '2020-01-02').grid([], { value: 0 })).toEqual([]);
  });
});
