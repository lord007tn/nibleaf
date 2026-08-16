import { describe, expect, it } from 'vitest';
import { exportScheduleSlotKey, nextExportRunAt } from './export-schedule';

describe('nextExportRunAt', () => {
  it('keeps local wall time across daylight-saving changes', () => {
    const timing = { cadence: 'DAILY' as const, timezone: 'America/New_York', hour: 9, minute: 15 };
    expect(nextExportRunAt(timing, new Date('2026-03-07T15:00:00Z')).toISOString()).toBe('2026-03-08T13:15:00.000Z');
    expect(nextExportRunAt(timing, new Date('2026-11-01T14:00:00Z')).toISOString()).toBe('2026-11-01T14:15:00.000Z');
  });

  it('supports Arabic-region timezones and weekly cadence', () => {
    const next = nextExportRunAt({ cadence: 'WEEKLY', timezone: 'Africa/Cairo', hour: 8, minute: 30, weekday: 1 }, new Date('2026-08-16T00:00:00Z'));
    expect(next.toISOString()).toBe('2026-08-17T05:30:00.000Z');
  });

  it('clamps monthly day 31 to the last calendar day', () => {
    const next = nextExportRunAt({ cadence: 'MONTHLY', timezone: 'UTC', hour: 0, minute: 0, monthday: 31 }, new Date('2026-04-01T00:00:00Z'));
    expect(next.toISOString()).toBe('2026-04-30T00:00:00.000Z');
  });

  it('rejects an invalid timezone', () => {
    expect(() => nextExportRunAt({ cadence: 'DAILY', timezone: 'Mars/Olympus', hour: 0, minute: 0 }, new Date())).toThrow();
  });

  it('skips a local wall-clock minute that does not exist during a DST gap', () => {
    const next = nextExportRunAt({ cadence: 'DAILY', timezone: 'America/New_York', hour: 2, minute: 30 }, new Date('2026-03-08T05:00:00Z'));
    expect(next.toISOString()).toBe('2026-03-09T06:30:00.000Z');
  });

  it('uses a stable idempotency key for scheduler retries', () => {
    const slot = new Date('2026-08-16T01:00:00Z');
    expect(exportScheduleSlotKey('archive', slot)).toBe(exportScheduleSlotKey('archive', new Date(slot)));
    expect(exportScheduleSlotKey('archive', slot)).not.toBe(exportScheduleSlotKey('archive', new Date('2026-08-17T01:00:00Z')));
  });

  it('does not run twice in an ambiguous local minute during a DST fold', () => {
    const next = nextExportRunAt({ cadence: 'DAILY', timezone: 'America/New_York', hour: 1, minute: 30 }, new Date('2026-11-01T05:30:00Z'));
    expect(next.toISOString()).toBe('2026-11-02T06:30:00.000Z');
  });
});
