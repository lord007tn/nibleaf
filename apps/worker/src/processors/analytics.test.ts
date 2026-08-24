import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  insertAnalyticsEvents: vi.fn(),
  insertUsageEvents: vi.fn(),
  listPendingUsagePeriods: vi.fn(),
  reconcileUsageHourly: vi.fn(),
  usageEventsFromAnalytics: vi.fn(),
  markUsageStoragePending: vi.fn(),
  markUsageStorageDrained: vi.fn(),
  projectFindUnique: vi.fn(),
  analyticsDeleteMany: vi.fn(),
  checkpointDeleteMany: vi.fn(),
  checkpointFindUnique: vi.fn(),
  checkpointFindMany: vi.fn(),
  createJob: vi.fn(),
  getJob: vi.fn(),
  markUsageStorageQueued: vi.fn(),
  markAnalyticsStoragePending: vi.fn(),
  runWithTenantAnalyticsWriteFence: vi.fn(),
}));

vi.mock('@nibleaf/bullmq', () => ({ createJob: mocks.createJob, getJob: mocks.getJob, QueueNames: { ANALYTICS: 'analytics' } }));
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
  markUsageStoragePending: mocks.markUsageStoragePending,
  markUsageStorageDrained: mocks.markUsageStorageDrained,
  markUsageStorageQueued: mocks.markUsageStorageQueued,
  markAnalyticsStoragePending: mocks.markAnalyticsStoragePending,
  runWithTenantAnalyticsWriteFence: mocks.runWithTenantAnalyticsWriteFence,
  prisma: {
    analyticsEvent: { deleteMany: mocks.analyticsDeleteMany },
    usageIngestCheckpoint: {
      deleteMany: mocks.checkpointDeleteMany,
      findMany: mocks.checkpointFindMany,
      findUnique: mocks.checkpointFindUnique,
    },
    project: { findUnique: mocks.projectFindUnique },
  },
}));

import { handleAnalyticsJobs } from './analytics';

const lateUsageEvent = {
  eventId: '891a044d-3a50-8c78-9230-947e5e306101',
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

const envelope = { eventId: 'event-a', tenantId: 'org-a', projectId: 'project-a' };

describe('durable usage ingestion and reconciliation worker path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insertAnalyticsEvents.mockResolvedValue(undefined);
    mocks.insertUsageEvents.mockResolvedValue(undefined);
    mocks.markUsageStoragePending.mockResolvedValue(undefined);
    mocks.markUsageStorageDrained.mockResolvedValue(undefined);
    mocks.markUsageStorageQueued.mockResolvedValue(undefined);
    mocks.markAnalyticsStoragePending.mockResolvedValue({ accepted: true });
    mocks.reconcileUsageHourly.mockResolvedValue(undefined);
    mocks.usageEventsFromAnalytics.mockReturnValue([lateUsageEvent]);
    mocks.projectFindUnique.mockResolvedValue({ organizationId: 'org-a' });
    mocks.analyticsDeleteMany.mockResolvedValue({ count: 3 });
    mocks.checkpointDeleteMany.mockResolvedValue({ count: 2 });
    mocks.checkpointFindMany.mockResolvedValue([]);
    mocks.checkpointFindUnique.mockResolvedValue({ events: [lateUsageEvent], organizationId: 'org-a', projectId: 'project-a', writtenAt: null });
    mocks.runWithTenantAnalyticsWriteFence.mockImplementation(
      async (_tenantId: string, _projectId: string, _checkpointId: string | null, action: () => Promise<unknown>) => ({
        accepted: true,
        value: await action(),
      }),
    );
  });

  it('marks a receipt pending, writes ClickHouse, reconciles late usage, then marks it drained', async () => {
    await handleAnalyticsJobs({ name: 'track-event', data: { kind: 'track-event', envelope }, id: 'event-job' } as never);
    expect(mocks.markUsageStoragePending).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'event-job', organizationId: 'org-a', projectId: 'project-a' }),
    );
    expect(mocks.markUsageStoragePending).toHaveBeenCalledBefore(mocks.insertUsageEvents);
    expect(mocks.markUsageStorageDrained).toHaveBeenCalledAfter(mocks.insertUsageEvents);
    expect(mocks.markUsageStorageDrained).toHaveBeenCalledWith('event-job', 'org-a');
    expect(mocks.reconcileUsageHourly).toHaveBeenCalledWith('org-a', 'project-a', '2025-01-01T00:00:00.000Z', '2025-02-01T00:00:00.000Z');
  });

  it('throws on ClickHouse outage so BullMQ retries the same idempotent facts and never drains early', async () => {
    mocks.insertUsageEvents.mockRejectedValueOnce(new Error('clickhouse unavailable'));
    const job = { name: 'ingest-usage', data: { kind: 'ingest-usage', checkpointId: 'usage-job-a' }, id: 'usage-job-a' } as never;
    await expect(handleAnalyticsJobs(job)).rejects.toThrow('clickhouse unavailable');
    expect(mocks.markUsageStorageDrained).not.toHaveBeenCalled();

    mocks.insertUsageEvents.mockResolvedValue(undefined);
    await expect(handleAnalyticsJobs(job)).resolves.toEqual({ inserted: 1 });
    expect(mocks.insertUsageEvents).toHaveBeenCalledTimes(2);
    expect(mocks.insertUsageEvents.mock.calls[0]?.[0]).toEqual(mocks.insertUsageEvents.mock.calls[1]?.[0]);
    expect(mocks.markUsageStorageDrained).toHaveBeenCalledWith('usage-job-a', 'org-a');
  });

  it('drops export lifecycle telemetry when concurrent tenant deletion wins the relational write fence', async () => {
    mocks.usageEventsFromAnalytics.mockReturnValue([]);
    mocks.runWithTenantAnalyticsWriteFence.mockResolvedValue({ accepted: false, value: null });
    const exportEnvelope = {
      ...envelope,
      payload: { name: 'export_completed', operationId: 'export-a', itemCount: 2 },
    };
    await expect(
      handleAnalyticsJobs({ name: 'track-event', data: { kind: 'track-event', envelope: exportEnvelope }, id: 'late-export-event' } as never),
    ).resolves.toEqual({ inserted: 0 });
    expect(mocks.insertAnalyticsEvents).not.toHaveBeenCalled();
    expect(mocks.insertUsageEvents).not.toHaveBeenCalled();
  });

  it('rebuilds every durable pending period from the scheduled job', async () => {
    mocks.listPendingUsagePeriods.mockResolvedValue([
      { tenantId: 'org-a', projectId: 'project-a', periodStart: '2025-01-01T00:00:00.000Z', periodEndExclusive: '2025-02-01T00:00:00.000Z' },
    ]);
    await expect(handleAnalyticsJobs({ name: 'reconcile-usage', data: {} } as never)).resolves.toEqual({ reconciled: 1 });
    expect(mocks.reconcileUsageHourly).toHaveBeenCalledTimes(1);
  });

  it('recovers an outbox receipt left by definite failure or timeout with the stable checkpoint job id', async () => {
    mocks.checkpointFindMany.mockResolvedValue([{ id: 'usage-job-a', organizationId: 'org-a' }]);
    mocks.getJob.mockResolvedValue(null);
    mocks.listPendingUsagePeriods.mockResolvedValue([]);
    await handleAnalyticsJobs({ name: 'reconcile-usage', data: {} } as never);
    expect(mocks.createJob).toHaveBeenCalledWith(
      'analytics',
      { name: 'ingest-usage', data: { kind: 'ingest-usage', checkpointId: 'usage-job-a' } },
      expect.objectContaining({ jobId: 'usage-job-a', attempts: 8 }),
    );
    expect(mocks.markUsageStorageQueued).toHaveBeenCalledWith('usage-job-a', 'org-a');
  });

  it('prunes only drained receipts in clickhouse-only mode and never deletes pending work', async () => {
    await expect(handleAnalyticsJobs({ name: 'rollup-analytics', data: {} } as never)).resolves.toEqual({ pruned: 0 });
    expect(mocks.analyticsDeleteMany).not.toHaveBeenCalled();
    expect(mocks.checkpointDeleteMany).toHaveBeenCalledWith({ where: { writtenAt: { not: null, lt: expect.any(Date) } } });
  });
});
