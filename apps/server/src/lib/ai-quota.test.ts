import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), incr: vi.fn(), expire: vi.fn(), extras: { AI_DAILY_LIMIT: 2 } }));
vi.mock('@nibleaf/bullmq/keys', () => ({ keys: () => ({ REDIS_HOST: 'test', REDIS_PORT: 6379, REDIS_DB: 0 }) }));
vi.mock('ioredis', () => ({
  Redis: class {
    get = mocks.get;
    incr = mocks.incr;
    expire = mocks.expire;
    on = vi.fn();
  },
}));
vi.mock('./env-extras', () => ({ envExtras: mocks.extras }));

import { assertAiQuota, isAiQuotaExhausted } from './ai-quota';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.extras.AI_DAILY_LIMIT = 2;
  mocks.get.mockResolvedValue(null);
  mocks.incr.mockResolvedValue(1);
  mocks.expire.mockResolvedValue(1);
});
describe('non-consuming drafting quota reads', () => {
  it.each([
    [null, false],
    ['1', false],
    ['2', true],
    ['3', true],
  ] as const)('reads count %s as exhausted=%s', async (used, exhausted) => {
    mocks.get.mockResolvedValue(used);
    expect(await isAiQuotaExhausted('org')).toBe(exhausted);
    expect(mocks.get).toHaveBeenCalledWith(`nibleaf:ai-quota:org:${new Date().toISOString().slice(0, 10)}`);
    expect(mocks.incr).not.toHaveBeenCalled();
    expect(mocks.expire).not.toHaveBeenCalled();
  });
  it('treats zero limit as exhausted without Redis', async () => {
    mocks.extras.AI_DAILY_LIMIT = 0;
    expect(await isAiQuotaExhausted('org')).toBe(true);
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it.each(['broken', '-1', '0.5'])('rejects an invalid counter %s', async (value) => {
    mocks.get.mockResolvedValue(value);
    await expect(isAiQuotaExhausted('org')).rejects.toMatchObject({ code: 'search:unavailable', status: 503 });
  });
  it('fails closed on read errors', async () => {
    mocks.get.mockRejectedValue(new Error('Redis unavailable'));
    await expect(isAiQuotaExhausted('org')).rejects.toMatchObject({ code: 'search:unavailable', status: 503 });
  });
});
describe('unchanged quota consumption', () => {
  it('increments once per draft and sets the original expiry only for a new counter', async () => {
    await assertAiQuota('org');
    expect(mocks.incr).toHaveBeenCalledTimes(1);
    expect(mocks.expire).toHaveBeenCalledWith(expect.any(String), 86_400);
    mocks.incr.mockResolvedValue(2);
    await assertAiQuota('org');
    expect(mocks.expire).toHaveBeenCalledTimes(1);
  });
  it('allows the final request and rejects the next with the existing quota error', async () => {
    mocks.incr.mockResolvedValue(2);
    await expect(assertAiQuota('org')).resolves.toBeUndefined();
    mocks.incr.mockResolvedValue(3);
    await expect(assertAiQuota('org')).rejects.toMatchObject({ code: 'http:rate_limited', status: 429 });
  });
});
