import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createJob: vi.fn(),
  projectFindFirst: vi.fn(),
  projectFindUnique: vi.fn(),
  pageFindMany: vi.fn(),
  deploymentAggregate: vi.fn(),
  deploymentCreate: vi.fn(),
  platformEventCreate: vi.fn(),
}));

vi.mock('@nibleaf/bullmq', () => ({ createJob: mocks.createJob, QueueNames: { PUBLISH: 'publish' } }));
vi.mock('@nibleaf/database', () => ({
  Prisma: { PrismaClientKnownRequestError: class extends Error {} },
  prisma: {
    project: { findFirst: mocks.projectFindFirst, findUnique: mocks.projectFindUnique },
    page: { findMany: mocks.pageFindMany },
    deployment: { aggregate: mocks.deploymentAggregate, create: mocks.deploymentCreate },
    platformEvent: { create: mocks.platformEventCreate },
  },
}));

import { createDeployment } from './deployments';

const project = (redirects: Array<{ from: string; to: string }>) => ({
  id: 'project-1',
  organizationId: 'org-1',
  name: 'Docs',
  slug: 'docs',
  description: null,
  icon: null,
  config: { redirects },
  takedownAt: null,
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

    await expect(createDeployment('org-1', 'project-1', 'user-1', { message: 'Redirect cleanup' })).resolves.toMatchObject({
      id: 'deployment-3',
      version: 3,
    });
    expect(mocks.deploymentCreate).toHaveBeenCalledTimes(1);
    expect(mocks.createJob).toHaveBeenCalledWith('publish', {
      name: 'publish-deployment',
      data: { deploymentId: 'deployment-3', projectId: 'project-1', skipGrammarChecks: false, auto: false },
    });
  });

  it('does not reveal or publish a project outside the caller organization', async () => {
    mocks.projectFindFirst.mockResolvedValue(null);

    await expect(createDeployment('other-org', 'project-1', 'user-1', {})).rejects.toMatchObject({ code: 'database:not_found' });
    expect(mocks.projectFindUnique).not.toHaveBeenCalled();
    expect(mocks.deploymentCreate).not.toHaveBeenCalled();
    expect(mocks.createJob).not.toHaveBeenCalled();
  });
});
