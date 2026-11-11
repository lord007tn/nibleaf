import { describe, expect, it } from 'vitest';
import { completionStillApplies, deleteMayHaveHappened, websiteIsGone } from './delete';

describe('deleteMayHaveHappened', () => {
  it.each([
    ['a lost response (no status)', new TypeError('Failed to fetch'), true],
    ['a timeout', { status: 408 }, true],
    ['a gateway error', { status: 502 }, true],
    ['a server error', { status: 500 }, true],
    ['already gone', { status: 404 }, true],
    ['not allowed', { status: 403 }, false],
    ['signed out', { status: 401 }, false],
    ['a conflict', { status: 409 }, false],
    ['a bad request', { status: 400 }, false],
  ])('%s → %s', (_name, error, expected) => {
    expect(deleteMayHaveHappened(error)).toBe(expected);
  });
});

describe('websiteIsGone', () => {
  it('is gone only when the list no longer has it', () => {
    expect(websiteIsGone([{ id: 'a' }, { id: 'b' }], 'c')).toBe(true);
    expect(websiteIsGone([{ id: 'a' }, { id: 'c' }], 'c')).toBe(false);
    expect(websiteIsGone([], 'c')).toBe(true);
  });
});

describe('completionStillApplies', () => {
  const start = { run: 3, userId: 'u-1' };
  it('applies to the same run, person and mounted page only', () => {
    expect(completionStillApplies(start, { run: 3, userId: 'u-1', mounted: true })).toBe(true);
    expect(completionStillApplies(start, { run: 3, userId: 'u-1', mounted: false })).toBe(false);
    expect(completionStillApplies(start, { run: 4, userId: 'u-1', mounted: true })).toBe(false);
    expect(completionStillApplies(start, { run: 3, userId: 'u-2', mounted: true })).toBe(false);
    expect(completionStillApplies(start, { run: 3, userId: undefined, mounted: true })).toBe(false);
  });
});
