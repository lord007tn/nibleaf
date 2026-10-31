import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeClickHouseFn } from './initialization';

const mocks = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('@nibleaf/logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: mocks.warn }) }));

describe('ClickHouse lifecycle initialization', () => {
  beforeEach(() => vi.stubEnv('ANALYTICS_MODE', 'dual_write'));
  afterEach(() => {
    vi.unstubAllEnvs();
    mocks.warn.mockClear();
  });

  it('warns in production when the reader-identifier salt is missing', async () => {
    vi.stubEnv('ANALYTICS_MODE', 'disabled');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ANALYTICS_HASH_SALT', '');
    await initializeClickHouseFn();
    expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining('ANALYTICS_HASH_SALT is not set'));
    mocks.warn.mockClear();
    vi.stubEnv('ANALYTICS_HASH_SALT', 'random-salt');
    await initializeClickHouseFn();
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it('checks each owned role and reports readiness', async () => {
    const json = vi.fn().mockResolvedValue([{ ok: 1 }]);
    const query = vi.fn().mockResolvedValue({ json });
    const result = await initializeClickHouseFn({ roles: ['reader', 'writer'], clientForRole: () => ({ query }) as never });
    expect(result).toMatchObject({ configured: true, roles: ['reader', 'writer'], status: 'ok' });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('returns unavailable instead of throwing when analytics is down', async () => {
    const result = await initializeClickHouseFn({
      roles: ['writer'],
      clientForRole: () => ({ query: vi.fn().mockRejectedValue(new Error('connection refused password=secret')) }) as never,
    });
    expect(result).toMatchObject({ configured: true, latencyMs: null, status: 'unavailable' });
  });
});
