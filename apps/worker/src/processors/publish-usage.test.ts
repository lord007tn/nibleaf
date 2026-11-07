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
    platformEventFindUnique: vi.fn(),
    deploymentFindFirst: vi.fn(),
    deploymentUpdate: vi.fn(),
    deploymentUpdateMany: vi.fn(),
    createJob: vi.fn(),
    getJob: vi.fn(),
    queryRaw: vi.fn(),
    projectFindUnique: vi.fn(),
    pageFindMany: vi.fn(),
    recordPublishReady: vi.fn(),
    notifyDeployment: vi.fn(),
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
    $queryRaw: mocks.queryRaw,
    platformEvent: { create: mocks.platformEventCreate, findUnique: mocks.platformEventFindUnique },
    deployment: { findFirst: mocks.deploymentFindFirst, update: mocks.deploymentUpdate, updateMany: mocks.deploymentUpdateMany },
    project: { findUnique: mocks.projectFindUnique },
    page: { findMany: mocks.pageFindMany },
  },
}));
vi.mock('@nibleaf/bullmq', () => ({ createJob: mocks.createJob, getJob: mocks.getJob, QueueNames: { SEARCH: 'search', PUBLISH: 'publish' } }));
vi.mock('../lib/publish-activation', () => ({ recordPublishReady: mocks.recordPublishReady }));
vi.mock('../env', () => ({ env: { APP_URL: 'https://nibleaf.test' } }));
vi.mock('../lib/notify', () => ({ notifyDeployment: mocks.notifyDeployment }));
vi.mock('../lib/usage-ingest', () => ({
  DurableUsageEnqueueError: mocks.DurableUsageEnqueueError,
  enqueueAnalyticsEvent: mocks.enqueueAnalyticsEvent,
}));

import { reapStaleDeployments } from '../reaper';
import { collectPublishIssues, handlePublishJobs, trackPublishLifecycle } from './publish';

describe('cross-language publish link checks', () => {
  const english = {
    id: 'en',
    title: 'Synthetic quickstart',
    kind: 'PAGE',
    path: 'guides/intro',
    content: '[Arabic guide](/group-9e4c82a8/intro?lang=ar)',
    languageCode: 'en',
    branchId: 'draft',
  };
  const arabic = {
    id: 'ar',
    title: 'دليل تجريبي',
    kind: 'PAGE',
    path: 'group-9e4c82a8/intro',
    content: '[English guide](/guides/intro?lang=en)',
    languageCode: 'ar',
    branchId: 'draft',
  };
  const pages = [english, arabic];

  it('accepts both translated destinations in the initial and updated snapshot', () => {
    expect(collectPublishIssues({ config: null }, pages)).toEqual([]);
    expect(
      collectPublishIssues(
        { config: null },
        pages.map((page) => ({ ...page, content: `${page.content}\n\nUpdated documentation.` })),
      ),
    ).toEqual([]);
  });

  it.each(['zz', 'AR', 'ar&lang=en', ''])('rejects an unknown or ambiguous target language %s', (language) => {
    const changed = [{ ...english, content: `[Target](/group-9e4c82a8/intro?lang=${language})` }, arabic];
    expect(collectPublishIssues({ config: null }, changed)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'broken-link', pagePath: 'guides/intro' })]),
    );
  });

  it('does not use a destination from another branch or a hidden page', () => {
    expect(collectPublishIssues({ config: null }, [english, { ...arabic, branchId: 'other' }])).not.toEqual([]);
    expect(collectPublishIssues({ config: null }, [english, { ...arabic, hidden: true }])).not.toEqual([]);
  });
});

describe('publish usage queue isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createJob.mockReset().mockResolvedValue(undefined);
    mocks.platformEventFindUnique.mockReset().mockResolvedValue(null);
    mocks.deploymentUpdateMany.mockResolvedValue({ count: 1 });
    mocks.pageFindMany.mockReset().mockRejectedValue(new Error('Unexpected read of the current draft'));
    mocks.buildAnalyticsEvent.mockReturnValue({ eventId: 'event-a', tenantId: 'org-a', projectId: 'project-a' });
    mocks.platformEventCreate.mockResolvedValue({ id: 'event-a' });
    mocks.enqueueAnalyticsEvent.mockResolvedValue(undefined);
    mocks.projectFindUnique.mockResolvedValue({
      id: 'project-a',
      name: 'QA project',
      organizationId: 'org-a',
      accessMode: 'PUBLIC',
      config: null,
      branches: [],
    });
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

  it('retries partial notification delivery after READY independently of activation receipt persistence', async () => {
    mocks.deploymentFindFirst.mockResolvedValue({ status: 'READY', pagesCount: 3, createdById: 'author-a', version: 2, completedAt: new Date() });
    mocks.notifyDeployment.mockRejectedValueOnce(new Error('notification delivery incomplete')).mockResolvedValueOnce(undefined);
    const job = { data: { deploymentId: 'deployment-a', projectId: 'project-a', auto: false } } as Job<PublishDeploymentJobData>;
    await expect(handlePublishJobs(job)).rejects.toThrow('notification delivery incomplete');
    await expect(handlePublishJobs(job)).resolves.toEqual({ pages: 3 });
    expect(mocks.notifyDeployment).toHaveBeenCalledTimes(2);
    expect(mocks.notifyDeployment).toHaveBeenLastCalledWith(expect.objectContaining({ deploymentId: 'deployment-a', outcome: 'ready' }));
    expect(mocks.deploymentUpdate).not.toHaveBeenCalled();
  });

  it('activates the stored rollback snapshot and indexes its new deployment ID', async () => {
    const historical = { project: { name: 'Old docs' }, pages: [{ content: 'Old content' }] };
    const pending = { status: 'PENDING', snapshot: historical, pagesCount: 1, version: 3, createdById: 'author-a' };
    mocks.deploymentFindFirst.mockResolvedValue(pending);
    mocks.deploymentUpdate.mockImplementation(async ({ data }) => ({ ...pending, ...data }));
    const job = { data: { deploymentId: 'rollback-a', projectId: 'project-a', auto: false } } as Job<PublishDeploymentJobData>;
    await expect(handlePublishJobs(job)).resolves.toEqual({ pages: 1 });
    expect(mocks.deploymentUpdate).toHaveBeenCalledWith({
      where: { id: 'rollback-a', projectId: 'project-a' },
      data: expect.objectContaining({ status: 'READY' }),
    });
    expect(mocks.createJob).toHaveBeenCalledWith(
      'search',
      {
        name: 'index-deployment',
        data: { projectId: 'project-a', deploymentId: 'rollback-a' },
      },
      { jobId: 'search-rollback-a' },
    );
    expect(mocks.pageFindMany).not.toHaveBeenCalled();
    expect(mocks.deploymentUpdate.mock.calls[0]?.[0].data).not.toHaveProperty('snapshot');
  });

  it('retries indexing delivery after READY without revoking or rebuilding the snapshot', async () => {
    mocks.deploymentFindFirst.mockResolvedValue({ status: 'READY', pagesCount: 1, version: 3, createdById: 'author-a' });
    mocks.createJob.mockRejectedValueOnce(new Error('search queue unavailable'));
    const job = { data: { deploymentId: 'rollback-a', projectId: 'project-a', auto: false } } as Job<PublishDeploymentJobData>;
    await expect(handlePublishJobs(job)).rejects.toThrow('search queue unavailable');
    await expect(handlePublishJobs(job)).resolves.toEqual({ pages: 1 });
    expect(mocks.deploymentUpdate).not.toHaveBeenCalled();
  });

  it('does not activate a job whose enqueue failure was already settled by the API', async () => {
    mocks.deploymentFindFirst.mockResolvedValue({ status: 'FAILED', completedAt: new Date(), pagesCount: 0 });
    mocks.deploymentUpdateMany.mockResolvedValue({ count: 0 });
    const job = { data: { deploymentId: 'deployment-a', projectId: 'project-a' } } as Job<PublishDeploymentJobData>;
    await expect(handlePublishJobs(job)).resolves.toEqual({ pages: 0 });
    expect(mocks.deploymentUpdate).not.toHaveBeenCalled();
    expect(mocks.recordPublishReady).not.toHaveBeenCalled();
  });

  it('clears the previous failure message when a normal publish retry succeeds', async () => {
    const failed = { status: 'FAILED', snapshot: null, pagesCount: 0, version: 2, createdById: 'author-a', error: 'Temporary connection failure' };
    mocks.deploymentFindFirst.mockResolvedValue(failed);
    mocks.deploymentUpdate.mockImplementation(async ({ data }) => ({ ...failed, ...data }));
    mocks.projectFindUnique.mockResolvedValue({
      id: 'project-a',
      name: 'Synthetic docs',
      slug: 'synthetic',
      description: null,
      icon: null,
      organizationId: 'org-a',
      accessMode: 'PUBLIC',
      config: null,
      organization: { usagePlan: null },
      addons: [],
      languages: [{ code: 'en', label: 'English', direction: 'LTR', isDefault: true }],
      branches: [{ id: 'main', name: 'main', isDefault: true, createdAt: new Date() }],
    });
    mocks.pageFindMany.mockResolvedValue([]);
    const job = { data: { deploymentId: 'deployment-a', projectId: 'project-a' } } as Job<PublishDeploymentJobData>;
    await expect(handlePublishJobs(job)).resolves.toEqual({ pages: 0 });
    expect(mocks.deploymentUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'READY', error: null }) }));
  });

  it('recovers missing indexing and activation delivery after both publish attempts are exhausted', async () => {
    const data = { deploymentId: 'rollback-a', projectId: 'project-a', auto: false, locale: 'ar' };
    const ready = {
      id: 'rollback-a',
      status: 'READY',
      pagesCount: 1,
      version: 3,
      createdById: 'author-a',
      completedAt: new Date(Date.now() - 120_000),
    };
    mocks.deploymentFindFirst.mockResolvedValue(ready);
    mocks.createJob.mockRejectedValueOnce(new Error('search queue unavailable')).mockRejectedValueOnce(new Error('search queue still unavailable'));
    const job = { data } as Job<PublishDeploymentJobData>;
    await expect(handlePublishJobs(job)).rejects.toThrow('search queue unavailable');
    await expect(handlePublishJobs(job)).rejects.toThrow('search queue still unavailable');
    expect(mocks.recordPublishReady).not.toHaveBeenCalled();

    let hasReceipt = false;
    mocks.queryRaw.mockImplementation(async () => (hasReceipt ? [] : [{ id: 'rollback-a', projectId: 'project-a' }]));
    mocks.deploymentUpdateMany.mockResolvedValue({ count: 0 });
    mocks.getJob.mockResolvedValue({ data });
    mocks.recordPublishReady.mockImplementation(async () => {
      hasReceipt = true;
    });
    await reapStaleDeployments();
    expect(mocks.createJob).toHaveBeenLastCalledWith(
      'publish',
      { name: 'publish-deployment', data },
      {
        jobId: expect.stringMatching(/^publish-recovery-rollback-a-\d+$/),
      },
    );
    const recovered = { ...job, id: 'publish-recovery-rollback-a-1' } as Job<PublishDeploymentJobData>;
    mocks.platformEventFindUnique.mockImplementation(async () => (hasReceipt ? { id: 'publish-ready:rollback-a' } : null));
    await expect(handlePublishJobs(recovered)).resolves.toEqual({ pages: 1 });
    expect(mocks.createJob).toHaveBeenLastCalledWith(
      'search',
      { name: 'index-deployment', data: { projectId: 'project-a', deploymentId: 'rollback-a' } },
      { jobId: 'search-rollback-a' },
    );
    expect(mocks.recordPublishReady).toHaveBeenCalledWith(data, ready);
    expect(mocks.deploymentUpdate).not.toHaveBeenCalled();
    await handlePublishJobs(recovered);
    expect(mocks.notifyDeployment).toHaveBeenCalledOnce();
    const delivered = mocks.createJob.mock.calls.length;
    await reapStaleDeployments();
    expect(mocks.createJob).toHaveBeenCalledTimes(delivered);
  });
  it('ignores an already queued recovery for a historical READY row without a receipt', async () => {
    mocks.deploymentFindFirst.mockResolvedValue({ status: 'READY', pagesCount: 1, completedAt: new Date(Date.now() - 2 * 86_400_000) });
    const job = { id: 'publish-recovery-old-1', data: { deploymentId: 'old', projectId: 'project-a' } } as Job<PublishDeploymentJobData>;
    await handlePublishJobs(job);
    expect(mocks.createJob).not.toHaveBeenCalled();
    expect(mocks.buildAnalyticsEvent).not.toHaveBeenCalled();
    expect(mocks.recordPublishReady).not.toHaveBeenCalled();
    expect(mocks.notifyDeployment).not.toHaveBeenCalled();
  });

  it.each([
    [0, null],
    [1, expect.any(Date)],
  ] as const)('settles attempt %s with the correct terminal completion marker', async (attemptsMade, completedAt) => {
    mocks.deploymentFindFirst.mockResolvedValue({ status: 'PENDING', snapshot: null });
    mocks.pageFindMany.mockRejectedValue(new Error('temporary build failure'));
    const job = {
      attemptsMade,
      opts: { attempts: 2 },
      data: { deploymentId: 'deployment-a', projectId: 'project-a' },
    } as Job<PublishDeploymentJobData>;
    await expect(handlePublishJobs(job)).rejects.toThrow();
    expect(mocks.deploymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', completedAt }) }),
    );
    expect(mocks.notifyDeployment).toHaveBeenCalledTimes(attemptsMade === 0 ? 0 : 1);
  });
});
