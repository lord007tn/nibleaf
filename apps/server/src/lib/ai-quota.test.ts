import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ incr: vi.fn(), expire: vi.fn() }));
vi.mock('@nibleaf/bullmq/keys', () => ({ keys: () => ({ REDIS_HOST: 'unused', REDIS_PORT: 6379, REDIS_DB: 0 }) }));
vi.mock('./env-extras', () => ({ envExtras: { AI_DAILY_LIMIT: 2 } }));
vi.mock('ioredis', () => ({
  Redis: class {
    incr = mocks.incr;
    expire = mocks.expire;
    on = vi.fn();
  },
}));

import { assertAiQuota } from './ai-quota';

describe('draft quota', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.incr.mockResolvedValue(1);
    mocks.expire.mockResolvedValue(1);
  });

  it('rejects a request if the counter is unavailable', async () => {
    mocks.incr.mockRejectedValue(new Error('connection failed'));
    await expect(assertAiQuota('workspace')).rejects.toThrow('AI drafting is temporarily unavailable. Try again later.');
  });

  it('rejects a request if the counter expiry cannot be set', async () => {
    mocks.expire.mockRejectedValue(new Error('connection failed'));
    await expect(assertAiQuota('workspace')).rejects.toThrow('AI drafting is temporarily unavailable. Try again later.');
  });

  it('allows requests within the limit and expires the first counter', async () => {
    await expect(assertAiQuota('workspace')).resolves.toBeUndefined();
    expect(mocks.expire).toHaveBeenCalledWith(expect.stringContaining(':workspace:'), 86_400);
    mocks.incr.mockResolvedValue(2);
    await expect(assertAiQuota('workspace')).resolves.toBeUndefined();
    expect(mocks.expire).toHaveBeenCalledTimes(1);
  });

  it('rejects exhausted budgets', async () => {
    mocks.incr.mockResolvedValue(3);
    await expect(assertAiQuota('workspace')).rejects.toMatchObject({ code: 'http:rate_limited' });
  });
});
