import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ set: vi.fn(), incr: vi.fn(), exec: vi.fn() }));
vi.mock('@nibleaf/bullmq/keys', () => ({ keys: () => ({ REDIS_HOST: 'unused', REDIS_PORT: 6379, REDIS_DB: 0 }) }));
vi.mock('./env-extras', () => ({ envExtras: { AI_DAILY_LIMIT: 2 } }));
vi.mock('ioredis', () => ({
  Redis: class {
    multi() {
      return { set: mocks.set, incr: mocks.incr, exec: mocks.exec };
    }
    on = vi.fn();
  },
}));

import { assertAiQuota } from './ai-quota';

describe('draft quota', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.set.mockReturnThis();
    mocks.incr.mockReturnThis();
    mocks.exec.mockResolvedValue([
      [null, 'OK'],
      [null, 1],
    ]);
  });

  it('rejects a request if the counter is unavailable', async () => {
    const cause = new Error('connection failed');
    mocks.exec.mockRejectedValue(cause);
    await expect(assertAiQuota('workspace')).rejects.toMatchObject({ code: 'usage:unavailable', status: 503, cause });
  });

  it('rejects a request if the counter cannot be created', async () => {
    const cause = new Error('set failed');
    mocks.exec.mockResolvedValue([
      [cause, null],
      [null, 1],
    ]);
    await expect(assertAiQuota('workspace')).rejects.toMatchObject({ code: 'usage:unavailable', status: 503, cause });
  });

  it('rejects a request if the counter cannot be incremented', async () => {
    const cause = new Error('incr failed');
    mocks.exec.mockResolvedValue([
      [null, 'OK'],
      [cause, null],
    ]);
    await expect(assertAiQuota('workspace')).rejects.toMatchObject({ code: 'usage:unavailable', status: 503, cause });
  });

  it('creates the day counter with its expiry only once, then counts, in one transaction', async () => {
    await expect(assertAiQuota('workspace')).resolves.toBeUndefined();
    // SET ... EX ... NX works on every Redis version and never extends an existing window.
    expect(mocks.set).toHaveBeenCalledWith(expect.stringContaining(':workspace:'), 0, 'EX', 86_400, 'NX');
    expect(mocks.incr).toHaveBeenCalledWith(expect.stringContaining(':workspace:'));
    expect(mocks.set.mock.invocationCallOrder[0]).toBeLessThan(mocks.incr.mock.invocationCallOrder[0] ?? 0);
    // Second request of the day: the counter exists, so SET NX is a no-op (null).
    mocks.exec.mockResolvedValue([
      [null, null],
      [null, 2],
    ]);
    await expect(assertAiQuota('workspace')).resolves.toBeUndefined();
    expect(mocks.set).toHaveBeenCalledTimes(2);
  });

  it('rejects exhausted budgets', async () => {
    mocks.exec.mockResolvedValue([
      [null, null],
      [null, 3],
    ]);
    await expect(assertAiQuota('workspace')).rejects.toMatchObject({ code: 'http:rate_limited' });
  });
});
