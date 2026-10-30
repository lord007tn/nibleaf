import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createJob: vi.fn(),
  getJob: vi.fn(),
  removeJob: vi.fn(),
  beginUsageDeletion: vi.fn(),
  deleteProjectAnalytics: vi.fn(),
  deleteProjectUsage: vi.fn(),
  projectFindUnique: vi.fn(),
  markerFindUnique: vi.fn(),
  checkpointUpdateMany: vi.fn(),
  organizationDelete: vi.fn(),
}));

vi.mock('@nibleaf/bullmq', () => ({
  createJob: mocks.createJob,
  getJob: mocks.getJob,
  removeJob: mocks.removeJob,
  QueueNames: { ERASURE: 'erasure', SEARCH: 'search' },
}));
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
    mocks.getJob.mockResolvedValue(undefined);
    mocks.removeJob.mockResolvedValue(true);
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

  it('tombstones retained facts, queues search and storage erasure, then deletes relational scope', async () => {
    await eraseProjectOrganization('org-a', 'project-a');
    expect(mocks.deleteProjectUsage).toHaveBeenCalledWith('org-a', 'project-a');
    expect(mocks.createJob).toHaveBeenCalledTimes(2);
    expect(mocks.createJob).toHaveBeenCalledWith(
      'search',
      { name: 'delete-project', data: { projectId: 'project-a' } },
      { jobId: 'search-delete-project-a' },
    );
    expect(mocks.createJob).toHaveBeenCalledWith(
      'erasure',
      { name: 'erase-project-storage', data: { projectId: 'project-a' } },
      { jobId: 'erase-storage-project-a', delay: 60_000 },
    );
    expect(mocks.deleteProjectUsage).toHaveBeenCalledBefore(mocks.createJob);
    expect(Math.max(...mocks.createJob.mock.invocationCallOrder)).toBeLessThan(mocks.organizationDelete.mock.invocationCallOrder[0] ?? 0);
  });

  it('never deletes the relational scope when storage erasure cannot be queued', async () => {
    mocks.createJob.mockRejectedValueOnce(new Error('queue unavailable'));
    await expect(eraseProjectOrganization('org-a', 'project-a')).rejects.toThrow('queue unavailable');
    expect(mocks.organizationDelete).not.toHaveBeenCalled();
  });

  it('replaces only a failed storage erasure job when deletion is retried', async () => {
    mocks.getJob.mockResolvedValue({ isFailed: async () => true });
    await eraseProjectOrganization('org-a', 'project-a');
    expect(mocks.getJob).toHaveBeenCalledExactlyOnceWith('erasure', 'erase-storage-project-a');
    expect(mocks.removeJob).toHaveBeenCalledExactlyOnceWith('erasure', 'erase-storage-project-a');
    expect(mocks.removeJob).toHaveBeenCalledBefore(mocks.createJob);
  });

  it('leaves a waiting, delayed, or active storage erasure job alone', async () => {
    mocks.getJob.mockResolvedValue({ isFailed: async () => false });
    await eraseProjectOrganization('org-a', 'project-a');
    expect(mocks.removeJob).not.toHaveBeenCalled();
    expect(mocks.createJob).toHaveBeenCalledWith(
      'erasure',
      expect.objectContaining({ name: 'erase-project-storage' }),
      expect.objectContaining({ jobId: 'erase-storage-project-a' }),
    );
  });
});
