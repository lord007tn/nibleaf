import { describe, expect, it } from 'vitest';
import { activationTiming } from './activation-metrics';

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
