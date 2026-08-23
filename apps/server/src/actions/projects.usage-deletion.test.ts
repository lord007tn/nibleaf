import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createJob: vi.fn(),
  deleteProjectAnalytics: vi.fn(),
  deleteProjectUsage: vi.fn(),
  projectFindUnique: vi.fn(),
  markerFindUnique: vi.fn(),
  checkpointUpdateMany: vi.fn(),
  organizationDelete: vi.fn(),
}));

vi.mock('@nibleaf/bullmq', () => ({ createJob: mocks.createJob, QueueNames: { SEARCH: 'search' } }));
vi.mock('@nibleaf/clickhouse', () => ({
  clickHouseWritesEnabled: (mode: string) => mode !== 'disabled',
  keys: () => ({ ANALYTICS_MODE: 'disabled' }),
  deleteProjectAnalytics: mocks.deleteProjectAnalytics,
  deleteProjectUsage: mocks.deleteProjectUsage,
}));
vi.mock('@nibleaf/database', () => ({
  prisma: {
    project: { findFirst: mocks.projectFindUnique },
    usageStorageMarker: { findUnique: mocks.markerFindUnique },
    usageProviderCheckpoint: { updateMany: mocks.checkpointUpdateMany },
    organization: { delete: mocks.organizationDelete },
  },
}));

import { deleteProject } from './projects';

describe('project usage privacy erasure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.projectFindUnique.mockResolvedValue({ id: 'project-a', organizationId: 'org-a' });
    mocks.createJob.mockResolvedValue(undefined);
    mocks.deleteProjectAnalytics.mockResolvedValue(undefined);
    mocks.deleteProjectUsage.mockResolvedValue(undefined);
    mocks.checkpointUpdateMany.mockResolvedValue({ count: 0 });
    mocks.organizationDelete.mockResolvedValue({ id: 'org-a' });
  });

  it('erases ClickHouse facts after mode rollback when an ever-written marker exists', async () => {
    mocks.markerFindUnique.mockResolvedValue({ organizationId: 'org-a' });
    await deleteProject('org-a', 'project-a');
    expect(mocks.deleteProjectAnalytics).toHaveBeenCalledWith('org-a', 'project-a');
    expect(mocks.deleteProjectUsage).toHaveBeenCalledWith('org-a', 'project-a');
    expect(mocks.organizationDelete).toHaveBeenCalledAfter(mocks.deleteProjectUsage);
  });

  it('skips ClickHouse only when disabled mode has no ever-written marker', async () => {
    mocks.markerFindUnique.mockResolvedValue(null);
    await deleteProject('org-a', 'project-a');
    expect(mocks.deleteProjectUsage).not.toHaveBeenCalled();
  });
});
