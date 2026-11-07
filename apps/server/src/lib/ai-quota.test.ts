import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ incr: vi.fn(), expire: vi.fn(), exec: vi.fn() }));
vi.mock('@nibleaf/bullmq/keys', () => ({ keys: () => ({ REDIS_HOST: 'unused', REDIS_PORT: 6379, REDIS_DB: 0 }) }));
vi.mock('./env-extras', () => ({ envExtras: { AI_DAILY_LIMIT: 2 } }));
vi.mock('ioredis', () => ({
  Redis: class {
    multi() {
      return { incr: mocks.incr, expire: mocks.expire, exec: mocks.exec };
    }
    on = vi.fn();
  },
}));

import { assertAiQuota } from './ai-quota';

describe('draft quota', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.incr.mockReturnThis();
    mocks.expire.mockReturnThis();
    mocks.exec.mockResolvedValue([
      [null, 1],
      [null, 1],
    ]);
  });

  it('rejects a request if the counter is unavailable', async () => {
    const cause = new Error('connection failed');
    mocks.exec.mockRejectedValue(cause);
    await expect(assertAiQuota('workspace')).rejects.toMatchObject({ code: 'usage:unavailable', status: 503, cause });
  });

  it('rejects a request if the counter expiry cannot be set', async () => {
    const cause = new Error('expire failed');
    mocks.exec.mockResolvedValue([
      [null, 1],
      [cause, null],
    ]);
    await expect(assertAiQuota('workspace')).rejects.toMatchObject({ code: 'usage:unavailable', status: 503, cause });
  });

  it('increments and sets an NX expiry in one transaction without extending the window', async () => {
    await expect(assertAiQuota('workspace')).resolves.toBeUndefined();
    expect(mocks.expire).toHaveBeenCalledWith(expect.stringContaining(':workspace:'), 86_400, 'NX');
    mocks.exec.mockResolvedValue([
      [null, 2],
      [null, 0],
    ]);
    await expect(assertAiQuota('workspace')).resolves.toBeUndefined();
    expect(mocks.expire).toHaveBeenCalledTimes(2);
  });

  it('rejects exhausted budgets', async () => {
    mocks.exec.mockResolvedValue([
      [null, 3],
      [null, 0],
    ]);
    await expect(assertAiQuota('workspace')).rejects.toMatchObject({ code: 'http:rate_limited' });
  });
});
