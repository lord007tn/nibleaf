import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), incr: vi.fn(), exec: vi.fn(), extras: { AI_DAILY_LIMIT: 2 } }));
vi.mock('@nibleaf/bullmq/keys', () => ({ keys: () => ({ REDIS_HOST: 'test', REDIS_PORT: 6379, REDIS_DB: 0 }) }));
vi.mock('ioredis', () => ({
  Redis: class {
    get = mocks.get;
    multi() {
      return { set: mocks.set, incr: mocks.incr, exec: mocks.exec };
    }
    on = vi.fn();
  },
}));
vi.mock('./env-extras', () => ({ envExtras: mocks.extras }));

import { assertAiQuota, isAiQuotaExhausted } from './ai-quota';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.extras.AI_DAILY_LIMIT = 2;
  mocks.get.mockResolvedValue(null);
  mocks.set.mockReturnThis();
  mocks.incr.mockReturnThis();
  mocks.exec.mockResolvedValue([
    [null, 'OK'],
    [null, 1],
  ]);
});

describe('non-consuming drafting quota reads', () => {
  it.each([
    [null, false],
    ['0', false],
    ['1', false],
    ['2', true],
    ['3', true],
  ] as const)('reads count %s as exhausted=%s', async (used, exhausted) => {
    mocks.get.mockResolvedValue(used);
    expect(await isAiQuotaExhausted('org')).toBe(exhausted);
    expect(mocks.get).toHaveBeenCalledWith(`nibleaf:ai-quota:org:${new Date().toISOString().slice(0, 10)}`);
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.incr).not.toHaveBeenCalled();
  });
  it('treats zero limit as exhausted without Redis', async () => {
    mocks.extras.AI_DAILY_LIMIT = 0;
    expect(await isAiQuotaExhausted('org')).toBe(true);
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it.each(['broken', '-1', '0.5'])('rejects an invalid counter %s', async (value) => {
    mocks.get.mockResolvedValue(value);
    await expect(isAiQuotaExhausted('org')).rejects.toMatchObject({ code: 'usage:unavailable', status: 503 });
  });
  it('fails closed on read errors', async () => {
    mocks.get.mockRejectedValue(new Error('Redis unavailable'));
    await expect(isAiQuotaExhausted('org')).rejects.toMatchObject({ code: 'usage:unavailable', status: 503 });
  });
});

describe('fail-closed quota consumption', () => {
  it('creates the day counter with its expiry only once, then counts, in one transaction', async () => {
    await assertAiQuota('org');
    // SET ... EX ... NX works on every Redis version and never extends an existing window.
    expect(mocks.set).toHaveBeenCalledWith(expect.stringContaining(':org:'), 0, 'EX', 86_400, 'NX');
    expect(mocks.incr).toHaveBeenCalledTimes(1);
    mocks.exec.mockResolvedValue([
      [null, null],
      [null, 2],
    ]);
    await expect(assertAiQuota('org')).resolves.toBeUndefined();
  });
  it('allows the final request and rejects the next with the existing quota error', async () => {
    mocks.exec.mockResolvedValue([
      [null, null],
      [null, 2],
    ]);
    await expect(assertAiQuota('org')).resolves.toBeUndefined();
    mocks.exec.mockResolvedValue([
      [null, null],
      [null, 3],
    ]);
    await expect(assertAiQuota('org')).rejects.toMatchObject({ code: 'http:rate_limited', status: 429 });
  });
  it('fails closed if Redis is down', async () => {
    mocks.exec.mockRejectedValue(new Error('Redis unavailable'));
    await expect(assertAiQuota('org')).rejects.toMatchObject({ code: 'usage:unavailable', status: 503 });
  });
  it('fails closed if the counter cannot be created', async () => {
    mocks.exec.mockResolvedValue([
      [new Error('set failed'), null],
      [null, 1],
    ]);
    await expect(assertAiQuota('org')).rejects.toMatchObject({ code: 'usage:unavailable', status: 503 });
  });
  it('fails closed if the counter cannot be incremented', async () => {
    mocks.exec.mockResolvedValue([
      [null, 'OK'],
      [new Error('incr failed'), null],
    ]);
    await expect(assertAiQuota('org')).rejects.toMatchObject({ code: 'usage:unavailable', status: 503 });
  });
});
