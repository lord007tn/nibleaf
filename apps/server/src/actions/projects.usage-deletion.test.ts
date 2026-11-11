import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class PendingError extends Error {}
  class NotFoundError extends Error {}
  return { eraseProject: vi.fn(), projectFindFirst: vi.fn(), resolveOrgAccess: vi.fn(), PendingError, NotFoundError };
});

vi.mock('@/lib/access', () => ({ accessibleProjectIds: vi.fn(), accessibleProjectRoles: vi.fn(), resolveOrgAccess: mocks.resolveOrgAccess }));
vi.mock('./admissions', () => ({ lockOrganization: vi.fn() }));
vi.mock('@nibleaf/auth/tenant-erasure', () => ({
  eraseProject: mocks.eraseProject,
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
    mocks.eraseProject.mockResolvedValue(undefined);
    mocks.resolveOrgAccess.mockResolvedValue({ organizationId: 'org-a', orgRole: 'admin' });
  });

  it('erases only the website, so the organization remains', async () => {
    await expect(deleteProject('user-1', 'org-a', 'project-a')).resolves.toEqual({ id: 'project-a' });
    expect(mocks.resolveOrgAccess).toHaveBeenCalledWith('user-1', 'org-a');
    expect(mocks.eraseProject).toHaveBeenCalledWith('project-a');
  });

  it('refuses a site Admin who is only an organization Member', async () => {
    mocks.resolveOrgAccess.mockResolvedValue({ organizationId: 'org-a', orgRole: 'member' });
    await expect(deleteProject('user-1', 'org-a', 'project-a')).rejects.toMatchObject({ code: 'auth:insufficient_role' });
    expect(mocks.eraseProject).not.toHaveBeenCalled();
  });

  it('returns a stable retryable conflict while usage ingestion is pending', async () => {
    mocks.eraseProject.mockRejectedValue(new mocks.PendingError());
    await expect(deleteProject('user-1', 'org-a', 'project-a')).rejects.toMatchObject({
      code: 'database:conflict',
      details: { reason: 'usage_ingestion_pending' },
    });
  });
});
