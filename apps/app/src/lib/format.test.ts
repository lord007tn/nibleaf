import { describe, expect, it } from 'vitest';
import { viewsTrend } from './format';

const series = (...views: number[]) => views.map((v, i) => ({ date: `d${i}`, views: v }));

describe('viewsTrend', () => {
  it('returns null with too few points to compare', () => {
    expect(viewsTrend([])).toBeNull();
    expect(viewsTrend(series(1, 2, 3))).toBeNull();
  });

  it('reports an upward trend (recent half greater than older half)', () => {
    // older = 1+1 = 2, recent = 3+3 = 6 → +200%
    const t = viewsTrend(series(1, 1, 3, 3));
    expect(t?.direction).toBe('up');
    expect(t?.pct).toBeCloseTo(200);
  });

  it('reports a downward trend', () => {
    // older = 10+10 = 20, recent = 5+5 = 10 → -50%
    const t = viewsTrend(series(10, 10, 5, 5));
    expect(t?.direction).toBe('down');
    expect(t?.pct).toBeCloseTo(-50);
  });

  it('reports flat when within ±1%', () => {
    const t = viewsTrend(series(100, 100, 100, 100));
    expect(t?.direction).toBe('flat');
    expect(t?.pct).toBe(0);
  });

  it('handles a zero older half without dividing by zero', () => {
    const t = viewsTrend(series(0, 0, 5, 5));
    expect(t).toEqual({ pct: 100, direction: 'up' });
  });

  it('returns null when there is no traffic at all', () => {
    expect(viewsTrend(series(0, 0, 0, 0))).toBeNull();
  });
});

