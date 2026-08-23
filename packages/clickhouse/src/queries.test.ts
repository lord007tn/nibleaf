import type { ClickHouseClient } from '@clickhouse/client';
import { describe, expect, it, vi } from 'vitest';
import { queryProjectAnalytics } from './queries';

describe('ClickHouse analytics availability', () => {
  it('reports unknown metrics when ClickHouse is unavailable', async () => {
    const client = { query: vi.fn().mockRejectedValue(new Error('connection refused')) } as unknown as ClickHouseClient;
    const overview = await queryProjectAnalytics('tenant-1', 'project-1', '7d', 'Not/A-Timezone', client);
    expect(overview).toMatchObject({
      availability: 'unavailable',
      timezone: 'UTC',
      totalViews: null,
      uniqueVisitors: null,
      searches: { total: null },
      ai: { costMicros: null },
    });
  });
});
