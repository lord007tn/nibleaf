import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  memberFindMany: vi.fn(),
  projectFindMany: vi.fn(),
  projectFindFirst: vi.fn(),
}));

vi.mock('@nibleaf/auth/tenant-erasure', () => ({
  eraseProjectOrganization: vi.fn(),
  TenantUsageDeletionPendingError: class extends Error {},
  TenantErasureProjectNotFoundError: class extends Error {},
}));
vi.mock('@nibleaf/database', () => ({
  assignDefaultUsagePlan: vi.fn(),
  prisma: {
    member: { findMany: mocks.memberFindMany },
    project: { findMany: mocks.projectFindMany, findFirst: mocks.projectFindFirst },
  },
}));

import { getProject, listProjects } from './projects';

/** The one definition of "pages" shared by the workspace overview, the sites
 *  list and the MCP project DTO: content pages on the default branch across
 *  every language — the same set the Site Overview counts client-side, so the
 *  numbers agree instead of one side also counting groups and other branches. */
const contentPages = { where: { kind: 'PAGE', branch: { isDefault: true } } };

describe('project page counts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists the sites a user can reach with a default-branch content-page count', async () => {
    mocks.memberFindMany.mockResolvedValue([{ organizationId: 'org-a' }, { organizationId: 'org-b' }]);
    mocks.projectFindMany.mockResolvedValue([{ id: 'project-a', _count: { pages: 58, deployments: 3 } }]);

    const projects = await listProjects('user-1');

    expect(mocks.projectFindMany).toHaveBeenCalledWith({
      where: { organizationId: { in: ['org-a', 'org-b'] } },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { pages: contentPages, deployments: true } } },
    });
    expect(projects[0]?._count).toEqual({ pages: 58, deployments: 3 });
  });

  it('reads a project with the same content-page count and keeps the _count shape', async () => {
    mocks.projectFindFirst.mockResolvedValue({
      id: 'project-a',
      _count: { pages: 58, deployments: 3, domains: 1 },
      languages: [
        { id: 'lang-en', code: 'en', projectTranslations: [{ name: 'Docs' }] },
        { id: 'lang-ar', code: 'ar', projectTranslations: [] },
      ],
    });

    const project = await getProject('org-a', 'project-a');

    expect(mocks.projectFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'project-a', organizationId: 'org-a' },
        include: expect.objectContaining({ _count: { select: { pages: contentPages, deployments: true, domains: true } } }),
      }),
    );
    expect(project._count).toEqual({ pages: 58, deployments: 3, domains: 1 });
    expect(project.languages.map((language) => language.translation)).toEqual([{ name: 'Docs' }, null]);
  });

  it('reports not-found for a project outside the organization', async () => {
    mocks.projectFindFirst.mockResolvedValue(null);

    await expect(getProject('org-a', 'missing')).rejects.toMatchObject({ code: 'database:not_found' });
  });
});
