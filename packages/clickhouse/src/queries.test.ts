import type { ClickHouseClient } from '@clickhouse/client';
import { describe, expect, it, vi } from 'vitest';
import { fillDays, queryProjectAnalytics, queryWorkspaceAnalytics, windowDays } from './queries';

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

describe('daily buckets', () => {
  const now = new Date('2026-11-08T21:30:00Z');

  it('covers both partial edge days of the window in the viewer timezone', () => {
    // 21:30 UTC is already Nov 9 in Riyadh (UTC+3); seven days back is Nov 2 there.
    expect(windowDays(7, 'Asia/Riyadh', now)).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
      '2026-11-09',
    ]);
    expect(windowDays(1, 'America/Los_Angeles', now)).toEqual(['2026-11-07', '2026-11-08']);
  });

  it('zero-fills quiet days instead of drawing their neighbours side by side', () => {
    const filled = fillDays(
      [
        { date: '2026-11-03', views: '4' },
        { date: '2026-11-06', views: 9 },
      ],
      7,
      'UTC',
      now,
    );
    expect(filled.map((row) => row.views)).toEqual([0, 0, 4, 0, 0, 9, 0, 0]);
    expect(filled[0]?.date).toBe('2026-11-01');
    expect(filled.at(-1)?.date).toBe('2026-11-08');
  });
});

describe('previous period', () => {
  /** Answers each query by its shape: the previous-window total, the current total, or nothing. */
  const fakeClient = () =>
    ({
      query: vi.fn(async ({ query }: { query: string }) => ({
        json: async () => {
          if (query.includes('* 2)) AND hour <')) return [{ value: 40 }];
          if (query.startsWith('SELECT sum(c) AS value')) return [{ value: 50 }];
          return [];
        },
      })),
    }) as unknown as ClickHouseClient;

  it('reports page views of the equal window right before the selected one', async () => {
    const project = await queryProjectAnalytics('tenant-1', 'project-1', '7d', 'UTC', fakeClient());
    expect(project).toMatchObject({ totalViews: 50, previousTotalViews: 40 });
    const workspace = await queryWorkspaceAnalytics([{ tenantId: 'tenant-1', projectId: 'project-1' }], '30d', 'UTC', fakeClient());
    expect(workspace).toMatchObject({ totalViews: 50, previousTotalViews: 40 });
    expect(workspace.timeseries.length).toBeGreaterThanOrEqual(30);
  });

  it('keeps the previous period unknown when ClickHouse is unavailable', async () => {
    const client = { query: vi.fn().mockRejectedValue(new Error('down')) } as unknown as ClickHouseClient;
    expect((await queryProjectAnalytics('tenant-1', 'project-1', '7d', 'UTC', client)).previousTotalViews).toBeNull();
  });
});
