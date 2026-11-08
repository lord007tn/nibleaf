import { describe, expect, it } from 'vitest';
import { fillDailyGaps } from './overview';

const day = (date: string, questions: number) => ({
  date,
  questions,
  answered: questions,
  noAnswer: 0,
  up: 0,
  down: 0,
  inputTokens: questions * 100,
  outputTokens: questions * 300,
  costUsd: questions * 0.001,
});

describe('fillDailyGaps', () => {
  it('keeps the axis continuous: quiet days become zero, not missing', () => {
    const filled = fillDailyGaps([day('2026-10-17', 2), day('2026-10-21', 1)], '2026-10-22');
    expect(filled.map((point) => point.date)).toEqual(['2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22']);
    expect(filled.map((point) => point.questions)).toEqual([2, 0, 0, 0, 1, 0]);
    expect(filled[1]).toMatchObject({ answered: 0, inputTokens: 0, costUsd: 0 });
  });

  it('sorts out-of-order buckets and keeps their own values', () => {
    const filled = fillDailyGaps([day('2026-10-03', 4), day('2026-10-01', 1)], '2026-10-03');
    expect(filled.map((point) => [point.date, point.questions])).toEqual([
      ['2026-10-01', 1],
      ['2026-10-02', 0],
      ['2026-10-03', 4],
    ]);
  });

  it('crosses month ends and daylight-saving changes one calendar day at a time', () => {
    const filled = fillDailyGaps([day('2026-10-30', 1)], '2026-11-02');
    expect(filled.map((point) => point.date)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  });

  it('returns nothing for an empty range so the chart shows its empty state', () => {
    expect(fillDailyGaps([], '2026-10-22')).toEqual([]);
  });
});
