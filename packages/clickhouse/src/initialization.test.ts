import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeClickHouseFn } from './initialization';

describe('ClickHouse lifecycle initialization', () => {
  beforeEach(() => vi.stubEnv('ANALYTICS_MODE', 'dual_write'));
  afterEach(() => vi.unstubAllEnvs());
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
