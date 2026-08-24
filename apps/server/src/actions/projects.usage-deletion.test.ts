import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class PendingError extends Error {}
  class NotFoundError extends Error {}
  return { eraseProjectOrganization: vi.fn(), projectFindFirst: vi.fn(), PendingError, NotFoundError };
});

vi.mock('@nibleaf/auth/tenant-erasure', () => ({
  eraseProjectOrganization: mocks.eraseProjectOrganization,
  TenantUsageDeletionPendingError: mocks.PendingError,
  TenantErasureProjectNotFoundError: mocks.NotFoundError,
}));
vi.mock('@nibleaf/database', () => ({
  assignDefaultUsagePlan: vi.fn(),
  prisma: { project: { findFirst: mocks.projectFindFirst } },
}));

import { deleteProject } from './projects';

describe('project usage privacy erasure action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.projectFindFirst.mockResolvedValue({ id: 'project-a', organizationId: 'org-a' });
    mocks.eraseProjectOrganization.mockResolvedValue(undefined);
  });

  it('delegates all retained-store cleanup to the shared fail-closed workflow', async () => {
    await expect(deleteProject('org-a', 'project-a')).resolves.toEqual({ id: 'project-a' });
    expect(mocks.eraseProjectOrganization).toHaveBeenCalledWith('org-a', 'project-a');
  });

  it('returns a stable retryable conflict while usage ingestion is pending', async () => {
    mocks.eraseProjectOrganization.mockRejectedValue(new mocks.PendingError());
    await expect(deleteProject('org-a', 'project-a')).rejects.toMatchObject({
      code: 'database:conflict',
      details: { reason: 'usage_ingestion_pending' },
    });
  });
});
