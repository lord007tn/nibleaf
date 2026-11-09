import type { ClickHouseClient } from '@clickhouse/client';
import { describe, expect, it, vi } from 'vitest';

// Hourly rollups are kept for 120 days on this instance.
vi.mock('./keys', () => ({ keys: () => ({ CLICKHOUSE_ROLLUP_RETENTION_DAYS: 120 }) }));

import { previousWindowRetained, queryProjectAnalytics, queryWorkspaceAnalytics } from './queries';

/** Every page-view total answers 500; nothing else returns rows. */
const client = () =>
  ({
    query: vi.fn(async ({ query }: { query: string }) => ({
      json: async () => (query.startsWith('SELECT sum(c) AS value') ? [{ value: 500 }] : []),
    })),
  }) as unknown as ClickHouseClient;

describe('previous period against rollup retention', () => {
  it('knows when the whole previous window is still retained', () => {
    const now = new Date('2026-11-08T12:30:00Z');
    expect(previousWindowRetained(30, 120, now)).toBe(true); // reaches back 60 days
    expect(previousWindowRetained(90, 120, now)).toBe(false); // reaches back 180 days
    expect(previousWindowRetained(90, 730, now)).toBe(true);
  });

  it('reports the previous total as unknown, not low, when retention may have trimmed it', async () => {
    const project = await queryProjectAnalytics('tenant-1', 'project-1', '90d', 'UTC', client());
    expect(project.previousTotalViews).toBeNull();
    expect(project.comparableTotalViews).toBe(500);
    const workspace = await queryWorkspaceAnalytics([{ tenantId: 'tenant-1', projectId: 'project-1' }], '90d', 'UTC', client());
    expect(workspace.previousTotalViews).toBeNull();
  });

  it('keeps comparing when the previous window is fully retained', async () => {
    const project = await queryProjectAnalytics('tenant-1', 'project-1', '30d', 'UTC', client());
    expect(project.previousTotalViews).toBe(500);
  });
});
