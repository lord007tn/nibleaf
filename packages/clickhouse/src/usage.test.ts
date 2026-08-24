import { describe, expect, it, vi } from 'vitest';
import { type AnalyticsPayload, buildAnalyticsEvent, deterministicAnalyticsEventId } from './events';
import { insertUsageEvents, queryUsageMeterTotals, reconcileUsageHourly, UsageHistoryUnavailableError, usageEventsFromAnalytics } from './usage';

const analytics = (payload: AnalyticsPayload) =>
  buildAnalyticsEvent(
    { consentState: 'unknown', eventId: deterministicAnalyticsEventId(`usage-test:${payload.name}`), payload },
    {
      tenantId: 'tenant-a',
      projectId: 'project-a',
      siteId: 'site-a',
      source: 'worker',
      receivedAt: new Date('2026-02-01T00:00:00Z'),
      privacy: { visibility: 'public', allowCampaignDimensions: false, allowRawPublicSearchQueries: false },
      hashSalt: 'test',
    },
  );

describe('usage projection', () => {
  it('projects deterministic content-free facts and preserves unknown tokens', () => {
    const first = usageEventsFromAnalytics(analytics({ name: 'answer_completed', latencyMs: 4 }));
    const retry = usageEventsFromAnalytics(analytics({ name: 'answer_completed', latencyMs: 4 }));
    expect(first).toEqual(retry);
    expect(first.map((event) => event.meterKey)).toEqual(['ai_answer']);
    expect(JSON.stringify(first)).not.toMatch(/prompt|query|provider|model|content|vector|secret|userAgent|ipAddress/iu);
  });

  it('never bills private page traffic', () => {
    const event = analytics({ name: 'page_view', path: '/private' });
    event.visibility = 'private';
    expect(usageEventsFromAnalytics(event)).toEqual([]);
  });

  it('scopes every query and insert to canonical identifiers', async () => {
    const insert = vi.fn(async () => undefined);
    await insertUsageEvents(usageEventsFromAnalytics(analytics({ name: 'search_query_submitted' })), { insert } as never);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ values: [expect.objectContaining({ tenant_id: 'tenant-a', project_id: 'project-a' })] }),
    );
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ table: 'usage_reconciliation_state', values: [expect.objectContaining({ status: 'pending' })] }),
    );
    const query = vi.fn(async () => ({ json: async () => [] }));
    await queryUsageMeterTotals('tenant-a', 'project-a', '2026-02-01T00:00:00Z', '2026-03-01T00:00:00Z', { query } as never, {
      now: new Date('2026-03-02T00:00:00Z'),
    });
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({ query_params: expect.objectContaining({ tenant_id: 'tenant-a', project_id: 'project-a' }) }),
    );
  });

  it('does not report expired raw history as a complete zero', async () => {
    const query = vi.fn(async () => ({ json: async () => [] }));
    await expect(
      queryUsageMeterTotals('tenant-a', 'project-a', '2025-01-01T00:00:00Z', '2025-02-01T00:00:00Z', { query } as never, {
        now: new Date('2026-01-01T00:00:00Z'),
        rawRetentionDays: 180,
      }),
    ).rejects.toBeInstanceOf(UsageHistoryUnavailableError);
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ query: expect.stringContaining('usage_reconciliation_coverage FINAL') }));
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('reads retained rollups only when every exact UTC month has coverage proof', async () => {
    const query = vi.fn(async (request: { query: string }) => ({
      json: async () =>
        request.query.includes('usage_reconciliation_coverage FINAL')
          ? [{ periodStart: '2025-01-01T00:00:00.000Z', periodEnd: '2025-02-01T00:00:00.000Z' }]
          : [{ meterKey: 'build', quantity: '4', eventCount: '4', lastReceivedAt: '2025-02-01T00:00:00.000Z' }],
    }));
    await expect(
      queryUsageMeterTotals('tenant-a', 'project-a', '2025-01-01T00:00:00Z', '2025-02-01T00:00:00Z', { query } as never, {
        now: new Date('2026-01-01T00:00:00Z'),
        rawRetentionDays: 180,
      }),
    ).resolves.toEqual([expect.objectContaining({ meterKey: 'build', quantity: '4' })]);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('preserves an exact aggregate wider than signed Int64', async () => {
    const query = vi.fn(async () => ({
      json: async () => [
        { meterKey: 'build', quantity: '9223372036854775808', eventCount: '2', lateEventCount: '0', lastReceivedAt: '2026-02-02T00:00:00Z' },
      ],
    }));
    await expect(
      queryUsageMeterTotals('tenant-a', 'project-a', '2026-02-01T00:00:00Z', '2026-03-01T00:00:00Z', { query } as never, {
        now: new Date('2026-03-02T00:00:00Z'),
      }),
    ).resolves.toEqual([expect.objectContaining({ meterKey: 'build', quantity: '9223372036854775808' })]);
  });

  it('rejects an aggregate outside Decimal(38,0) instead of wrapping or rounding it', async () => {
    const query = vi.fn(async () => ({
      json: async () => [
        {
          meterKey: 'build',
          quantity: '100000000000000000000000000000000000000',
          eventCount: '2',
          lateEventCount: '0',
          lastReceivedAt: '2026-02-02T00:00:00Z',
        },
      ],
    }));
    await expect(
      queryUsageMeterTotals('tenant-a', 'project-a', '2026-02-01T00:00:00Z', '2026-03-01T00:00:00Z', { query } as never, {
        now: new Date('2026-03-02T00:00:00Z'),
      }),
    ).rejects.toThrow(/Decimal\(38,0\)/u);
  });

  it('rejects an unknown meter key returned by ClickHouse', async () => {
    const query = vi.fn(async () => ({
      json: async () => [{ meterKey: 'future_meter', quantity: '1', eventCount: '1', lateEventCount: '0', lastReceivedAt: '2026-02-02T00:00:00Z' }],
    }));
    await expect(
      queryUsageMeterTotals('tenant-a', 'project-a', '2026-02-01T00:00:00Z', '2026-03-01T00:00:00Z', { query } as never, {
        now: new Date('2026-03-02T00:00:00Z'),
      }),
    ).rejects.toThrow();
  });

  it('publishes coverage only after rebuilt deduplicated counts match', async () => {
    const command = vi.fn(async () => undefined);
    const insert = vi.fn(async () => undefined);
    const query = vi.fn(async (request: { query: string }) => ({
      json: async () =>
        request.query.includes('uniqExact(event_id)') ? [{ eventCount: '2', receivedThrough: '2025-02-03T00:00:00.000Z' }] : [{ eventCount: '2' }],
    }));
    await reconcileUsageHourly('tenant-a', 'project-a', '2025-01-01T00:00:00.000Z', '2025-02-01T00:00:00.000Z', { command, insert, query } as never);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ table: 'usage_reconciliation_coverage', values: [expect.objectContaining({ event_count: '2' })] }),
    );
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ table: 'usage_reconciliation_state', values: [expect.objectContaining({ status: 'complete' })] }),
    );
  });
});
