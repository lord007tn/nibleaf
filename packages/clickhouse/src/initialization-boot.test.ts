import type { ClickHouseClient } from '@clickhouse/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAnalyticsHealth, migrateClickHouseSchema, runClickHouseBootMigrations } from './initialization';

vi.mock('@nibleaf/logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn() }) }));
const mocks = vi.hoisted(() => ({ migrate: vi.fn().mockResolvedValue([1, 2]) }));
vi.mock('./migrations', () => ({ migrations: [{ version: 1 }, { version: 2 }], runClickHouseMigrations: mocks.migrate }));

const client = (rows: unknown[][]) =>
  ({ query: vi.fn().mockImplementation(async () => ({ json: async () => rows.shift() })) }) as unknown as ClickHouseClient;

describe('background schema lifecycle', () => {
  beforeEach(() => {
    vi.stubEnv('ANALYTICS_MODE', 'dual_write');
    vi.stubEnv('CLICKHOUSE_MIGRATE_ON_BOOT', 'true');
    // Pin values the assertions depend on, so a developer's or CI's ClickHouse env can't change them.
    vi.stubEnv('CLICKHOUSE_DATABASE', 'nibleaf_analytics');
    vi.stubEnv('CLICKHOUSE_RAW_RETENTION_DAYS', '180');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('does no work when analytics or boot migrations are disabled', async () => {
    const migrate = vi.fn();
    vi.stubEnv('ANALYTICS_MODE', 'disabled');
    await runClickHouseBootMigrations({ migrate });
    expect(await getAnalyticsHealth()).toEqual({ configured: false, latencyMs: null, status: 'disabled' });
    vi.stubEnv('ANALYTICS_MODE', 'dual_write');
    vi.stubEnv('CLICKHOUSE_MIGRATE_ON_BOOT', 'false');
    await runClickHouseBootMigrations({ migrate });
    expect(migrate).not.toHaveBeenCalled();
  });

  it('creates the database before applying migrations and closes both clients', async () => {
    const admin = { command: vi.fn(), close: vi.fn() };
    const writer = { close: vi.fn() };
    const create = vi.fn().mockReturnValueOnce(admin).mockReturnValueOnce(writer);
    const withLock = vi.fn(async (action: () => Promise<void>) => {
      await action();
      return true;
    });
    expect(await migrateClickHouseSchema({ create: create as never, withLock })).toBe(true);
    expect(admin.command).toHaveBeenCalledWith({ query: 'CREATE DATABASE IF NOT EXISTS nibleaf_analytics' });
    expect(mocks.migrate).toHaveBeenCalledWith(writer, expect.objectContaining({ rawRetentionDays: 180 }));
    expect(admin.close).toHaveBeenCalledOnce();
    expect(writer.close).toHaveBeenCalledOnce();
    expect((await getAnalyticsHealth({ client: client([[{ count: 1 }], [{ version: 1 }, { version: 2 }]]) })).status).toBe('ok');
  });

  it('recovers after an outage, without sleeping under the lock, and caps backoff', async () => {
    const migrate = vi.fn();
    for (let i = 0; i < 9; i++) migrate.mockRejectedValueOnce(new Error('down'));
    migrate.mockResolvedValueOnce(true);
    const wait = vi.fn().mockResolvedValue(undefined);
    await runClickHouseBootMigrations({ migrate, wait });
    expect(migrate).toHaveBeenCalledTimes(10);
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000, 60_000]);
  });

  it('does not create clients while another process holds the lock and retries later', async () => {
    const create = vi.fn();
    expect(await migrateClickHouseSchema({ create, withLock: async () => false })).toBe(false);
    expect(create).not.toHaveBeenCalled();
    const migrate = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const wait = vi.fn().mockResolvedValue(undefined);
    await runClickHouseBootMigrations({ migrate, wait });
    expect(wait).toHaveBeenCalledWith(1000);
    expect(migrate).toHaveBeenCalledTimes(2);
  });

  it('reports schema_outdated for a missing table or a missing applied version', async () => {
    expect((await getAnalyticsHealth({ client: client([[{ count: 0 }]]) })).status).toBe('schema_outdated');
    expect((await getAnalyticsHealth({ client: client([[{ count: 1 }], [{ version: 2 }]]) })).status).toBe('schema_outdated');
  });

  it('shares concurrent probes, caches for ten seconds, and bypasses the cache while migrating', async () => {
    let now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const fake = client([[{ count: 1 }], [{ version: 1 }], [{ count: 1 }], [{ version: 1 }, { version: 2 }]]);
    const results = await Promise.all([getAnalyticsHealth({ client: fake }), getAnalyticsHealth({ client: fake })]);
    expect(results.map((result) => result.status)).toEqual(['schema_outdated', 'schema_outdated']);
    expect(fake.query).toHaveBeenCalledTimes(2);
    now = 10_999;
    expect((await getAnalyticsHealth({ client: fake })).status).toBe('schema_outdated');
    expect((await getAnalyticsHealth({ client: fake, migrating: true })).status).toBe('migrating');
    expect(fake.query).toHaveBeenCalledTimes(2);
    now = 11_000;
    expect((await getAnalyticsHealth({ client: fake })).status).toBe('ok');
    expect(fake.query).toHaveBeenCalledTimes(4);
  });

  it('caches outages and immediately reflects local migration start and completion', async () => {
    const fake = { query: vi.fn().mockRejectedValue(new Error('down')) } as unknown as ClickHouseClient;
    expect((await getAnalyticsHealth({ client: fake })).status).toBe('unavailable');
    expect((await getAnalyticsHealth({ client: fake })).status).toBe('unavailable');
    expect(fake.query).toHaveBeenCalledOnce();
    fake.query = vi
      .fn()
      .mockResolvedValueOnce({ json: async () => [{ count: 1 }] })
      .mockResolvedValueOnce({ json: async () => [{ version: 1 }, { version: 2 }] });
    await runClickHouseBootMigrations({
      migrate: async () => {
        expect((await getAnalyticsHealth({ client: fake })).status).toBe('migrating');
        expect(fake.query).not.toHaveBeenCalled();
        return true;
      },
    });
    expect((await getAnalyticsHealth({ client: fake })).status).toBe('ok');
    expect(fake.query).toHaveBeenCalledTimes(2);
  });

  it('bounds a stalled health probe independently of the transport timeout', async () => {
    const stalled = {
      query: ({ abort_signal }: { abort_signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          abort_signal.addEventListener('abort', () => reject(new Error('probe deadline')), { once: true });
        }),
    } as unknown as ClickHouseClient;
    expect(await getAnalyticsHealth({ client: stalled })).toEqual({ configured: true, latencyMs: null, status: 'unavailable' });
  });

  it('reports unavailable on connection failure and migrating during schema application', async () => {
    const down = { query: vi.fn().mockRejectedValue(new Error('down')) } as unknown as ClickHouseClient;
    expect(await getAnalyticsHealth({ client: down })).toEqual({ configured: true, latencyMs: null, status: 'unavailable' });
    expect((await getAnalyticsHealth({ client: client([[{ count: 0 }]]), migrating: true })).status).toBe('migrating');
  });
});
