import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createJob: vi.fn(),
  markUsageStoragePending: vi.fn(),
  markUsageStorageQueued: vi.fn(),
  markAnalyticsStoragePending: vi.fn(),
  usageEventsFromAnalytics: vi.fn(),
}));

vi.mock('@nibleaf/bullmq', () => ({ createJob: mocks.createJob, QueueNames: { ANALYTICS: 'analytics' } }));
vi.mock('@nibleaf/clickhouse', () => ({
  keys: () => ({ ANALYTICS_MODE: 'clickhouse' }),
  clickHouseWritesEnabled: () => true,
  usageEventsFromAnalytics: mocks.usageEventsFromAnalytics,
}));
vi.mock('@nibleaf/database', () => ({
  markUsageStoragePending: mocks.markUsageStoragePending,
  markUsageStorageQueued: mocks.markUsageStorageQueued,
  markAnalyticsStoragePending: mocks.markAnalyticsStoragePending,
}));

import { enqueueAnalyticsEvent } from './usage-ingest';

const envelope = { eventId: 'event-a', tenantId: 'org-a', projectId: 'project-a' } as never;
const usageEvent = { eventId: 'usage-a', tenantId: 'org-a', projectId: 'project-a' };

describe('server durable usage enqueue boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.markUsageStoragePending.mockResolvedValue(undefined);
    mocks.markUsageStorageQueued.mockResolvedValue(undefined);
    mocks.markAnalyticsStoragePending.mockResolvedValue({ accepted: true });
    mocks.usageEventsFromAnalytics.mockReturnValue([usageEvent]);
  });

  afterEach(() => vi.useRealTimers());

  it('leaves a recoverable relational outbox receipt after a definite Redis failure', async () => {
    mocks.createJob.mockRejectedValue(new Error('redis unavailable'));
    await expect(enqueueAnalyticsEvent(envelope)).rejects.toThrow('redis unavailable');
    expect(mocks.markUsageStoragePending).toHaveBeenCalledOnce();
    expect(mocks.markUsageStoragePending).toHaveBeenCalledBefore(mocks.createJob);
    expect(mocks.markUsageStorageQueued).not.toHaveBeenCalled();
  });

  it('leaves the same recoverable receipt when enqueue timeout outcome is unknown', async () => {
    vi.useFakeTimers();
    mocks.createJob.mockReturnValue(new Promise(() => undefined));
    const result = expect(enqueueAnalyticsEvent(envelope, 25)).rejects.toThrow('enqueue timed out after 25ms');
    await vi.advanceTimersByTimeAsync(25);
    await result;
    expect(mocks.markUsageStoragePending).toHaveBeenCalledOnce();
    expect(mocks.markUsageStorageQueued).not.toHaveBeenCalled();
  });

  it('marks the checkpoint queued only after Redis acknowledges the stable job', async () => {
    mocks.createJob.mockResolvedValue({ id: 'job' });
    const first = await enqueueAnalyticsEvent(envelope);
    const second = await enqueueAnalyticsEvent(envelope);
    expect(first.jobId).toBe(second.jobId);
    expect(mocks.markUsageStorageQueued).toHaveBeenCalledTimes(2);
    expect(mocks.markUsageStorageQueued).toHaveBeenCalledAfter(mocks.createJob);
  });
});
