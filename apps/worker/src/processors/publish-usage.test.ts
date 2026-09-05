import type { PublishDeploymentJobData } from '@nibleaf/bullmq/jobs/publish';
import type { Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class DurableUsageEnqueueError extends Error {
    constructor(readonly outboxPersisted: boolean) {
      super('queue unavailable');
    }
  }
  return {
    buildAnalyticsEvent: vi.fn(),
    enqueueAnalyticsEvent: vi.fn(),
    platformEventCreate: vi.fn(),
    deploymentFindFirst: vi.fn(),
    deploymentUpdate: vi.fn(),
    projectFindUnique: vi.fn(),
    recordPublishReady: vi.fn(),
    DurableUsageEnqueueError,
  };
});

vi.mock('@nibleaf/clickhouse', () => ({
  keys: () => ({ ANALYTICS_MODE: 'clickhouse', ANALYTICS_HASH_SALT: 'salt' }),
  clickHouseWritesEnabled: () => true,
  deterministicAnalyticsEventId: () => 'event-a',
  buildAnalyticsEvent: mocks.buildAnalyticsEvent,
}));
vi.mock('@nibleaf/database', () => ({
  Prisma: { DbNull: null },
  prisma: {
    platformEvent: { create: mocks.platformEventCreate },
    deployment: { findFirst: mocks.deploymentFindFirst, update: mocks.deploymentUpdate },
    project: { findUnique: mocks.projectFindUnique },
  },
}));
vi.mock('@nibleaf/bullmq', () => ({ createJob: vi.fn(async () => undefined), QueueNames: { SEARCH: 'search' } }));
vi.mock('../lib/publish-activation', () => ({ recordPublishReady: mocks.recordPublishReady }));
vi.mock('../env', () => ({ env: { APP_URL: 'https://nibleaf.test' } }));
vi.mock('../lib/notify', () => ({ notifyDeployment: vi.fn() }));
vi.mock('../lib/usage-ingest', () => ({
  DurableUsageEnqueueError: mocks.DurableUsageEnqueueError,
  enqueueAnalyticsEvent: mocks.enqueueAnalyticsEvent,
}));

import { handlePublishJobs, trackPublishLifecycle } from './publish';

describe('publish usage queue isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildAnalyticsEvent.mockReturnValue({ eventId: 'event-a', tenantId: 'org-a', projectId: 'project-a' });
    mocks.platformEventCreate.mockResolvedValue({ id: 'event-a' });
    mocks.enqueueAnalyticsEvent.mockResolvedValue(undefined);
    mocks.projectFindUnique.mockResolvedValue({ id: 'project-a', name: 'QA project', organizationId: 'org-a', accessMode: 'PUBLIC', config: null });
  });

  it('keeps publishing non-blocking after the usage outbox is durable and Redis rejects enqueue', async () => {
    mocks.enqueueAnalyticsEvent.mockRejectedValue(new mocks.DurableUsageEnqueueError(true));
    await expect(
      trackPublishLifecycle(
        { id: 'project-a', organizationId: 'org-a', accessMode: 'PUBLIC', config: null },
        'deployment-a',
        { name: 'publish_completed', operationId: 'deployment-a', itemCount: 2 },
        '2026-08-24T00:00:00.000Z',
      ),
    ).resolves.toBeUndefined();
    expect(mocks.buildAnalyticsEvent).toHaveBeenCalledWith(expect.objectContaining({ occurredAt: '2026-08-24T00:00:00.000Z' }), expect.any(Object));
  });

  it('still fails closed when the relational outbox itself was not persisted', async () => {
    mocks.enqueueAnalyticsEvent.mockRejectedValue(new Error('postgres unavailable'));
    await expect(
      trackPublishLifecycle(
        { id: 'project-a', organizationId: 'org-a', accessMode: 'PUBLIC', config: null },
        'deployment-a',
        { name: 'publish_completed', operationId: 'deployment-a', itemCount: 2 },
        '2026-08-24T00:00:00.000Z',
      ),
    ).rejects.toThrow('postgres unavailable');
  });

  it('rejects a mismatched deployment/project before mutation or receipt creation', async () => {
    mocks.deploymentFindFirst.mockResolvedValue(null);
    const job = { data: { deploymentId: 'deployment-a', projectId: 'other-project', auto: false } } as Job<PublishDeploymentJobData>;
    await expect(handlePublishJobs(job)).rejects.toThrow('Deployment does not belong');
    expect(mocks.deploymentFindFirst).toHaveBeenCalledWith({ where: { id: 'deployment-a', projectId: 'other-project' } });
    expect(mocks.deploymentUpdate).not.toHaveBeenCalled();
    expect(mocks.recordPublishReady).not.toHaveBeenCalled();
  });

  it('repairs a READY receipt on retry without rebuilding the immutable snapshot', async () => {
    const ready = { status: 'READY', pagesCount: 3, createdById: 'author-a', version: 2, completedAt: new Date() };
    mocks.deploymentFindFirst.mockResolvedValue(ready);
    const job = { data: { deploymentId: 'deployment-a', projectId: 'project-a', auto: false } } as Job<PublishDeploymentJobData>;
    await expect(handlePublishJobs(job)).resolves.toEqual({ pages: 3 });
    expect(mocks.recordPublishReady).toHaveBeenCalledWith(job.data, ready);
    expect(mocks.deploymentUpdate).not.toHaveBeenCalled();
  });
});
