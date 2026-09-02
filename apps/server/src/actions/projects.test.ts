import { resolveTheme, THEME_PRESETS } from '@nibleaf/shared/themes';
import { type CreateProjectBody, projectConfigSchema } from '@nibleaf/validators';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  memberFindMany: vi.fn(),
  projectFindMany: vi.fn(),
  projectFindFirst: vi.fn(),
  tx: {
    organization: { create: vi.fn() },
    member: { create: vi.fn() },
    project: { create: vi.fn() },
    projectAddon: { createMany: vi.fn() },
    projectAddonAuditEvent: { createMany: vi.fn() },
    language: { create: vi.fn() },
    branch: { create: vi.fn() },
  },
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
    $transaction: (run: (tx: typeof mocks.tx) => Promise<unknown>) => run(mocks.tx),
  },
}));

import { createProject, getProject, listProjects } from './projects';

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

/** The config handed to `tx.project.create` by the last createProject call. */
const createdConfig = () => (mocks.tx.project.create.mock.calls[0] as [{ data: { config: Record<string, unknown> } }])[0].data.config;

describe('createProject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.projectFindFirst.mockResolvedValue(null);
    mocks.tx.organization.create.mockResolvedValue({ id: 'org-new' });
    mocks.tx.project.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'project-new', ...data }));
  });

  it('seeds the curated Harbor preset so a new site never renders the legacy palette', async () => {
    await createProject('user-1', { name: 'Acme Docs' } as CreateProjectBody);

    const config = createdConfig();
    expect(config.theme).toEqual({ version: 1, preset: 'harbor', metadata: THEME_PRESETS.harbor.metadata });
    // A stored theme object is what opts the reader into the theme resolver.
    expect(resolveTheme(config).id).toBe('harbor');
    expect(projectConfigSchema.safeParse(config).success).toBe(true);
  });

  it('keeps add-on provisioning intact next to the seeded theme', async () => {
    await createProject('user-1', { name: 'Acme Docs' } as CreateProjectBody);

    const config = createdConfig();
    expect(config.addons).toMatchObject({ feedback: expect.any(Boolean) });
    expect(mocks.tx.projectAddon.createMany).toHaveBeenCalledTimes(1);
    expect(mocks.tx.projectAddonAuditEvent.createMany).toHaveBeenCalledTimes(1);
    expect(mocks.tx.language.create).toHaveBeenCalledWith({
      data: { projectId: 'project-new', code: 'en', label: 'English', direction: 'LTR', isDefault: true, position: 0 },
    });
  });
});
