import { resolveTheme, THEME_PRESETS } from '@nibleaf/shared/themes';
import { type CreateProjectBody, projectConfigSchema } from '@nibleaf/validators';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  memberFindMany: vi.fn(),
  projectFindMany: vi.fn(),
  projectFindFirst: vi.fn(),
  deploymentGroupBy: vi.fn(),
  deploymentFindFirst: vi.fn(),
  deploymentFindMany: vi.fn(),
  deploymentCount: vi.fn(),
  resolveOrgAccess: vi.fn(),
  preferenceFindUnique: vi.fn(),
  lockOrganization: vi.fn(),
  tx: {
    organization: { create: vi.fn() },
    member: { create: vi.fn(), findUnique: vi.fn() },
    project: { create: vi.fn() },
    projectAddon: { createMany: vi.fn() },
    projectAddonAuditEvent: { createMany: vi.fn() },
    language: { create: vi.fn() },
    branch: { create: vi.fn() },
  },
}));

vi.mock('@/lib/access', () => ({
  accessibleProjectIds: async () =>
    (await mocks.memberFindMany()).map((m: { organizationId: string }) => m.organizationId.replace('org-', 'project-')),
  accessibleProjectRoles: vi.fn(),
  resolveOrgAccess: mocks.resolveOrgAccess,
}));
vi.mock('@/lib/site-host', () => ({ siteHosts: async () => new Map() }));
vi.mock('./admissions', () => ({ lockOrganization: mocks.lockOrganization }));

vi.mock('@nibleaf/auth/tenant-erasure', () => ({
  eraseProject: vi.fn(),
  TenantUsageDeletionPendingError: class extends Error {},
  TenantErasureProjectNotFoundError: class extends Error {},
}));
vi.mock('@nibleaf/database', () => ({
  assignDefaultUsagePlan: vi.fn(),
  Prisma: { DbNull: 'DbNull' },
  prisma: {
    member: { findMany: mocks.memberFindMany },
    userPreference: { findUnique: mocks.preferenceFindUnique },
    project: { findMany: mocks.projectFindMany, findFirst: mocks.projectFindFirst },
    deployment: {
      groupBy: mocks.deploymentGroupBy,
      findFirst: mocks.deploymentFindFirst,
      findMany: mocks.deploymentFindMany,
      count: mocks.deploymentCount,
    },
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
    mocks.deploymentGroupBy.mockResolvedValue([]);

    const projects = await listProjects('user-1');

    expect(mocks.projectFindMany).toHaveBeenCalledWith({
      where: { id: { in: ['project-a', 'project-b'] } },
      orderBy: { updatedAt: 'desc' },
      include: { organization: { select: { id: true, name: true } }, _count: { select: { pages: contentPages, deployments: true } } },
    });
    expect(projects[0]?._count).toEqual({ pages: 58, deployments: 3 });
  });

  it("counts the user's live publishes (starter excluded), shows any publish in flight (starter included) and dates the version readers see", async () => {
    mocks.memberFindMany.mockResolvedValue([{ organizationId: 'org-a' }]);
    mocks.projectFindMany.mockResolvedValue([
      { id: 'live', _count: { pages: 2, deployments: 3 } },
      { id: 'building', _count: { pages: 1, deployments: 1 } },
      { id: 'starter-only', _count: { pages: 6, deployments: 1 } },
      { id: 'starter-building', _count: { pages: 6, deployments: 1 } },
    ]);
    const v2CreatedAt = new Date('2026-11-07T08:30:00Z');
    const starterCreatedAt = new Date('2026-09-01T10:00:00Z');
    mocks.deploymentGroupBy.mockImplementation(async ({ by }: { by: string[] }) =>
      by.includes('status')
        ? [
            { projectId: 'live', status: 'READY', _count: { _all: 2 } },
            { projectId: 'building', status: 'BUILDING', _count: { _all: 1 } },
            // The sign-up starter's automatic publish, still running.
            { projectId: 'starter-building', status: 'PENDING', _count: { _all: 1 } },
          ]
        : [
            { projectId: 'live', _max: { version: 2 } },
            { projectId: 'starter-only', _max: { version: 1 } },
          ],
    );
    // v1 of "live" completed on Nov 1, but readers see v2 (created Nov 7, completedAt not recorded):
    // independent maxima would have reported Nov 1.
    mocks.deploymentFindMany.mockResolvedValue([
      { projectId: 'live', completedAt: null, createdAt: v2CreatedAt },
      { projectId: 'starter-only', completedAt: null, createdAt: starterCreatedAt },
    ]);

    const projects = await listProjects('user-1');

    expect(mocks.deploymentGroupBy).toHaveBeenCalledWith({
      by: ['projectId', 'status'],
      where: {
        projectId: { in: ['live', 'building', 'starter-only', 'starter-building'] },
        OR: [
          // The sign-up starter site's automatic first publish is not the user's...
          { status: 'READY', OR: [{ version: { not: 1 } }, { commitMessage: null }, { commitMessage: { not: 'Publish starter site' } }] },
          // ...but it is in flight like any other.
          { status: { in: ['PENDING', 'BUILDING'] } },
        ],
      },
      _count: { _all: true },
    });
    expect(mocks.deploymentGroupBy).toHaveBeenCalledWith({
      by: ['projectId'],
      where: { projectId: { in: ['live', 'building', 'starter-only', 'starter-building'] }, status: 'READY' },
      _max: { version: true },
    });
    expect(mocks.deploymentFindMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { projectId: 'live', version: 2 },
          { projectId: 'starter-only', version: 1 },
        ],
      },
      select: { projectId: true, completedAt: true, createdAt: true },
    });
    expect(
      projects.map(({ id, livePublishes, publishing, live, lastPublishedAt }) => ({ id, livePublishes, publishing, live, lastPublishedAt })),
    ).toEqual([
      { id: 'live', livePublishes: 2, publishing: false, live: true, lastPublishedAt: v2CreatedAt },
      { id: 'building', livePublishes: 0, publishing: true, live: false, lastPublishedAt: null },
      { id: 'starter-only', livePublishes: 0, publishing: false, live: true, lastPublishedAt: starterCreatedAt },
      { id: 'starter-building', livePublishes: 0, publishing: true, live: false, lastPublishedAt: null },
    ]);
  });

  it('skips the publish summary when the user has no sites', async () => {
    mocks.memberFindMany.mockResolvedValue([]);
    mocks.projectFindMany.mockResolvedValue([]);

    await expect(listProjects('user-1')).resolves.toEqual([]);
    expect(mocks.deploymentGroupBy).not.toHaveBeenCalled();
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

  it('says whether the site has a published version an export can copy, however old', async () => {
    mocks.projectFindFirst.mockResolvedValue({ id: 'project-a', _count: { pages: 1, deployments: 80, domains: 0 }, languages: [] });
    mocks.deploymentFindFirst.mockResolvedValueOnce({ id: 'deployment-1' }).mockResolvedValueOnce(null);

    await expect(getProject('org-a', 'project-a')).resolves.toMatchObject({ hasPublishedVersion: true });
    // The same rule as the export itself: any finished publish that kept its site copy, not just the newest 50 attempts.
    expect(mocks.deploymentFindFirst).toHaveBeenCalledWith({
      where: { projectId: 'project-a', status: 'READY', snapshot: { not: 'DbNull' } },
      select: { id: true },
    });
    await expect(getProject('org-a', 'project-a')).resolves.toMatchObject({ hasPublishedVersion: false });
  });

  it('counts every publish that went live, beyond the newest 50 attempts, and none that failed', async () => {
    // 80 attempts: most failed, and the live ones are older than the deployments list reaches.
    mocks.projectFindFirst.mockResolvedValue({ id: 'project-a', _count: { pages: 1, deployments: 80, domains: 0 }, languages: [] });
    mocks.deploymentFindFirst.mockResolvedValue({ id: 'deployment-1' });
    mocks.deploymentCount.mockResolvedValueOnce(3).mockResolvedValueOnce(0);

    await expect(getProject('org-a', 'project-a')).resolves.toMatchObject({ readyPublishes: 3, hasPublishedVersion: true });
    expect(mocks.deploymentCount).toHaveBeenCalledWith({ where: { projectId: 'project-a', status: 'READY' } });
    // Only failed attempts: nothing went live.
    await expect(getProject('org-a', 'project-a')).resolves.toMatchObject({ readyPublishes: 0 });
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
    mocks.resolveOrgAccess.mockResolvedValue({ organizationId: 'org-a', orgRole: 'admin' });
    mocks.lockOrganization.mockResolvedValue({ id: 'org-a' });
    mocks.tx.member.findUnique.mockResolvedValue({ orgRole: 'admin' });
    mocks.tx.project.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'project-new', ...data }));
  });

  it('creates the website inside the given organization and never a new organization', async () => {
    await createProject('user-1', { name: 'Acme Docs', organizationId: 'org-a' });

    expect(mocks.resolveOrgAccess).toHaveBeenCalledWith('user-1', 'org-a');
    expect(mocks.lockOrganization).toHaveBeenCalledWith(mocks.tx, 'org-a');
    expect(mocks.tx.organization.create).not.toHaveBeenCalled();
    expect(mocks.tx.member.create).not.toHaveBeenCalled();
    expect(mocks.tx.project.create).toHaveBeenCalledWith({ data: expect.objectContaining({ organizationId: 'org-a', name: 'Acme Docs' }) });
  });

  it('refuses an organization Member before writing anything', async () => {
    mocks.resolveOrgAccess.mockResolvedValue({ organizationId: 'org-a', orgRole: 'member' });

    await expect(createProject('user-1', { name: 'Acme Docs', organizationId: 'org-a' })).rejects.toMatchObject({
      code: 'auth:insufficient_role',
    });
    expect(mocks.lockOrganization).not.toHaveBeenCalled();
    expect(mocks.tx.project.create).not.toHaveBeenCalled();
  });

  it('re-reads the role under the organization lock', async () => {
    mocks.tx.member.findUnique.mockResolvedValue({ orgRole: 'member' });

    await expect(createProject('user-1', { name: 'Acme Docs', organizationId: 'org-a' })).rejects.toMatchObject({
      code: 'auth:insufficient_role',
    });
    expect(mocks.tx.project.create).not.toHaveBeenCalled();
  });

  it('places an org-less request from an old dashboard in the landing org the caller administers', async () => {
    mocks.preferenceFindUnique.mockResolvedValue({ lastOrganizationId: 'org-b' });
    mocks.memberFindMany.mockResolvedValue([
      { organizationId: 'org-a', orgRole: 'owner' },
      { organizationId: 'org-b', orgRole: 'admin' },
    ]);

    await createProject('user-1', { name: 'Acme Docs' });

    expect(mocks.resolveOrgAccess).not.toHaveBeenCalled();
    expect(mocks.lockOrganization).toHaveBeenCalledWith(mocks.tx, 'org-b');
  });

  it('refuses an org-less request from someone who administers no organization', async () => {
    mocks.preferenceFindUnique.mockResolvedValue(null);
    mocks.memberFindMany.mockResolvedValue([]);

    await expect(createProject('user-1', { name: 'Acme Docs' })).rejects.toMatchObject({ code: 'auth:insufficient_role' });
    expect(mocks.tx.organization.create).not.toHaveBeenCalled();
  });

  it('seeds the curated Harbor preset so a new site never renders the legacy palette', async () => {
    await createProject('user-1', { name: 'Acme Docs', organizationId: 'org-a' } as CreateProjectBody);

    const config = createdConfig();
    expect(config.theme).toEqual({ version: 1, preset: 'harbor', metadata: THEME_PRESETS.harbor.metadata });
    // A stored theme object is what opts the reader into the theme resolver.
    expect(resolveTheme(config).id).toBe('harbor');
    expect(projectConfigSchema.safeParse(config).success).toBe(true);
  });

  it('keeps add-on provisioning intact next to the seeded theme', async () => {
    await createProject('user-1', { name: 'Acme Docs', organizationId: 'org-a' } as CreateProjectBody);

    const config = createdConfig();
    expect(config.addons).toMatchObject({ feedback: expect.any(Boolean) });
    expect(mocks.tx.projectAddon.createMany).toHaveBeenCalledTimes(1);
    expect(mocks.tx.projectAddonAuditEvent.createMany).toHaveBeenCalledTimes(1);
    expect(mocks.tx.language.create).toHaveBeenCalledWith({
      data: { projectId: 'project-new', code: 'en', label: 'English', direction: 'LTR', isDefault: true, position: 0 },
    });
  });
});
