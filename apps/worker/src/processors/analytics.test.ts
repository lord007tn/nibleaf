import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  insertAnalyticsEvents: vi.fn(),
  insertUsageEvents: vi.fn(),
  listPendingUsagePeriods: vi.fn(),
  reconcileUsageHourly: vi.fn(),
  usageEventsFromAnalytics: vi.fn(),
  markUsageStorageWritten: vi.fn(),
}));

vi.mock('@nibleaf/clickhouse', () => ({
  keys: () => ({ ANALYTICS_MODE: 'clickhouse', ANALYTICS_HASH_SALT: 'salt' }),
  clickHouseWritesEnabled: () => true,
  relationalWritesEnabled: () => false,
  insertAnalyticsEvents: mocks.insertAnalyticsEvents,
  insertUsageEvents: mocks.insertUsageEvents,
  listPendingUsagePeriods: mocks.listPendingUsagePeriods,
  reconcileUsageHourly: mocks.reconcileUsageHourly,
  usageEventsFromAnalytics: mocks.usageEventsFromAnalytics,
}));
vi.mock('@nibleaf/database', () => ({
  markUsageStorageWritten: mocks.markUsageStorageWritten,
  prisma: { analyticsEvent: { deleteMany: vi.fn() }, project: { findUnique: vi.fn() } },
}));

import { handleAnalyticsJobs } from './analytics';

const lateUsageEvent = {
  eventId: '891a044d-3a50-5c78-9230-947e5e306101',
  schemaVersion: 1 as const,
  occurredAt: '2025-01-15T00:00:00.000Z',
  receivedAt: '2026-08-23T00:00:00.000Z',
  tenantId: 'org-a',
  projectId: 'project-a',
  meterKey: 'search_query' as const,
  quantity: '1',
  kind: 'usage' as const,
  correctionOfEventId: null,
  source: 'worker' as const,
};

describe('usage reconciliation worker path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insertAnalyticsEvents.mockResolvedValue(undefined);
    mocks.insertUsageEvents.mockResolvedValue(undefined);
    mocks.markUsageStorageWritten.mockResolvedValue(undefined);
    mocks.reconcileUsageHourly.mockResolvedValue(undefined);
    mocks.usageEventsFromAnalytics.mockReturnValue([lateUsageEvent]);
  });

  it('durably marks storage then immediately reconciles a late event month', async () => {
    await handleAnalyticsJobs({
      name: 'track-event',
      data: { kind: 'track-event', envelope: { tenantId: 'org-a' } },
      id: 'event-job',
    } as never);
    expect(mocks.markUsageStorageWritten).toHaveBeenCalledWith('org-a');
    expect(mocks.markUsageStorageWritten).toHaveBeenCalledBefore(mocks.insertUsageEvents);
    expect(mocks.reconcileUsageHourly).toHaveBeenCalledWith('org-a', 'project-a', '2025-01-01T00:00:00.000Z', '2025-02-01T00:00:00.000Z');
  });

  it('rebuilds every durable pending period from the scheduled job', async () => {
    mocks.listPendingUsagePeriods.mockResolvedValue([
      { tenantId: 'org-a', projectId: 'project-a', periodStart: '2025-01-01T00:00:00.000Z', periodEndExclusive: '2025-02-01T00:00:00.000Z' },
    ]);
    await expect(handleAnalyticsJobs({ name: 'reconcile-usage', data: {} } as never)).resolves.toEqual({ reconciled: 1 });
    expect(mocks.reconcileUsageHourly).toHaveBeenCalledTimes(1);
  });
});
