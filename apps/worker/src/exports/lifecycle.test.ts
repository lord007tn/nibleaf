import { describe, expect, it } from 'vitest';
import { expiredRunIds, isFinalExportAttempt } from './lifecycle';

describe('export lifecycle', () => {
  it('expires runs beyond count and age retention without touching recent retained runs', () => {
    const now = new Date('2026-08-16T00:00:00Z');
    const runs = [
      { id: 'newest', createdAt: new Date('2026-08-15T00:00:00Z') },
      { id: 'second', createdAt: new Date('2026-08-14T00:00:00Z') },
      { id: 'beyond-count', createdAt: new Date('2026-08-13T00:00:00Z') },
      { id: 'too-old', createdAt: new Date('2026-07-01T00:00:00Z') },
    ];
    expect(expiredRunIds(runs, 2, 30, now)).toEqual(['beyond-count', 'too-old']);
  });

  it('reports failure only after the configured retry budget is exhausted', () => {
    expect(isFinalExportAttempt(0, 3)).toBe(false);
    expect(isFinalExportAttempt(1, 3)).toBe(false);
    expect(isFinalExportAttempt(2, 3)).toBe(true);
    expect(isFinalExportAttempt(0, undefined)).toBe(true);
  });
});
