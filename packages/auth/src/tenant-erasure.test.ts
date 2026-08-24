import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createJob: vi.fn(),
  beginUsageDeletion: vi.fn(),
  deleteProjectAnalytics: vi.fn(),
  deleteProjectUsage: vi.fn(),
  projectFindUnique: vi.fn(),
  markerFindUnique: vi.fn(),
  checkpointUpdateMany: vi.fn(),
  organizationDelete: vi.fn(),
}));

vi.mock('@nibleaf/bullmq', () => ({ createJob: mocks.createJob, QueueNames: { SEARCH: 'search' } }));
vi.mock('@nibleaf/clickhouse', () => ({
  clickHouseWritesEnabled: () => true,
  keys: () => ({ ANALYTICS_MODE: 'clickhouse' }),
  deleteProjectAnalytics: mocks.deleteProjectAnalytics,
  deleteProjectUsage: mocks.deleteProjectUsage,
}));
vi.mock('@nibleaf/database', () => ({
  beginUsageDeletion: mocks.beginUsageDeletion,
  prisma: {
    project: { findUnique: mocks.projectFindUnique },
    usageStorageMarker: { findUnique: mocks.markerFindUnique },
    usageProviderCheckpoint: { updateMany: mocks.checkpointUpdateMany },
    organization: { delete: mocks.organizationDelete },
  },
}));

import { eraseProjectOrganization, TenantUsageDeletionPendingError } from './tenant-erasure';

describe('shared tenant privacy erasure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.projectFindUnique.mockResolvedValue({ id: 'project-a' });
    mocks.beginUsageDeletion.mockResolvedValue({ exists: true, hadStorageMarker: true, pendingCount: 0 });
    mocks.deleteProjectAnalytics.mockResolvedValue(undefined);
    mocks.deleteProjectUsage.mockResolvedValue(undefined);
    mocks.createJob.mockResolvedValue(undefined);
    mocks.checkpointUpdateMany.mockResolvedValue({ count: 0 });
    mocks.organizationDelete.mockResolvedValue({ id: 'org-a' });
  });

  it('fails closed before ClickHouse, search, or relational deletion while usage is pending', async () => {
    mocks.beginUsageDeletion.mockResolvedValue({ exists: true, hadStorageMarker: true, pendingCount: 1 });
    await expect(eraseProjectOrganization('org-a', 'project-a')).rejects.toBeInstanceOf(TenantUsageDeletionPendingError);
    expect(mocks.deleteProjectUsage).not.toHaveBeenCalled();
    expect(mocks.createJob).not.toHaveBeenCalled();
    expect(mocks.organizationDelete).not.toHaveBeenCalled();
  });

  it('tombstones retained facts, queues search erasure, then deletes relational scope', async () => {
    await eraseProjectOrganization('org-a', 'project-a');
    expect(mocks.deleteProjectUsage).toHaveBeenCalledWith('org-a', 'project-a');
    expect(mocks.createJob).toHaveBeenCalledWith(
      'search',
      { name: 'delete-project', data: { projectId: 'project-a' } },
      { jobId: 'search-delete-project-a' },
    );
    expect(mocks.deleteProjectUsage).toHaveBeenCalledBefore(mocks.createJob);
    expect(mocks.createJob).toHaveBeenCalledBefore(mocks.organizationDelete);
  });
});
