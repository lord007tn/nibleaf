import type { ClickHouseClient } from '@clickhouse/client';
import { describe, expect, it, vi } from 'vitest';
import { deleteProjectAnalytics, exportProjectAnalytics, rebuildProjectAnalyticsRollups } from './privacy';

describe('analytics privacy tombstones', () => {
  it('persists the tombstone before synchronously deleting every retained analytics table', async () => {
    const insert = vi.fn(async () => undefined);
    const command = vi.fn(async () => undefined);
    await deleteProjectAnalytics('org-a', 'project-a', { insert, command } as unknown as ClickHouseClient);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        table: 'analytics_deletion_tombstones',
        values: [expect.objectContaining({ tenant_id: 'org-a', project_id: 'project-a' })],
      }),
    );
    expect(insert.mock.invocationCallOrder[0]).toBeLessThan(command.mock.invocationCallOrder[0] ?? 0);
    expect(command).toHaveBeenCalledTimes(6);
  });

  it('excludes tombstoned scopes from rebuilds and exports even if physical mutations lag', async () => {
    const command = vi.fn(async (_input: { query: string }) => undefined);
    const query = vi.fn(async (_input: { query: string }) => ({ json: async () => [] }));
    const client = { command, query } as unknown as ClickHouseClient;
    await rebuildProjectAnalyticsRollups('org-a', 'project-a', client);
    await exportProjectAnalytics('org-a', 'project-a', {}, client);
    const statements = [...command.mock.calls.map(([input]) => input.query), ...query.mock.calls.map(([input]) => input.query)].join('\n');
    expect(statements).toContain('analytics_deletion_tombstones FINAL');
  });
});
