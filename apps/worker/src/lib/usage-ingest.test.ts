import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createJob: vi.fn(),
  markUsageStoragePending: vi.fn(),
  markUsageStorageQueued: vi.fn(),
}));

vi.mock('@nibleaf/bullmq', () => ({ createJob: mocks.createJob, QueueNames: { ANALYTICS: 'analytics' } }));
vi.mock('@nibleaf/clickhouse', () => ({ usageEventsFromAnalytics: vi.fn(() => []) }));
vi.mock('@nibleaf/database', () => ({
  markAnalyticsStoragePending: vi.fn(async () => ({ accepted: true })),
  markUsageStoragePending: mocks.markUsageStoragePending,
  markUsageStorageQueued: mocks.markUsageStorageQueued,
}));

import { DurableUsageEnqueueError, enqueueUsageEvents } from './usage-ingest';

const event = {
  eventId: 'a1c4718e-36d8-8858-8f87-f552178033f4',
  schemaVersion: 1 as const,
  occurredAt: '2026-08-24T00:00:00.000Z',
  receivedAt: '2026-08-24T00:00:01.000Z',
  tenantId: 'org-a',
  projectId: 'project-a',
  meterKey: 'embedded_chunk' as const,
  quantity: '1',
  kind: 'usage' as const,
  correctionOfEventId: null,
  source: 'worker' as const,
};

describe('worker durable usage enqueue boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.markUsageStoragePending.mockResolvedValue(undefined);
    mocks.markUsageStorageQueued.mockResolvedValue(undefined);
    mocks.createJob.mockResolvedValue({ id: 'job-a' });
  });

  it('classifies Redis failure after the outbox write as recoverable', async () => {
    mocks.createJob.mockRejectedValueOnce(new Error('redis unavailable'));
    const result = enqueueUsageEvents([event]);
    await expect(result).rejects.toMatchObject({ name: 'DurableUsageEnqueueError', outboxPersisted: true });
    await expect(result).rejects.toBeInstanceOf(DurableUsageEnqueueError);
    expect(mocks.markUsageStoragePending).toHaveBeenCalledBefore(mocks.createJob);
    expect(mocks.markUsageStorageQueued).not.toHaveBeenCalled();
  });

  it('leaves a PostgreSQL outbox failure fail-closed', async () => {
    mocks.markUsageStoragePending.mockRejectedValueOnce(new Error('postgres unavailable'));
    await expect(enqueueUsageEvents([event])).rejects.toThrow('postgres unavailable');
    expect(mocks.createJob).not.toHaveBeenCalled();
  });
});
