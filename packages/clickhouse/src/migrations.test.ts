import type { ClickHouseClient } from '@clickhouse/client';
import { describe, expect, it, vi } from 'vitest';
import { migrations, runClickHouseMigrations } from './migrations';

describe('retention reconciliation', () => {
  it('reapplies changed environment TTLs when every migration is already applied', async () => {
    const command = vi.fn(async (_input: object) => undefined);
    const insert = vi.fn();
    const query = vi.fn(async () => ({ json: async () => migrations.map(({ version }) => ({ version })) }));
    const client = { command, insert, query } as unknown as ClickHouseClient;
    const policy = { rawRetentionDays: 180, crawlerRetentionDays: 90, rollupRetentionDays: 730, sensitiveRetentionDays: 30 };
    expect(await runClickHouseMigrations(client, policy)).toEqual([]);
    expect(insert).not.toHaveBeenCalled();
    command.mockClear();
    expect(await runClickHouseMigrations(client, { ...policy, crawlerRetentionDays: 45, sensitiveRetentionDays: 14 })).toEqual([]);
    expect(command).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining('ALTER TABLE analytics_events MODIFY TTL'),
        query_params: { days: 180, crawler_days: 45 },
        clickhouse_settings: { materialize_ttl_after_modify: 0 },
      }),
    );
    expect(command).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining('ALTER TABLE analytics_sensitive_queries MODIFY TTL'),
        query_params: { days: 14, crawler_days: 45 },
      }),
    );
    expect(command).toHaveBeenCalledWith(expect.objectContaining({ query: expect.stringContaining('ALTER TABLE usage_hourly MODIFY TTL') }));
    expect(command.mock.calls.some(([input]) => String((input as { query?: string }).query).includes('DROP TABLE'))).toBe(false);
  });
});
