import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ beforeErase: null as null | (() => Promise<void>) }));

// No ClickHouse in this suite: erasure's partition deletes are recorded, not sent.
vi.mock('@nibleaf/clickhouse', async (original) => ({
  ...(await original<typeof import('@nibleaf/clickhouse')>()),
  deleteProjectAiConversations: vi.fn(async () => undefined),
  deleteProjectAnalytics: vi.fn(async () => undefined),
  deleteProjectUsage: vi.fn(async () => undefined),
}));
vi.mock('@nibleaf/bullmq', async (original) => ({
  ...(await original<typeof import('@nibleaf/bullmq')>()),
  createJob: vi.fn(async () => undefined),
  getJob: vi.fn(async () => undefined),
  removeJob: vi.fn(async () => undefined),
  sendRequiredEmail: vi.fn(async () => undefined),
}));
// Runs a hook exactly where the old code had a gap: after the owner's
// transaction committed and before the erasure starts.
vi.mock('@nibleaf/auth/tenant-erasure', async (original) => {
  const actual = await original<typeof import('@nibleaf/auth/tenant-erasure')>();
  return {
    ...actual,
    eraseOrganization: async (organizationId: string) => {
      const hook = hooks.beforeErase;
      hooks.beforeErase = null;
      if (hook) await hook();
      return actual.eraseOrganization(organizationId);
    },
  };
});

/**
 * Merge council on #418: organization deletion authorizes, fences and fixes
 * its website list in one transaction, and an interrupted deletion resumes.
 * Run with ORG_SHELL_INTEGRATION=1 and POSTGRES_URL pointing at a migrated DB.
 */
describe.skipIf(process.env.ORG_SHELL_INTEGRATION !== '1')('organization deletion on PostgreSQL', () => {
  let db: typeof import('@nibleaf/database');
  let orgs: typeof import('./organizations');
  let projects: typeof import('./projects');
  const orgIds: string[] = [];
  const userIds: string[] = [];
  beforeAll(async () => {
    db = await import('@nibleaf/database');
    orgs = await import('./organizations');
    projects = await import('./projects');
  }, 120_000);
  afterAll(async () => {
    if (!db) return;
    await db.prisma.usageIngestCheckpoint.deleteMany({ where: { organizationId: { in: orgIds } } });
    await db.prisma.project.deleteMany({ where: { organizationId: { in: orgIds } } });
    await db.prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await db.prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await db.prisma.$disconnect();
  });
  const person = async () => {
    const id = `orgdel-${randomUUID()}`;
    userIds.push(id);
    return db.prisma.user.create({ data: { id, name: 'Synthetic', email: `${id}@nibleaf.test`, emailVerified: true } });
  };
  /** A non-empty org: an Owner, an org Admin and two websites. */
  const fixture = async () => {
    const owner = await person();
    const org = await orgs.createOrganization(owner.id, `Doomed ${randomUUID().slice(0, 8)}`);
    orgIds.push(org.id);
    const admin = await person();
    const adminMember = await db.prisma.member.create({ data: { organizationId: org.id, userId: admin.id, orgRole: 'admin', role: 'admin' } });
    const a = await projects.createProject(owner.id, { name: `A ${randomUUID().slice(0, 8)}`, organizationId: org.id });
    const b = await projects.createProject(owner.id, { name: `B ${randomUUID().slice(0, 8)}`, organizationId: org.id });
    for (const project of [a, b]) {
      const branch = await db.prisma.branch.findFirstOrThrow({ where: { projectId: project.id, isDefault: true } });
      const language = await db.prisma.language.findFirstOrThrow({ where: { projectId: project.id, isDefault: true } });
      const page = await db.prisma.page.create({
        data: { projectId: project.id, branchId: branch.id, languageId: language.id, title: 'Private', slug: 'private', path: 'private' },
      });
      await db.prisma.pageRevision.create({
        data: {
          projectId: project.id,
          pageId: page.id,
          userId: owner.id,
          title: 'Private draft',
          content: 'Erase this history',
          contentBytes: 31,
          reason: 'autosave',
        },
      });
      await db.prisma.pageRevisionState.create({ data: { projectId: project.id, pageId: page.id, userId: owner.id, lastSavedAt: new Date() } });
    }
    const name = (await db.prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).name;
    const [first, second] = [a, b].sort((x, y) => x.id.localeCompare(y.id));
    return { owner, admin, adminMember, org, name, first: first ?? a, second: second ?? b };
  };
  const pendingIngestion = (organizationId: string, project: { id: string; dataTenantId: string }) =>
    db.prisma.usageIngestCheckpoint.create({
      data: {
        id: `pending-${randomUUID()}`,
        organizationId,
        partitionId: project.dataTenantId,
        projectId: project.id,
        firstOccurredAt: new Date(),
        lastOccurredAt: new Date(),
        events: [],
        payloadDigest: 'synthetic',
      },
    });

  it('fences and fixes the website list before the owner lock is released: a racing transfer or new website is refused', async () => {
    const f = await fixture();
    const racers: PromiseSettledResult<unknown>[] = [];
    hooks.beforeErase = async () => {
      racers.push(
        ...(await Promise.allSettled([
          orgs.transferOrganizationOwnership(f.org.id, f.owner.id, f.adminMember.id),
          projects.createProject(f.admin.id, { name: `Late ${randomUUID().slice(0, 8)}`, organizationId: f.org.id }),
        ])),
      );
    };
    await expect(orgs.deleteOrganization(f.org.id, f.owner.id, f.name)).resolves.toEqual({ id: f.org.id });
    expect(racers.map((result) => result.status)).toEqual(['rejected', 'rejected']);
    for (const result of racers) expect((result as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
    expect(await db.prisma.pageRevision.count({ where: { projectId: { in: [f.first.id, f.second.id] } } })).toBe(0);
    expect(await db.prisma.pageRevisionState.count({ where: { projectId: { in: [f.first.id, f.second.id] } } })).toBe(0);
    expect(await db.prisma.organization.count({ where: { id: f.org.id } })).toBe(0);
    expect(await db.prisma.project.count({ where: { organizationId: f.org.id } })).toBe(0);
  });

  it('resumes an interrupted deletion of a non-empty org: partial progress, then a successful retry', async () => {
    const f = await fixture();
    const pending = await pendingIngestion(f.org.id, f.second);
    await expect(orgs.deleteOrganization(f.org.id, f.owner.id, f.name)).rejects.toMatchObject({
      status: 409,
      details: { reason: 'usage_ingestion_pending' },
    });
    const fenced = await db.prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } });
    expect(fenced.deletionStartedAt).toBeInstanceOf(Date);
    expect([...fenced.deletionWebsiteIds].sort()).toEqual([f.first.id, f.second.id].sort());
    expect(await db.prisma.pageRevision.count({ where: { projectId: f.first.id } })).toBe(0);
    expect(await db.prisma.pageRevisionState.count({ where: { projectId: f.first.id } })).toBe(0);
    expect(await db.prisma.pageRevision.count({ where: { projectId: f.second.id } })).toBe(1);
    expect(await db.prisma.project.count({ where: { id: f.first.id } })).toBe(0);
    expect(await db.prisma.project.count({ where: { id: f.second.id } })).toBe(1);
    // Fenced: ordinary changes stay refused; only the deletion resumes.
    await expect(orgs.updateOrganization(f.org.id, f.owner.id, { name: 'Renamed' })).rejects.toMatchObject({ status: 409 });
    await expect(orgs.deleteOrganization(f.org.id, f.admin.id, f.name)).rejects.toMatchObject({ status: 403 });
    await db.prisma.usageIngestCheckpoint.update({ where: { id: pending.id }, data: { writtenAt: new Date() } });
    await expect(orgs.deleteOrganization(f.org.id, f.owner.id, f.name)).resolves.toEqual({ id: f.org.id });
    expect(await db.prisma.pageRevision.count({ where: { projectId: { in: [f.first.id, f.second.id] } } })).toBe(0);
    expect(await db.prisma.pageRevisionState.count({ where: { projectId: { in: [f.first.id, f.second.id] } } })).toBe(0);
    expect(await db.prisma.organization.count({ where: { id: f.org.id } })).toBe(0);
  });

  it('website deletion erases history and throttle rows while preserving its sibling', async () => {
    const f = await fixture();
    await projects.deleteProject(f.owner.id, f.org.id, f.first.id);
    expect(await db.prisma.pageRevision.count({ where: { projectId: f.first.id } })).toBe(0);
    expect(await db.prisma.pageRevisionState.count({ where: { projectId: f.first.id } })).toBe(0);
    expect(await db.prisma.pageRevision.count({ where: { projectId: f.second.id } })).toBe(1);
  });

  it('never erases a website that is not on the deletion list', async () => {
    const f = await fixture();
    await pendingIngestion(f.org.id, f.second);
    await expect(orgs.deleteOrganization(f.org.id, f.owner.id, f.name)).rejects.toMatchObject({ status: 409 });
    // Only a bug could add one to a fenced org; simulate it below the API.
    const stray = await db.prisma.project.create({ data: { organizationId: f.org.id, name: 'Stray', slug: `stray-${randomUUID()}` } });
    await expect(orgs.deleteOrganization(f.org.id, f.owner.id, f.name)).rejects.toMatchObject({
      status: 409,
      details: { reason: 'deletion_manifest_mismatch' },
    });
    expect(await db.prisma.project.count({ where: { id: stray.id } })).toBe(1);
    expect(await db.prisma.project.count({ where: { id: f.second.id } })).toBe(1);
  });
});
