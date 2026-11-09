import type { ClickHouseClient } from '@clickhouse/client';
import { describe, expect, it, vi } from 'vitest';
import { analyticsWindows, fillDays, queryProjectAnalytics, queryWorkspaceAnalytics, windowDays } from './queries';

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

  it('starts at the same hour the SQL reads, so a quiet first day survives half-hour offsets', () => {
    // 18:45 UTC minus 7 days, floored to the hour, is Nov 1 18:00 UTC = Nov 1 23:30 in Kolkata.
    const kolkata = windowDays(7, 'Asia/Kolkata', new Date('2026-11-08T18:45:00Z'));
    expect(kolkata[0]).toBe('2026-11-01');
    expect(kolkata.at(-1)).toBe('2026-11-09');
    // 18:20 UTC minus 7 days floors to Nov 1 18:00 UTC = 23:45 in Kathmandu: a quiet Nov 1 still has a zero bucket.
    expect(fillDays([], 7, 'Asia/Kathmandu', new Date('2026-11-08T18:20:00Z'))[0]).toEqual({ date: '2026-11-01', views: 0 });
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
  /**
   * Evaluates the page-view totals against synthetic hourly traffic: every
   * hour has `perHour` views, so the answer depends only on the bounds a
   * query passes, as it would in ClickHouse.
   */
  type WindowParams = Record<'display_start' | 'comparable_start' | 'comparable_end' | 'previous_start' | 'previous_end', number>;
  type Call = { query: string; query_params: WindowParams };
  const trafficClient = (perHour: number, calls: Call[] = []) =>
    ({
      query: vi.fn(async (call: Call) => {
        calls.push(call);
        const p = call.query_params;
        const hours = (from: number, to: number) => Math.max(0, Math.round((to - from) / 3600));
        const nowSeconds = Math.floor(Date.now() / 1000);
        let value: number | undefined;
        if (call.query.startsWith('SELECT sum(c) AS value')) {
          if (call.query.includes('{previous_start:UInt32}')) value = perHour * hours(p.previous_start, p.previous_end);
          else if (call.query.includes('{comparable_start:UInt32}')) value = perHour * hours(p.comparable_start, p.comparable_end);
          // The displayed total includes the partial current hour.
          else value = perHour * hours(p.display_start, nowSeconds) + perHour / 2;
        }
        return { json: async () => (value === undefined ? [] : [{ value }]) };
      }),
    }) as unknown as ClickHouseClient;

  it('compares equal, adjacent windows: constant traffic reads flat at any minute of the hour', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      for (const at of ['2026-11-08T12:30:00Z', '2026-11-08T12:00:00Z', '2026-11-08T12:59:59Z']) {
        vi.setSystemTime(new Date(at));
        const project = await queryProjectAnalytics('tenant-1', 'project-1', '24h', 'UTC', trafficClient(10));
        expect(project.comparableTotalViews).toBe(240);
        expect(project.previousTotalViews).toBe(240);
        const workspace = await queryWorkspaceAnalytics([{ tenantId: 'tenant-1', projectId: 'project-1' }], '7d', 'UTC', trafficClient(3));
        expect(workspace.comparableTotalViews).toBe(workspace.previousTotalViews);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads one clock for every query of a request', async () => {
    const calls: Call[] = [];
    await queryWorkspaceAnalytics([{ tenantId: 'tenant-1', projectId: 'project-1' }], '30d', 'UTC', trafficClient(1, calls));
    const anchors = new Set(calls.map((call) => `${call.query_params.display_start}/${call.query_params.comparable_end}`));
    expect(anchors.size).toBe(1);
  });

  it('builds the windows from one anchor: completed hours, equal spans, no gap or overlap', () => {
    const windows = analyticsWindows(1, new Date('2026-11-08T12:30:00Z'));
    expect(new Date(windows.comparable.end).toISOString()).toBe('2026-11-08T12:00:00.000Z');
    expect(windows.comparable.end - windows.comparable.start).toBe(windows.previous.end - windows.previous.start);
    expect(windows.previous.end).toBe(windows.comparable.start);
    expect(new Date(windows.displayStart).toISOString()).toBe('2026-11-07T12:00:00.000Z');
  });

  it('keeps the previous period unknown when ClickHouse is unavailable', async () => {
    const client = { query: vi.fn().mockRejectedValue(new Error('down')) } as unknown as ClickHouseClient;
    expect((await queryProjectAnalytics('tenant-1', 'project-1', '7d', 'UTC', client)).previousTotalViews).toBeNull();
  });
});
