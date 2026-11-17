import { randomUUID } from 'node:crypto';
import type { Prisma } from '@nibleaf/database';
import { addonDefinitions } from '@nibleaf/shared/addons';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

describe.skipIf(process.env.ADMIN_POSTGRES !== '1')('admin discovery beyond recent samples', () => {
  let db: typeof import('@nibleaf/database');
  let admin: typeof import('./admin');
  const prefix = `admin-${randomUUID()}`;
  const ids = Array.from({ length: 505 }, (_, index) => `${prefix}-${String(index).padStart(3, '0')}`);
  const older = `${prefix}-000`;
  beforeAll(async () => {
    db = await import('@nibleaf/database');
    admin = await import('./admin');
    await db.prisma.organization.createMany({ data: ids.map((id) => ({ id, name: id })) });
    await db.prisma.user.createMany({
      data: ids.map((id, index) => ({
        id,
        name: index === 0 ? `Older customer ${prefix} Ø¹Ù…ÙŠÙ„ Ù‚Ø¯ÙŠÙ… ${prefix}` : id,
        email: `${id}@example.invalid`,
        createdAt: new Date(1_700_000_000_000 + index * 1000),
      })),
    });
    await db.prisma.project.createMany({
      data: ids.map((id, index) => ({
        id,
        organizationId: id,
        name: index === 0 ? `Older site ${prefix} Ù…ÙˆÙ‚Ø¹ Ù‚Ø¯ÙŠÙ… ${prefix}` : id,
        slug: id,
        createdAt: new Date(1_700_000_000_000 + index * 1000),
      })),
    });
    await db.prisma.member.create({ data: { organizationId: older, userId: older, role: 'owner', orgRole: 'owner' } });
    await db.prisma.deployment.createMany({
      data: Array.from({ length: 105 }, (_, index) => ({
        id: `${prefix}-dep-${index}`,
        projectId: older,
        version: index + 1,
        status: index === 0 ? ('PENDING' as const) : ('READY' as const),
        createdAt: new Date(1_700_000_000_000 + index * 1000),
      })),
    });
    await db.prisma.domain.createMany({
      data: Array.from({ length: 105 }, (_, index) => ({
        id: `${prefix}-domain-${index}`,
        projectId: older,
        domain: `${prefix}-${index}.example.invalid`,
        verificationToken: 'synthetic',
        dnsStatus: index === 0 ? ('ERROR' as const) : ('VERIFIED' as const),
        sslStatus: 'ACTIVE' as const,
        createdAt: new Date(1_700_000_000_000 + index * 1000),
      })),
    });
    const snapshot = await db.prisma.exportSnapshot.create({
      data: { projectId: older, deploymentId: `${prefix}-dep-1`, deploymentVersion: 2, snapshot: {}, assets: [], pagesCount: 0, contentBytes: 0 },
    });
    await db.prisma.exportJob.createMany({
      data: Array.from({ length: 55 }, (_, index) => ({
        id: `${prefix}-export-${index}`,
        projectId: older,
        snapshotId: snapshot.id,
        formats: [],
        status: index === 0 ? ('FAILED' as const) : ('SUCCEEDED' as const),
        createdAt: new Date(1_700_000_000_000 + index * 1000),
      })),
    });
    const connection = await db.prisma.gitConnection.create({
      data: { projectId: older, repository: 'fictional/docs', headBranch: 'docs', createdById: older },
    });
    await db.prisma.gitSyncOperation.createMany({
      data: Array.from({ length: 55 }, (_, index) => ({
        id: `${prefix}-git-${index}`,
        connectionId: connection.id,
        kind: 'PUSH',
        status: index === 0 ? 'CONFLICT' : 'SUCCEEDED',
        idempotencyKey: `${index}`,
        requestHash: 'synthetic',
        baseBranch: 'main',
        headBranch: 'docs',
        createdAt: new Date(1_700_000_000_000 + index * 1000),
      })),
    });
  }, 120_000);
  afterAll(async () => {
    if (!db) return;
    await db.prisma.exportJob.deleteMany({ where: { projectId: { in: ids } } });
    await db.prisma.exportSnapshot.deleteMany({ where: { projectId: { in: ids } } });
    await db.prisma.project.deleteMany({ where: { organizationId: { in: ids } } });
    await db.prisma.organization.deleteMany({ where: { id: { in: ids } } });
    await db.prisma.user.deleteMany({ where: { id: { in: ids } } });
    await db.prisma.$disconnect();
  });

  it('finds exact/partial English and Arabic records older than 500 newer records', async () => {
    expect((await admin.listAdminUsers({ search: `${older}@example.invalid` })).items.map((row) => row.id)).toEqual([older]);
    expect((await admin.listAdminUsers({ search: `Ø¹Ù…ÙŠÙ„ Ù‚Ø¯ÙŠÙ… ${prefix}` })).items.map((row) => row.id)).toEqual([older]);
    expect((await admin.listAdminSites({ search: `Older site ${prefix}` })).items.map((row) => row.id)).toEqual([older]);
    expect((await admin.listAdminSites({ search: `Ù…ÙˆÙ‚Ø¹ Ù‚Ø¯ÙŠÙ… ${prefix}` })).items.map((row) => row.id)).toEqual([older]);
    expect((await admin.listAdminSites({ search: `${older}@example.invalid` })).items.map((row) => row.id)).toEqual([older]);
  });
  it('returns bounded, stable pages and full filtered counts', async () => {
    for (const list of [admin.listAdminUsers, admin.listAdminSites]) {
      const first = await list({ search: prefix });
      const second = await list({ search: prefix, cursor: first.nextCursor ?? undefined });
      expect(first.items).toHaveLength(50);
      expect(second.items).toHaveLength(50);
      expect(first.total).toBeGreaterThanOrEqual(504);
      expect(second.items.some((row) => first.items.some((previous) => previous.id === row.id))).toBe(false);
    }
  });
  it('retrieves old unresolved operations and counts issues outside all recent-history windows', async () => {
    const result = await admin.getAdminOperations({ search: `Older site ${prefix}`, onlyIssues: true });
    expect(result.deployments.map((row) => row.id)).toContain(`${prefix}-dep-0`);
    expect(result.domains.map((row) => row.id)).toContain(`${prefix}-domain-0`);
    expect(result.exports.map((row) => row.id)).toContain(`${prefix}-export-0`);
    expect(result.git.map((row) => row.id)).toContain(`${prefix}-git-0`);
    expect(result.issueCounts).toEqual({ deploymentIssues: 1, domainIssues: 1, exportIssues: 1, gitIssues: 1 });
    const empty = await admin.getAdminOperations({ search: `${prefix}-missing`, onlyIssues: true });
    expect(empty.totals).toEqual({ deployments: 0, domains: 0, exports: 0, git: 0 });
  });
});

const delivery = vi.hoisted(() => ({ createJob: vi.fn() }));
vi.mock('@nibleaf/bullmq', async (original) => ({
  ...(await original<typeof import('@nibleaf/bullmq')>()),
  createJob: delivery.createJob,
}));
vi.mock('./sites', () => ({ invalidateOrganizationPublishedConfig: vi.fn() }));

// Real actions, Prisma transactions and PostgreSQL unique indexes; no mail or
// provider calls. Run only against an explicitly allocated disposable database.
describe.skipIf(process.env.ADMIN_POSTGRES !== '1')('admin invite address database boundary (#615)', () => {
  let db: typeof import('@nibleaf/database');
  let admin: typeof import('./admin');
  const adminId = '615-admin';
  const names = ['615-crowded', '615-race', '615-handle', '615-project', '615-unrelated', '615-exhausted', '615-delivery'];
  const errors: unknown[] = [];
  const uniqueIndexError = (modelName: string, table: string, index: string) =>
    expect.objectContaining({
      code: 'P2002',
      meta: expect.objectContaining({
        modelName,
        driverAdapterError: expect.objectContaining({
          cause: expect.objectContaining({ table, constraint: { index } }),
        }),
      }),
    });

  beforeAll(async () => {
    db = await import('@nibleaf/database');
    admin = await import('./admin');
    await db.prisma.user.create({ data: { id: adminId, name: 'Fictional administrator', email: '615-admin@example.test', role: 'admin' } });
  }, 120_000);
  beforeEach(() => {
    errors.length = 0;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    expect(delivery.createJob).not.toHaveBeenCalled();
  });
  afterAll(async () => {
    if (!db) return;
    // Delete only this fixture's organizations; projects must go first.
    const where = { name: { in: names } };
    const organizations = await db.prisma.organization.findMany({ where, select: { id: true } });
    await db.prisma.project.deleteMany({ where: { organizationId: { in: organizations.map(({ id }) => id) } } });
    await db.prisma.organization.deleteMany({ where });
    await db.prisma.user.deleteMany({ where: { id: adminId } });
    await db.prisma.$disconnect();
  }, 120_000);

  const invite = (name: string) =>
    admin.inviteOrganizationOwner(adminId, { organizationName: name, siteName: name, ownerEmail: `${name}@example.test`, delivery: 'link' });
  const seed = (name: string, slug: string) =>
    db.prisma.organization.create({ data: { name, projects: { create: { name, slug } } }, include: { projects: true } });
  const read = (name: string) =>
    db.prisma.organization.findMany({
      where: { name },
      include: {
        handles: true,
        usagePlan: { include: { plan: true } },
        members: true,
        invitations: true,
        projects: { include: { addons: true, languages: true, branches: true } },
      },
    });

  // Inject a competing committed write or intercept a create inside the real
  // transaction. The original Prisma callback still owns commit and rollback.
  const intercept = (hook: (tx: Prisma.TransactionClient) => Promise<void>) => {
    const transaction = db.prisma.$transaction.bind(db.prisma);
    vi.spyOn(db.prisma, '$transaction').mockImplementation(((callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
      transaction(async (tx) => {
        try {
          await hook(tx);
          return await callback(tx);
        } catch (error) {
          errors.push(error);
          throw error;
        }
      })) as typeof db.prisma.$transaction);
  };

  it('checks a fallback after all numbered addresses and the timestamp address are occupied', async () => {
    const name = '615-crowded';
    vi.spyOn(Date, 'now').mockReturnValue(1_795_132_800_000);
    const existing = await db.prisma.organization.create({
      data: {
        name,
        projects: {
          create: [
            ...Array.from({ length: 100 }, (_, index) => ({ name, slug: index === 0 ? name : `${name}-${index + 1}` })),
            { name, slug: `${name}-${Date.now().toString(36)}` },
          ],
        },
      },
    });
    const result = await invite(name);
    expect(result.slug).toMatch(/^615-crowded-[0-9a-f]{8}$/);
    expect(await db.prisma.project.count({ where: { organizationId: existing.id } })).toBe(101);
    expect(await db.prisma.project.findUnique({ where: { id: result.projectId } })).toMatchObject({ slug: result.slug });
  });

  it('rolls back and reallocates when two invites race at organization creation', async () => {
    const name = '615-race';
    let arrivals = 0;
    let release: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    intercept(async () => {
      if (++arrivals <= 2) {
        if (arrivals === 2) release();
        await ready;
      }
    });
    const settled = await Promise.allSettled([invite(name), invite(name)]);
    expect(errors).toContainEqual(uniqueIndexError('Organization', 'organization', 'organization_slug_key'));
    expect(settled.filter(({ status }) => status === 'fulfilled')).toHaveLength(2);
    const results = settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
    expect(new Set(results.map(({ slug }) => slug))).toEqual(new Set([name, `${name}-2`]));
    const stored = await read(name);
    expect(stored).toHaveLength(2);
    for (const organization of stored) {
      expect(organization.handles).toHaveLength(1);
      expect(organization.members).toHaveLength(0);
      expect(organization.invitations).toEqual([expect.objectContaining({ inviterId: adminId, orgRole: 'owner', kind: 'bootstrap_owner' })]);
      expect(organization.usagePlan?.plan.key).toBe('free');
      expect(organization.projects).toHaveLength(1);
      const project = organization.projects[0];
      expect(project?.dataTenantId).not.toBe(organization.id);
      expect(project?.addons).toHaveLength(addonDefinitions.length);
      expect(project?.languages).toHaveLength(1);
      expect(project?.branches).toHaveLength(1);
    }
  });

  it('reallocates a historical handle collision during nested organization creation', async () => {
    const name = '615-handle';
    let first = true;
    intercept(async () => {
      if (!first) return;
      first = false;
      await db.prisma.organization.create({ data: { name, handles: { create: { slug: `org-${name}`, current: false } } } });
    });
    const result = await invite(name);
    expect(result.slug).toBe(`${name}-2`);
    expect(errors).toContainEqual(uniqueIndexError('OrganizationHandle', 'organization_handle', 'organization_handle_pkey'));
    expect(await db.prisma.organizationHandle.findUnique({ where: { slug: `org-${name}` } })).toMatchObject({ current: false });
    expect(await db.prisma.organization.findUnique({ where: { slug: `org-${name}` } })).toBeNull();
    expect((await read(name)).flatMap(({ projects }) => projects)).toHaveLength(1);
  });

  it('rolls back the organization and plan after a project address collision, then stores one invitation', async () => {
    const name = '615-project';
    let first = true;
    intercept(async () => {
      if (!first) return;
      first = false;
      await seed(name, name);
    });
    const result = await invite(name);
    expect(result.slug).toBe(`${name}-2`);
    expect(errors).toContainEqual(uniqueIndexError('Project', 'project', 'project_slug_key'));
    expect(await db.prisma.organization.findUnique({ where: { slug: `org-${name}` } })).toBeNull();
    const stored = await read(name);
    expect(stored).toHaveLength(2); // competitor plus exactly one new boundary
    expect(stored.flatMap(({ invitations }) => invitations)).toHaveLength(1);
    expect(stored.find(({ id }) => id === result.organizationId)?.handles.map(({ slug }) => slug)).toEqual([`org-${name}-2`]);
    const competitor = stored.find(({ id }) => id !== result.organizationId);
    expect(competitor?.handles).toEqual([expect.objectContaining({ slug: competitor?.slug, current: true })]);
  });

  it('propagates an unrelated real P2002 and rolls back every attempted row', async () => {
    const name = '615-unrelated';
    const existing = await seed(name, '615-kept');
    let attempts = 0;
    intercept(async (tx) => {
      attempts++;
      const create = tx.project.create.bind(tx.project);
      vi.spyOn(tx.project, 'create').mockImplementation((args) =>
        create({ ...args, data: { ...args.data, dataTenantId: existing.projects[0]?.dataTenantId } }),
      );
    });
    await expect(invite(name)).rejects.toEqual(uniqueIndexError('Project', 'project', 'project_dataTenantId_key'));
    expect(attempts).toBe(1);
    expect(await db.prisma.organization.findUnique({ where: { slug: `org-${name}` } })).toBeNull();
    const stored = await read(name);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.projects[0]?.slug).toBe('615-kept');
    expect(stored[0]?.invitations).toHaveLength(0);
  });

  it('bounds repeated address races and preserves only the competing committed sites', async () => {
    const name = '615-exhausted';
    let attempts = 0;
    intercept(async () => {
      const slug = attempts++ === 0 ? name : `${name}-${attempts}`;
      await seed(name, slug);
    });
    await expect(invite(name)).rejects.toMatchObject({ code: 'database:conflict', details: { reason: 'slug_taken' } });
    expect(attempts).toBe(4);
    const stored = await read(name);
    expect(stored).toHaveLength(4);
    expect(stored.flatMap(({ projects }) => projects)).toHaveLength(4);
    expect(stored.flatMap(({ invitations }) => invitations)).toHaveLength(0);
    // The legacy-writer trigger registers each competitor's own current handle.
    // Those committed handles survive; none belongs to a rolled-back attempt.
    expect(stored.flatMap(({ handles }) => handles)).toHaveLength(4);
    for (const organization of stored) {
      expect(organization.handles).toEqual([expect.objectContaining({ slug: organization.slug, current: true })]);
    }
    expect(stored.filter(({ usagePlan }) => usagePlan)).toHaveLength(0);
  });

  it('never recreates after the invitation has committed and a later step throws', async () => {
    const name = '615-delivery';
    const members = await import('./members');
    const original = members.inviteMember;
    let creations = 0;
    intercept(async (tx) => {
      const create = tx.organization.create.bind(tx.organization);
      vi.spyOn(tx.organization, 'create').mockImplementation((args) => {
        creations++;
        return create(args);
      });
    });
    const failure = new db.Prisma.PrismaClientKnownRequestError('Synthetic post-commit failure', {
      code: 'P2002',
      clientVersion: 'fixture',
      meta: { modelName: 'Project', target: ['slug'] },
    });
    vi.spyOn(members, 'inviteMember').mockImplementationOnce(async (...args) => {
      const invitation = await original(...args);
      expect(await db.prisma.invitation.findUnique({ where: { id: invitation.id } })).not.toBeNull();
      throw failure;
    });
    await expect(invite(name)).rejects.toBe(failure);
    expect(creations).toBe(1);
    expect(await read(name)).toHaveLength(0);
  });
});
