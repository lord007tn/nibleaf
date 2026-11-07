import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createJob: vi.fn(),
  projectFindFirst: vi.fn(),
  projectFindUnique: vi.fn(),
  pageFindMany: vi.fn(),
  deploymentAggregate: vi.fn(),
  deploymentCreate: vi.fn(),
  deploymentFindFirst: vi.fn(),
  deploymentUpdateMany: vi.fn(),
  platformEventCreate: vi.fn(),
}));

vi.mock('@nibleaf/bullmq', () => ({ createJob: mocks.createJob, QueueNames: { PUBLISH: 'publish' } }));
vi.mock('@nibleaf/database', () => ({
  Prisma: { PrismaClientKnownRequestError: class extends Error {} },
  prisma: {
    project: { findFirst: mocks.projectFindFirst, findUnique: mocks.projectFindUnique },
    page: { findMany: mocks.pageFindMany },
    deployment: {
      aggregate: mocks.deploymentAggregate,
      create: mocks.deploymentCreate,
      findFirst: mocks.deploymentFindFirst,
      updateMany: mocks.deploymentUpdateMany,
    },
    platformEvent: { create: mocks.platformEventCreate },
  },
}));

import { createDeployment, getCurrentSnapshot, rollbackDeployment } from './deployments';

const project = (redirects: Array<{ from: string; to: string }>) => ({
  id: 'project-1',
  organizationId: 'org-1',
  name: 'Docs',
  slug: 'docs',
  description: null,
  icon: null,
  config: { redirects },
  takedownAt: null,
  addons: [{ key: 'feedback', enabled: true, config: { placement: 'after-content', presentation: 'compact' } }],
  organization: {
    usagePlan: {
      status: 'active',
      effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt: null,
      plan: {
        key: 'pro',
        active: true,
        entitlements: [] as { capabilityKey: string; enabled: boolean; meter: { active: boolean } | null }[],
      },
    },
  },
  languages: [
    {
      id: 'language-1',
      code: 'en',
      label: 'English',
      direction: 'LTR',
      isDefault: true,
      enabled: true,
      position: 0,
      config: null,
      projectTranslations: [],
    },
  ],
  branches: [{ id: 'branch-1', name: 'main', isDefault: true, createdAt: new Date('2026-01-01') }],
});

const page = {
  id: 'page-1',
  projectId: 'project-1',
  languageId: 'language-1',
  branchId: 'branch-1',
  parentId: null,
  kind: 'PAGE',
  title: 'Current',
  slug: 'current',
  path: 'current',
  icon: null,
  description: null,
  content: '',
  config: null,
  translationKey: null,
  position: 0,
  hidden: false,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  language: { code: 'en' },
};

describe('createDeployment redirect preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createJob.mockResolvedValue(undefined);
    mocks.platformEventCreate.mockResolvedValue({});
    mocks.pageFindMany.mockResolvedValue([page]);
    mocks.deploymentAggregate.mockResolvedValue({ _max: { version: 2 } });
    mocks.deploymentCreate.mockResolvedValue({ id: 'deployment-3', projectId: 'project-1', version: 3, status: 'PENDING' });
  });

  it('fails atomically before version allocation or enqueue when a destination is unpublished', async () => {
    const value = project([{ from: '/old', to: '/deleted' }]);
    mocks.projectFindFirst.mockResolvedValue(value);
    mocks.projectFindUnique.mockResolvedValue(value);

    await expect(createDeployment('org-1', 'project-1', 'user-1', {})).rejects.toMatchObject({
      code: 'http:bad_request',
      details: { redirectIssues: [expect.objectContaining({ code: 'destination-not-found', sequence: ['/old', '/deleted'] })] },
    });
    expect(mocks.deploymentAggregate).not.toHaveBeenCalled();
    expect(mocks.deploymentCreate).not.toHaveBeenCalled();
    expect(mocks.createJob).not.toHaveBeenCalled();
  });

  it('accepts a valid chain and enqueues exactly one deployment for the scoped project', async () => {
    const value = project([
      { from: '/old', to: '/renamed' },
      { from: '/renamed', to: '/current' },
    ]);
    mocks.projectFindFirst.mockResolvedValue(value);
    mocks.projectFindUnique.mockResolvedValue(value);

    await expect(
      createDeployment('org-1', 'project-1', 'user-1', {
        message: 'Redirect cleanup',
        firstPublishAttribution: { entry_point: 'free_tool', intent: 'first_publish', source: 'rtl_readiness_grader' },
      }),
    ).resolves.toMatchObject({ id: 'deployment-3', version: 3 });
    expect(mocks.deploymentCreate).toHaveBeenCalledTimes(1);
    expect(mocks.createJob).toHaveBeenCalledWith(
      'publish',
      {
        name: 'publish-deployment',
        data: {
          deploymentId: 'deployment-3',
          projectId: 'project-1',
          skipGrammarChecks: false,
          auto: false,
          firstPublishAttribution: { entry_point: 'free_tool', intent: 'first_publish', source: 'rtl_readiness_grader' },
        },
      },
      { jobId: 'publish-deployment-3' },
    );
  });

  it('removes enabled add-ons from preflight delivery when the entitlement is disabled', async () => {
    const value = project([]);
    value.organization.usagePlan.plan.entitlements.push({ capabilityKey: 'addons.feedback', enabled: false, meter: null });
    mocks.projectFindUnique.mockResolvedValue(value);

    const snapshot = await getCurrentSnapshot('project-1');

    expect(snapshot.project.config).toMatchObject({ addons: { feedback: false } });
  });

  it('does not reveal or publish a project outside the caller organization', async () => {
    mocks.projectFindFirst.mockResolvedValue(null);

    await expect(createDeployment('other-org', 'project-1', 'user-1', {})).rejects.toMatchObject({ code: 'database:not_found' });
    expect(mocks.projectFindUnique).not.toHaveBeenCalled();
    expect(mocks.deploymentCreate).not.toHaveBeenCalled();
    expect(mocks.createJob).not.toHaveBeenCalled();
  });

  it('settles a queue rejection immediately and returns a plain retryable error', async () => {
    mocks.projectFindFirst.mockResolvedValue(project([]));
    mocks.projectFindUnique.mockResolvedValue(project([]));
    mocks.createJob.mockRejectedValueOnce(new Error('Redis connection refused: private connection details'));
    mocks.deploymentUpdateMany.mockResolvedValue({ count: 1 });
    await expect(createDeployment('org-1', 'project-1', 'user-1', {})).rejects.toMatchObject({
      code: 'http:internal',
      message: 'Publishing could not be queued. Please try publishing again.',
      details: { deploymentId: 'deployment-3' },
    });
    expect(mocks.deploymentUpdateMany).toHaveBeenCalledWith({
      where: { id: 'deployment-3', projectId: 'project-1', status: 'PENDING' },
      data: { status: 'FAILED', error: 'Publishing could not be queued. Please try publishing again.', completedAt: expect.any(Date) },
    });
  });

  it('queues a rollback with the exact historical snapshot for worker activation and indexing', async () => {
    mocks.projectFindFirst.mockResolvedValue(project([]));
    const snapshot = { project: { name: 'Historical docs' }, pages: [{ content: 'Historical content' }] };
    mocks.deploymentFindFirst.mockResolvedValue({ id: 'old', status: 'READY', version: 1, snapshot, pagesCount: 1 });
    await rollbackDeployment('org-1', 'project-1', 'old', 'user-1');
    expect(mocks.deploymentCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'PENDING', snapshot, pagesCount: 1 }) });
    expect(mocks.createJob).toHaveBeenCalledWith(
      'publish',
      {
        name: 'publish-deployment',
        data: { deploymentId: 'deployment-3', projectId: 'project-1', auto: false },
      },
      { jobId: 'publish-deployment-3' },
    );
  });

  it('keeps an accepted publish active when the queue loses its acknowledgement after the worker claim', async () => {
    mocks.projectFindFirst.mockResolvedValue(project([]));
    mocks.projectFindUnique.mockResolvedValue(project([]));
    mocks.createJob.mockRejectedValueOnce(new Error('ACK lost'));
    mocks.deploymentUpdateMany.mockResolvedValue({ count: 0 });
    mocks.deploymentFindFirst.mockResolvedValue({ id: 'deployment-3', projectId: 'project-1', status: 'BUILDING' });
    await expect(createDeployment('org-1', 'project-1', 'user-1', {})).resolves.toMatchObject({ status: 'BUILDING' });
  });

  it('settles a rollback enqueue failure without replacing the current live deployment', async () => {
    mocks.projectFindFirst.mockResolvedValue(project([]));
    mocks.deploymentFindFirst.mockResolvedValue({ status: 'READY', version: 1, snapshot: { pages: [] }, pagesCount: 0 });
    mocks.createJob.mockRejectedValueOnce(new Error('Redis unavailable'));
    mocks.deploymentUpdateMany.mockResolvedValue({ count: 1 });
    await expect(rollbackDeployment('org-1', 'project-1', 'old', 'user-1')).rejects.toMatchObject({ code: 'http:internal' });
    expect(mocks.deploymentCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'PENDING' }) });
    expect(mocks.deploymentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'deployment-3', projectId: 'project-1', status: 'PENDING' },
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
  });
});
