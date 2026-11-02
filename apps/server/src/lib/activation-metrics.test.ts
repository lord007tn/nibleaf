import { describe, expect, it } from 'vitest';
import { activationTiming, publishRetentionReadout, publishRetentionWindows } from './activation-metrics';

const at = (hours: number) => new Date(Date.UTC(2026, 0, 1, hours));

describe('activationTiming', () => {
  it("uses each user's first successful publish after sign-up", () => {
    const timing = activationTiming(
      [
        { userId: 'a', createdAt: at(0) },
        { userId: 'b', createdAt: at(0) },
      ],
      [
        { userId: 'a', createdAt: at(4) },
        { userId: 'a', createdAt: at(8) },
        { userId: 'b', createdAt: at(20) },
      ],
    );

    expect(timing).toEqual({ medianHoursToReady: 12, readyWithin24Hours: 2 });
  });

  it('ignores null users, pre-sign-up events, and non-converters', () => {
    const timing = activationTiming(
      [
        { userId: 'a', createdAt: at(4) },
        { userId: 'b', createdAt: at(0) },
        { userId: null, createdAt: at(0) },
      ],
      [
        { userId: 'a', createdAt: at(2) },
        { userId: null, createdAt: at(5) },
      ],
    );

    expect(timing).toEqual({ medianHoursToReady: null, readyWithin24Hours: 0 });
  });

  it('rounds the median to one decimal hour', () => {
    const timing = activationTiming([{ userId: 'a', createdAt: at(0) }], [{ userId: 'a', createdAt: new Date(at(0).getTime() + 95 * 60 * 1000) }]);

    expect(timing.medianHoursToReady).toBe(1.6);
  });
});

describe('publish retention readout', () => {
  const now = new Date('2026-10-30T12:00:00.000Z');
  const days = (count: number) => new Date(now.getTime() - count * 24 * 60 * 60 * 1000);
  const windows = publishRetentionWindows(30, now);

  it('shifts the funnel window back by the measuring window', () => {
    expect(windows).toEqual({ firstPublishSince: days(30), cohortSince: days(37), cohortUntil: days(7) });
    expect(publishRetentionWindows(14, now)).toEqual({ firstPublishSince: days(14), cohortSince: days(21), cohortUntil: days(7) });
  });

  it('reports every count as Unknown before the first receipt', () => {
    expect(publishRetentionReadout({ observationStart: null, firstManualPublishes: 0, cohortSize: 0, retained: 0 }, windows, now)).toEqual({
      firstManualPublishes: null,
      cohortSize: null,
      retained: null,
      rate: null,
      observationStart: null,
      computedAt: now.toISOString(),
    });
  });

  it('keeps the cohort Unknown until a receipt reaches the cohort window', () => {
    const counts = { firstManualPublishes: 3, cohortSize: 0, retained: 0 };
    expect(publishRetentionReadout({ ...counts, observationStart: new Date(days(7).getTime() + 1) }, windows, now)).toMatchObject({
      firstManualPublishes: 3,
      cohortSize: null,
      retained: null,
      rate: null,
    });
    expect(publishRetentionReadout({ ...counts, observationStart: days(7) }, windows, now)).toMatchObject({ cohortSize: 0, retained: 0, rate: null });
  });

  it('reports a rate only from five projects', () => {
    const counts = { observationStart: days(40), firstManualPublishes: 2 };
    expect(publishRetentionReadout({ ...counts, cohortSize: 4, retained: 4 }, windows, now).rate).toBeNull();
    expect(publishRetentionReadout({ ...counts, cohortSize: 5, retained: 2 }, windows, now).rate).toBe(0.4);
  });
});
