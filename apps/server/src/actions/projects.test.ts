import { readFileSync } from 'node:fs';
import { INTERFACE_LOCALES } from '@nibleaf/i18n/locales';
import { resolveTheme, THEME_PRESETS } from '@nibleaf/shared/themes';
import { type CreateProjectBody, projectConfigSchema, updateProjectBody } from '@nibleaf/validators';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  memberFindMany: vi.fn(),
  projectFindMany: vi.fn(),
  projectFindFirst: vi.fn(),
  projectUpdate: vi.fn(),
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
    project: { create: vi.fn(), findFirst: vi.fn(), updateManyAndReturn: vi.fn() },
    projectAddon: { createMany: vi.fn() },
    projectAddonAuditEvent: { createMany: vi.fn() },
    language: { create: vi.fn() },
    branch: { create: vi.fn() },
    page: { create: vi.fn() },
  },
}));

vi.mock('@/env', () => ({
  env: {
    APP_URL: 'https://dashboard.example.test',
    API_URL: 'https://gateway.example.test',
    ADMIN_URL: 'https://console.example.test',
    SITE_BASE_DOMAIN: 'sites.example.test',
    CUSTOM_DOMAIN_CNAME_TARGET: 'ingress.example.test',
    STORAGE_PUBLIC_URL: 'https://uploads.example.test',
    CDN_URL: 'https://assets.example.test',
    BETTER_AUTH_URL: 'https://login.example.test',
    STORAGE_PUBLIC_ENDPOINT: 'https://objects.example.test',
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
  Prisma: {
    DbNull: 'DbNull',
    PrismaClientKnownRequestError: class extends Error {
      code = 'P2002';
      meta = { target: ['slug'] };
    },
  },
  prisma: {
    member: { findMany: mocks.memberFindMany },
    userPreference: { findUnique: mocks.preferenceFindUnique },
    project: { findMany: mocks.projectFindMany, findFirst: mocks.projectFindFirst, update: mocks.projectUpdate },
    deployment: {
      groupBy: mocks.deploymentGroupBy,
      findFirst: mocks.deploymentFindFirst,
      findMany: mocks.deploymentFindMany,
      count: mocks.deploymentCount,
    },
    $transaction: (run: (tx: typeof mocks.tx) => Promise<unknown>) => run(mocks.tx),
  },
}));

import { checkProjectAvailability, createProject, getProject, listProjects, updateProject } from './projects';

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
    mocks.projectFindMany.mockResolvedValue([]);

    await expect(getProject('org-a', 'missing')).rejects.toMatchObject({ code: 'database:not_found' });
  });
});

/** The config handed to `tx.project.create` by the last createProject call. */
const createdConfig = () => (mocks.tx.project.create.mock.calls[0] as [{ data: { config: Record<string, unknown> } }])[0].data.config;

describe('createProject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.projectFindFirst.mockResolvedValue(null);
    mocks.projectFindMany.mockResolvedValue([]);
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

describe('site creation language, starters and address availability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.memberFindMany.mockResolvedValue([{ organizationId: 'org-a', orgRole: 'owner' }]);
    mocks.projectFindMany.mockResolvedValue([]);
    mocks.projectFindFirst.mockResolvedValue(null);
    mocks.projectFindMany.mockResolvedValue([]);
    mocks.resolveOrgAccess.mockResolvedValue({ organizationId: 'org-a', orgRole: 'admin' });
    mocks.lockOrganization.mockResolvedValue({ id: 'org-a' });
    mocks.tx.member.findUnique.mockResolvedValue({ orgRole: 'admin' });
    mocks.preferenceFindUnique.mockResolvedValue({ lastOrganizationId: 'org-a' });
    mocks.tx.project.create.mockResolvedValue({ id: 'project-new' });
    mocks.tx.language.create.mockResolvedValue({ id: 'language-new' });
    mocks.tx.branch.create.mockResolvedValue({ id: 'branch-new' });
    mocks.tx.page.create.mockImplementation(async () => ({ id: `page-${mocks.tx.page.create.mock.calls.length}` }));
  });

  it.each([
    ['en', 'English', 'LTR'],
    ['ar', 'العربية', 'RTL'],
    ['ur', 'اردو', 'RTL'],
    ['zh', '简体中文', 'LTR'],
  ] as const)('sets %s as the default content language', async (language, label, direction) => {
    await createProject('user-1', { name: 'Docs', language });
    expect(mocks.tx.language.create).toHaveBeenCalledWith({
      data: { projectId: 'project-new', code: language, label, direction, isDefault: true, position: 0 },
    });
  });

  it.each([
    ['blank', 1],
    ['product-docs', 4],
    ['help-center', 3],
  ] as const)('creates %s pages in the chosen language and returns the first id', async (starter, count) => {
    const result = await createProject('user-1', { name: 'Docs', language: 'ar', starter });
    expect(result.firstPageId).toBe('page-1');
    expect(mocks.tx.page.create).toHaveBeenCalledTimes(count);
    const pages = mocks.tx.page.create.mock.calls.map(([args]) => args.data);
    for (const page of pages) {
      expect(page).toMatchObject({ projectId: 'project-new', branchId: 'branch-new', languageId: 'language-new' });
      expect(page.title).toMatch(/[\u0600-\u06ff]/);
      expect(page.content).toMatch(/^## /);
      expect(page.content).toContain('\n- ');
    }
    expect(pages[0]).toMatchObject({ title: 'مرحباً', slug: 'welcome', path: 'welcome', parentId: null });
    if (starter === 'product-docs') expect(pages[3]).toMatchObject({ parentId: 'page-3', path: 'guides/first-guide', position: 0 });
  });

  it.each(INTERFACE_LOCALES)('uses translated starter copy for $code', async ({ code }) => {
    const language = code === 'zh-CN' ? 'zh' : code;
    await createProject('user-1', { name: 'Docs', language, starter: 'help-center' });
    const title = mocks.tx.page.create.mock.calls[0]?.[0].data.title;
    const catalog = JSON.parse(readFileSync(new URL(`../../../../packages/i18n/messages/${code}.json`, import.meta.url), 'utf8'));
    expect(title).toBe(catalog.newsite_starter_welcome_title);
    expect(mocks.tx.page.create.mock.calls[0]?.[0].data.content).toBe(catalog.newsite_starter_welcome_content);
  });

  it('keeps the existing empty tree when starter is omitted', async () => {
    await createProject('user-1', { name: 'Docs' });
    expect(mocks.tx.page.create).not.toHaveBeenCalled();
  });

  it('returns a typed 409 with a free suggestion before writing a taken typed address', async () => {
    mocks.projectFindFirst.mockImplementation(async ({ where }) => (where.slug === 'taken' ? { id: 'other' } : null));
    mocks.projectFindMany.mockResolvedValue([{ slug: 'taken' }]);
    await expect(createProject('user-1', { name: 'Docs', slug: 'taken' })).rejects.toMatchObject({
      code: 'database:conflict',
      status: 409,
      details: { reason: 'slug_taken', slug: 'taken', suggestedSlug: expect.stringMatching(/^taken-[a-f0-9]{8}$/) },
    });
    expect(mocks.tx.project.create).not.toHaveBeenCalled();
  });

  it('returns a random suggestion for an occupied auto-derived address without site metadata', async () => {
    mocks.projectFindMany.mockResolvedValue([{ slug: 'acme-docs' }]);
    await expect(checkProjectAvailability('user-1', { name: 'ACME Docs' })).resolves.toEqual({
      available: false,
      suggestion: expect.stringMatching(/^acme-docs-[a-f0-9]{8}$/),
    });
    expect(mocks.projectFindFirst).not.toHaveBeenCalled();
  });
  it('checks only the requested organization and refuses an inaccessible organization', async () => {
    await checkProjectAvailability('user-1', { organizationId: 'org-a', name: 'Docs' });
    expect(mocks.resolveOrgAccess).toHaveBeenCalledWith('user-1', 'org-a');
    mocks.projectFindMany.mockClear();
    mocks.resolveOrgAccess.mockRejectedValueOnce(new Error('organization not found'));
    await expect(checkProjectAvailability('user-1', { organizationId: 'private-org', name: 'Docs' })).rejects.toThrow('organization not found');
    expect(mocks.projectFindMany).not.toHaveBeenCalled();
  });
  it.each([
    ['مركز المساعدة', 'site-0s7xtf9'],
    ['وثائق جود 263', 'site-178xry5'],
    ['Jood وثائق', 'jood'],
    ['Acme Docs', 'acme-docs'],
    ['وثائق جود للمساعدة X', 'site-12zr2ig'],
  ])('derives the same usable address for preview and creation: %s', async (name, expected) => {
    await createProject('user-1', { name });
    expect(mocks.tx.project.create).toHaveBeenCalledWith({ data: expect.objectContaining({ slug: expected }) });
    await expect(checkProjectAvailability('user-1', { name })).resolves.toEqual({ available: true });
  });

  it('checks collisions for neutral addresses and returns the final suffixed preview', async () => {
    mocks.projectFindMany.mockResolvedValue([{ slug: 'site-178xry5' }]);
    await expect(checkProjectAvailability('user-1', { name: 'وثائق جود 263' })).resolves.toMatchObject({
      suggestion: expect.stringMatching(/^site-178xry5-[a-f0-9]{8}$/),
      available: false,
    });
    await createProject('user-1', { name: 'وثائق جود 263' });
    expect(mocks.tx.project.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ slug: expect.stringMatching(/^site-178xry5-[a-f0-9]{8}$/) }),
    });
  });
  it('retains a numeric address that the author explicitly types', async () => {
    await createProject('user-1', { name: 'وثائق جود 263', slug: '263' });
    expect(mocks.tx.project.create).toHaveBeenCalledWith({ data: expect.objectContaining({ slug: '263' }) });
  });
  it.each(
    [
      'www',
      'admin',
      'api',
      'app',
      'docs',
      'storage',
      'cname',
      'status',
      'mail',
      'xn--nibleaf',
      'dashboard',
      'gateway',
      'console',
      'sites',
      'ingress',
      'uploads',
      'assets',
      'login',
      'objects',
    ].flatMap((slug) => (['availability', 'create', 'update'] as const).map((path) => ({ slug, path }))),
  )('rejects reserved hostname $slug on $path', async ({ slug, path }) => {
    mocks.projectFindFirst.mockImplementation(async ({ where }) =>
      where.id ? { id: 'project-new', organizationId: 'org-a', slug: 'ordinary' } : null,
    );
    const action =
      path === 'availability'
        ? checkProjectAvailability('user-1', { organizationId: 'org-a', name: 'Site', slug })
        : path === 'create'
          ? createProject('user-1', { organizationId: 'org-a', name: 'Site', slug })
          : updateProject('org-a', 'project-new', { slug });
    await expect(action).rejects.toMatchObject({ status: 400, details: { reason: 'slug_reserved' } });
    expect(mocks.tx.project.create).not.toHaveBeenCalled();
  });

  // P0-DASH-001: the first sign-up's starter site was once given `docs`, which
  // is reserved. It must stay editable without its live address changing.
  it.each(['docs', 'xn--nibleaf', 'dashboard'])('saves other fields of a site that already has the reserved address %s', async (slug) => {
    mocks.projectFindFirst.mockImplementation(async ({ where }) => (where.id ? { id: 'project-legacy', organizationId: 'org-a', slug } : null));
    mocks.projectUpdate.mockImplementation(async ({ data }) => ({ id: 'project-legacy', slug, ...data }));
    await expect(updateProject('org-a', 'project-legacy', { name: 'Docs', slug, description: 'Renamed' })).resolves.toMatchObject({
      slug,
      description: 'Renamed',
    });
    // The unchanged address is not written back.
    expect(mocks.projectUpdate).toHaveBeenCalledWith({ where: { id: 'project-legacy' }, data: { name: 'Docs', description: 'Renamed' } });
  });
  it('never writes back an unchanged reserved address over a rename that landed after it was read', async () => {
    // The stale request read `docs`; a rename to `handbook` commits before its write.
    let stored = 'docs';
    mocks.projectFindFirst.mockImplementation(async ({ where }) => {
      if (!where.id) return null;
      const snapshot = { id: 'project-legacy', organizationId: 'org-a', slug: stored };
      stored = 'handbook';
      return snapshot;
    });
    mocks.projectUpdate.mockImplementation(async ({ data }) => {
      if (data.slug !== undefined) stored = data.slug;
      return { id: 'project-legacy', slug: stored, ...data };
    });
    await updateProject('org-a', 'project-legacy', { slug: 'docs', description: 'Edited' });
    expect(mocks.projectUpdate).toHaveBeenCalledWith({ where: { id: 'project-legacy' }, data: { description: 'Edited' } });
    expect(stored).toBe('handbook');
  });
  it('still refuses moving a site with a reserved address to another reserved address', async () => {
    mocks.projectFindFirst.mockImplementation(async ({ where }) =>
      where.id ? { id: 'project-legacy', organizationId: 'org-a', slug: 'docs' } : null,
    );
    await expect(updateProject('org-a', 'project-legacy', { slug: 'www' })).rejects.toMatchObject({
      status: 400,
      details: { reason: 'slug_reserved' },
    });
    expect(mocks.projectUpdate).not.toHaveBeenCalled();
  });

  it('returns only availability and an optional suggestion, without names or counts', async () => {
    mocks.projectFindMany.mockResolvedValue([]);
    await expect(checkProjectAvailability('user-1', { name: 'Acme' })).resolves.toEqual({ available: true });
  });

  it('bounds an occupied-slug probe to one IN query of at most five non-sequential candidates', async () => {
    mocks.projectFindFirst.mockResolvedValue({ id: 'occupied' });
    mocks.projectFindMany.mockImplementation(async ({ where }) => (where.slug ? where.slug.in.map((slug: string) => ({ slug })) : []));
    await expect(checkProjectAvailability('user-1', { name: 'Site', slug: 'taken' })).resolves.toEqual({ available: false });
    expect(mocks.projectFindFirst).not.toHaveBeenCalled();
    expect(mocks.projectFindMany).toHaveBeenCalledTimes(1);
    const candidates = mocks.projectFindMany.mock.calls[0]?.[0].where.slug.in;
    expect(candidates).toHaveLength(5);
    expect(candidates[0]).toBe('taken');
    for (const candidate of candidates.slice(1)) expect(candidate).toMatch(/^taken-[a-f0-9]{8}$/);
  });

  it.each([
    'www',
    'admin',
    'api',
    'app',
    'docs',
    'storage',
    'cname',
    'status',
    'mail',
    'dashboard',
    'gateway',
    'console',
    'sites',
    'ingress',
    'uploads',
    'assets',
    'login',
    'objects',
    'xn--homoglyph',
  ])('never generates a reserved address from %s', async (name) => {
    mocks.projectFindMany.mockResolvedValue([]);
    await createProject('user-1', { name });
    const slug = mocks.tx.project.create.mock.calls[0]?.[0].data.slug;
    expect(slug).not.toBe(name);
    expect(slug).not.toMatch(/^xn--/);
  });

  it.each(['en', 'ar'] as const)('stores the exact %s catalog title and body for every starter page', async (language) => {
    const catalog = JSON.parse(readFileSync(new URL(`../../../../packages/i18n/messages/${language}.json`, import.meta.url), 'utf8'));
    const messageFor: Record<string, string> = {
      welcome: 'welcome',
      'getting-started': 'gettingstarted',
      guides: 'guides',
      'first-guide': 'firstguide',
      faq: 'faq',
    };
    for (const starter of ['blank', 'product-docs', 'help-center'] as const) {
      mocks.tx.page.create.mockClear();
      await createProject('user-1', { name: 'Localized site', language, starter });
      for (const [call] of mocks.tx.page.create.mock.calls) {
        const message = messageFor[call.data.slug];
        expect(call.data.title).toBe(catalog[`newsite_starter_${message}_title`]);
        expect(call.data.content).toBe(catalog[`newsite_starter_${message}_content`]);
      }
    }
  });
});

// The dashboard's Banner settings send `config.banner` as JSON; the real
// validator and merge decide what is stored. `mergeConfig` merges an object
// section one level deep and keeps any key the patch leaves out.
describe('updateProject: clearing saved banner text', () => {
  const BANNER = { enabled: true, dismissible: false, message: 'Spring sale', linkLabel: 'See plans', linkUrl: 'https://example.com/pricing' };
  const SIBLINGS = { navbar: { ctaLabel: 'Start' }, seo: { metaTitle: 'Docs' }, redirects: [{ from: '/old', to: '/new' }] };
  let stored: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    stored = { ...structuredClone(SIBLINGS), banner: { ...BANNER } };
    mocks.projectFindFirst.mockResolvedValue({ id: 'site-1', organizationId: 'org-a', slug: 'acme' });
    mocks.tx.project.findFirst.mockImplementation(async () => ({ id: 'site-1', config: structuredClone(stored), updatedAt: new Date(0) }));
    mocks.tx.project.updateManyAndReturn.mockImplementation(async ({ data }: { data: { config: Record<string, unknown> } }) => {
      stored = structuredClone(data.config);
      return [{ id: 'site-1', config: stored, updatedAt: new Date(1) }];
    });
  });

  /** The request as the dashboard sends it: JSON, then the route's validator. */
  const save = (banner: Record<string, unknown>) =>
    updateProject('org-a', 'site-1', updateProjectBody.parse(JSON.parse(JSON.stringify({ config: { banner } }))));

  it.each(['message', 'linkLabel', 'linkUrl'] as const)('stores an empty %s sent as "", and keeps every other key and section', async (key) => {
    const readback = await save({ ...BANNER, [key]: '' });
    expect(stored).toStrictEqual({ ...SIBLINGS, banner: { ...BANNER, [key]: '' } });
    expect(readback).toMatchObject({ config: { banner: { ...BANNER, [key]: '' } } });
  });

  it('keeps a key the patch leaves out: why the dashboard must send cleared text as ""', async () => {
    // JSON drops `undefined`, so this is what an omitted cleared field looks like on the wire.
    await save({ ...BANNER, message: undefined });
    expect(stored.banner).toStrictEqual(BANNER);
  });
});

// The dashboard's Navbar form sends `config.navbar` as JSON: every list (an
// emptied one as []), both switches, and each CTA text trimmed, a cleared one
// the site held as '' (the reader shows the CTA only when both are non-empty).
describe('updateProject: clearing saved navbar values', () => {
  const NAVBAR = {
    ctaLabel: 'Book a demo',
    ctaUrl: 'https://example.com/demo',
    links: [{ label: 'Blog', href: 'https://blog.example.com', external: true }],
    tabs: [{ label: 'Guides', href: '/guides' }],
    anchors: [{ label: 'Community', href: '/community', icon: 'users' }],
    showSearch: false,
    changelog: true,
  };
  const SIBLINGS = { footer: { copyright: '© Acme' }, seo: { metaTitle: 'Docs' }, redirects: [{ from: '/old', to: '/new' }] };
  let stored: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    stored = { ...structuredClone(SIBLINGS), navbar: structuredClone(NAVBAR) };
    mocks.projectFindFirst.mockResolvedValue({ id: 'site-1', organizationId: 'org-a', slug: 'acme' });
    mocks.tx.project.findFirst.mockImplementation(async () => ({ id: 'site-1', config: structuredClone(stored), updatedAt: new Date(0) }));
    mocks.tx.project.updateManyAndReturn.mockImplementation(async ({ data }: { data: { config: Record<string, unknown> } }) => {
      stored = structuredClone(data.config);
      return [{ id: 'site-1', config: stored, updatedAt: new Date(1) }];
    });
  });

  const save = (navbar: Record<string, unknown>) =>
    updateProject('org-a', 'site-1', updateProjectBody.parse(JSON.parse(JSON.stringify({ config: { navbar } }))));

  it('stores cleared CTA texts as "" and emptied lists as [], keeps the switches and every other section, and reads it back', async () => {
    const sent = { ...NAVBAR, ctaLabel: '', ctaUrl: '', links: [], tabs: [], anchors: [] };
    const readback = await save(sent);
    expect(stored).toStrictEqual({ ...SIBLINGS, navbar: sent });
    expect(readback).toMatchObject({ config: { navbar: sent } });
  });

  it('keeps row text as sent and `external` true or false', async () => {
    const links = [
      { label: '  Docs ', href: ' /docs ', external: false },
      { label: 'Half', href: '' },
    ];
    await save({ ...NAVBAR, links });
    expect((stored.navbar as typeof NAVBAR).links).toStrictEqual(links);
  });

  it('keeps every field and list a patch leaves out: the form sends only what changed', async () => {
    await save({ ctaLabel: 'Talk to sales' });
    expect(stored).toStrictEqual({ ...SIBLINGS, navbar: { ...NAVBAR, ctaLabel: 'Talk to sales' } });
  });

  it('keeps a CTA text the patch leaves out: why a cleared one must be sent as ""', async () => {
    await save({ ...NAVBAR, ctaLabel: undefined, showSearch: true });
    expect(stored.navbar).toStrictEqual({ ...NAVBAR, showSearch: true });
  });
});

// The dashboard's SEO form sends all four `config.seo` values as JSON, a
// cleared text as '' (the reader treats it as unset).
describe('updateProject: saving SEO from the dashboard form', () => {
  const SEO = { metaTitle: 'Docs', metaDescription: 'All of it', socialImage: '/og/cover.png', allowIndex: false };
  const SIBLINGS = { navbar: { ctaLabel: 'Start' }, banner: { enabled: true, message: 'Sale' } };
  let stored: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    stored = { ...structuredClone(SIBLINGS), seo: { ...SEO } };
    mocks.projectFindFirst.mockResolvedValue({ id: 'site-1', organizationId: 'org-a', slug: 'acme' });
    mocks.tx.project.findFirst.mockImplementation(async () => ({ id: 'site-1', config: structuredClone(stored), updatedAt: new Date(0) }));
    mocks.tx.project.updateManyAndReturn.mockImplementation(async ({ data }: { data: { config: Record<string, unknown> } }) => {
      stored = structuredClone(data.config);
      return [{ id: 'site-1', config: stored, updatedAt: new Date(1) }];
    });
  });

  const save = (seo: Record<string, unknown>) =>
    updateProject('org-a', 'site-1', updateProjectBody.parse(JSON.parse(JSON.stringify({ config: { seo } }))));

  it.each(['metaTitle', 'metaDescription', 'socialImage'] as const)('stores a cleared %s as "" and keeps the other sections', async (key) => {
    const readback = await save({ ...SEO, [key]: '' });
    expect(stored).toStrictEqual({ ...SIBLINGS, seo: { ...SEO, [key]: '' } });
    expect(readback).toMatchObject({ config: { seo: { ...SEO, [key]: '' } } });
  });

  it('stores indexing turned back on', async () => {
    await save({ ...SEO, allowIndex: true });
    expect(stored.seo).toStrictEqual({ ...SEO, allowIndex: true });
  });

  it('accepts a relative or absolute social image, and refuses an unsafe scheme', () => {
    for (const socialImage of ['/og/cover.png', 'https://cdn.example/og.png']) {
      expect(updateProjectBody.safeParse({ config: { seo: { ...SEO, socialImage } } }).success).toBe(true);
    }
    expect(updateProjectBody.safeParse({ config: { seo: { ...SEO, socialImage: 'javascript:alert(1)' } } }).success).toBe(false);
  });
});

// The dashboard's Theme Studio sends `config.theme` whole when the authored
// theme changed and `config.styling: { theme }` when the appearance changed,
// never Styling's `primaryColor` or `radius` (features/site-theme).
describe('updateProject: saving the theme and appearance from Theme Studio', () => {
  const STYLING = { primaryColor: '#5546e8', radius: 'pill', theme: 'dark' };
  const THEME = {
    version: 1,
    preset: 'signal',
    metadata: { name: 'Handbook', description: 'Our theme', author: 'Docs team' },
    colors: { light: { accent: '#2f4ad0' } },
    layout: { shell: 'console' },
  };
  const SIBLINGS = { navbar: { ctaLabel: 'Start' }, typography: { bodyFont: 'Inter' }, redirects: [{ from: '/old', to: '/new' }] };
  let stored: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    stored = { ...structuredClone(SIBLINGS), styling: { ...STYLING }, theme: structuredClone(THEME) };
    mocks.projectFindFirst.mockResolvedValue({ id: 'site-1', organizationId: 'org-a', slug: 'acme' });
    mocks.tx.project.findFirst.mockImplementation(async () => ({ id: 'site-1', config: structuredClone(stored), updatedAt: new Date(0) }));
    mocks.tx.project.updateManyAndReturn.mockImplementation(async ({ data }: { data: { config: Record<string, unknown> } }) => {
      stored = structuredClone(data.config);
      return [{ id: 'site-1', config: stored, updatedAt: new Date(1) }];
    });
  });

  const save = (config: Record<string, unknown>) => updateProject('org-a', 'site-1', updateProjectBody.parse(JSON.parse(JSON.stringify({ config }))));

  it('an appearance-only save keeps Styling’s colour and radius and the authored theme', async () => {
    const readback = await save({ styling: { theme: 'system' } });
    expect(stored).toStrictEqual({ ...SIBLINGS, styling: { ...STYLING, theme: 'system' }, theme: THEME });
    expect(readback).toMatchObject({ config: { styling: { ...STYLING, theme: 'system' } } });
  });

  it('a theme-only save keeps every styling key, and the optional theme parts it carries as authored', async () => {
    const theme = { ...THEME, colors: { light: { accent: '#2f4ad0', canvas: '#fdfdfd' } } };
    await save({ theme });
    expect(stored).toStrictEqual({ ...SIBLINGS, styling: STYLING, theme });
    // No resolved default was written: layout and components hold only what was authored.
    expect(Object.keys(stored.theme as object)).toStrictEqual(['version', 'preset', 'metadata', 'colors', 'layout']);
  });

  it('merges the theme one level deep: a part left out is kept, a part sent empty is cleared (Keep mine)', async () => {
    await save({ theme: { version: 1, preset: 'harbor' } });
    expect((stored.theme as typeof THEME).layout).toStrictEqual(THEME.layout);
    await save({ theme: { version: 1, preset: 'harbor', layout: {}, colors: {} } });
    expect(stored.theme).toStrictEqual({ ...THEME, preset: 'harbor', layout: {}, colors: {} });
    expect(resolveTheme({ theme: stored.theme as never }).layout).toStrictEqual(THEME_PRESETS.harbor.layout);
  });

  it('a preset left out is kept from the server: why Keep mine on a theme without one sends its effective preset', async () => {
    stored = { styling: { theme: 'dark' }, theme: { version: 1, preset: 'signal', colors: { light: { canvas: '#fdfdfd' } } } };
    await save({ theme: { version: 1, colors: { light: { canvas: '#fafafa' } } } });
    expect(resolveTheme({ theme: stored.theme as never }).id).toBe('signal');
    await save({ theme: { version: 1, colors: { light: { canvas: '#fafafa' } }, preset: 'harbor' } });
    expect(stored.theme).toStrictEqual({ version: 1, preset: 'harbor', colors: { light: { canvas: '#fafafa' } } });
    expect(resolveTheme({ theme: stored.theme as never }).id).toBe('harbor');
  });

  it('a site with no appearance keeps none after a theme save', async () => {
    stored = { styling: { primaryColor: '#5546e8' } };
    await save({ theme: { version: 1, preset: 'manuscript' } });
    expect(stored).toStrictEqual({ styling: { primaryColor: '#5546e8' }, theme: { version: 1, preset: 'manuscript' } });
  });

  it('refuses an authored theme that fails contrast, as the dashboard does before saving', () => {
    expect(
      updateProjectBody.safeParse({ config: { theme: { version: 1, preset: 'harbor', colors: { light: { foreground: '#eeeeee' } } } } }).success,
    ).toBe(false);
  });
});

// The dashboard's Footer form sends `config.footer` as JSON with only the keys
// the person changed: a text trimmed, a cleared one as '' (the reader shows no
// link and an empty copyright line), the badge only when switched.
describe('updateProject: clearing saved footer values', () => {
  const FOOTER = { copyright: '© Acme', github: 'https://github.com/acme', x: 'https://x.com/acme', linkedin: '/company', madeWithBadge: false };
  const SIBLINGS = { navbar: { ctaLabel: 'Start' }, seo: { metaTitle: 'Docs' }, banner: { enabled: true, message: 'Sale' } };
  let stored: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    stored = { ...structuredClone(SIBLINGS), footer: { ...FOOTER } };
    mocks.projectFindFirst.mockResolvedValue({ id: 'site-1', organizationId: 'org-a', slug: 'acme' });
    mocks.tx.project.findFirst.mockImplementation(async () => ({ id: 'site-1', config: structuredClone(stored), updatedAt: new Date(0) }));
    mocks.tx.project.updateManyAndReturn.mockImplementation(async ({ data }: { data: { config: Record<string, unknown> } }) => {
      stored = structuredClone(data.config);
      return [{ id: 'site-1', config: stored, updatedAt: new Date(1) }];
    });
  });

  const save = (footer: Record<string, unknown>) =>
    updateProject('org-a', 'site-1', updateProjectBody.parse(JSON.parse(JSON.stringify({ config: { footer } }))));

  it.each(['copyright', 'github', 'x', 'linkedin'] as const)('stores a cleared %s as "" and keeps the badge and every other section', async (key) => {
    const readback = await save({ ...FOOTER, [key]: '' });
    expect(stored).toStrictEqual({ ...SIBLINGS, footer: { ...FOOTER, [key]: '' } });
    expect(readback).toMatchObject({ config: { footer: { ...FOOTER, [key]: '' } } });
  });

  it('stores every text cleared with the badge still off', async () => {
    await save({ copyright: '', github: '', x: '', linkedin: '', madeWithBadge: false });
    expect(stored).toStrictEqual({ ...SIBLINGS, footer: { copyright: '', github: '', x: '', linkedin: '', madeWithBadge: false } });
  });

  it('a partial patch (the form sends only what changed) sets those keys and keeps every other key, the badge and other sections', async () => {
    const readback = await save({ linkedin: '' });
    expect(stored).toStrictEqual({ ...SIBLINGS, footer: { ...FOOTER, linkedin: '' } });
    expect(readback).toMatchObject({ config: { footer: { ...FOOTER, linkedin: '' } } });
    await save({ madeWithBadge: true });
    expect(stored).toStrictEqual({ ...SIBLINGS, footer: { ...FOOTER, linkedin: '', madeWithBadge: true } });
    await save({});
    expect(stored).toStrictEqual({ ...SIBLINGS, footer: { ...FOOTER, linkedin: '', madeWithBadge: true } });
  });

  it('keeps a key the patch leaves out: why a cleared value must be sent as ""', async () => {
    // JSON drops `undefined`: what the old form's "blank → undefined" put on the wire.
    await save({ ...FOOTER, github: undefined, madeWithBadge: true });
    expect(stored.footer).toStrictEqual({ ...FOOTER, madeWithBadge: true });
  });
});

// The dashboard's Styling form sends `config.styling` with only the keys the
// person changed: a color always as `#` and six lowercase digits (a short
// `#abc` is expanded first), a radius only when chosen. It never sends the
// appearance (`styling.theme`) or `config.theme`.
describe('updateProject: saving styling from the dashboard form', () => {
  /** A modern theme with its own dark accent and layout radius: the reader prefers both to the legacy styling where they apply. */
  const THEME = { version: 1, preset: 'harbor', colors: { dark: { accent: '#0f766e' } }, layout: { radius: 'pill' } };
  const SIBLINGS = { theme: THEME, seo: { metaTitle: 'Docs' }, navbar: { ctaLabel: 'Start' } };
  let stored: Record<string, unknown>;

  const startWith = (styling: Record<string, unknown>) => {
    stored = { ...structuredClone(SIBLINGS), styling };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    startWith({});
    mocks.projectFindFirst.mockResolvedValue({ id: 'site-1', organizationId: 'org-a', slug: 'acme' });
    mocks.tx.project.findFirst.mockImplementation(async () => ({ id: 'site-1', config: structuredClone(stored), updatedAt: new Date(0) }));
    mocks.tx.project.updateManyAndReturn.mockImplementation(async ({ data }: { data: { config: Record<string, unknown> } }) => {
      stored = structuredClone(data.config);
      return [{ id: 'site-1', config: stored, updatedAt: new Date(1) }];
    });
  });

  const save = (styling: Record<string, unknown>) =>
    updateProject('org-a', 'site-1', updateProjectBody.parse(JSON.parse(JSON.stringify({ config: { styling } }))));

  it('stores a short color the form expanded (#abc → #aabbcc) as sent, and reads it back', async () => {
    const readback = await save({ primaryColor: '#aabbcc' });
    expect(stored).toStrictEqual({ ...SIBLINGS, styling: { primaryColor: '#aabbcc' } });
    expect(readback).toMatchObject({ config: { styling: { primaryColor: '#aabbcc' } } });
  });

  it('refuses partial or unprefixed text, which the form therefore never sends', () => {
    for (const primaryColor of ['#', '#ab', '#abcd', 'aabbcc', 'teal']) {
      expect(updateProjectBody.safeParse({ config: { styling: { primaryColor } } }).success).toBe(false);
    }
  });

  it('a color-only patch keeps the stored radius and appearance, and the modern theme config', async () => {
    startWith({ primaryColor: '#5546e8', theme: 'dark', radius: 'sharp' });
    const readback = await save({ primaryColor: '#0ea5e9' });
    expect(stored).toStrictEqual({ ...SIBLINGS, styling: { primaryColor: '#0ea5e9', theme: 'dark', radius: 'sharp' } });
    expect(readback).toMatchObject({ config: { theme: THEME, styling: { primaryColor: '#0ea5e9', theme: 'dark', radius: 'sharp' } } });
  });

  it('a radius-only patch over an unset color and appearance leaves both unset', async () => {
    await save({ radius: 'rounded' });
    expect(stored).toStrictEqual({ ...SIBLINGS, styling: { radius: 'rounded' } });
  });

  it('a color-only patch over an unset radius keeps it unset, so the reader keeps the theme’s corners and its own dark accent', async () => {
    await save({ primaryColor: '#db2777' });
    expect(stored.styling).toStrictEqual({ primaryColor: '#db2777' });
    const theme = resolveTheme(stored as Parameters<typeof resolveTheme>[0], { authoredAccent: true });
    expect(theme.layout.radius).toBe('pill');
    expect(theme.colors.dark.accent).toBe('#0f766e');
    expect(theme.colors.light.accent).not.toBe(THEME_PRESETS.harbor.colors.light.accent);
  });

  it('why the form sends only what changed: main’s full payload wrote back a radius and appearance it never edited', async () => {
    // Another writer set the appearance and radius after main's form had read the site.
    startWith({ primaryColor: '#5546e8', theme: 'dark', radius: 'pill' });
    // Main sent its mount-time radius (or the 'rounded' default) and the query's old appearance with every save.
    await save({ primaryColor: '#0ea5e9', radius: 'rounded', theme: 'light' });
    expect(stored.styling).toStrictEqual({ primaryColor: '#0ea5e9', theme: 'light', radius: 'rounded' });
  });
});
