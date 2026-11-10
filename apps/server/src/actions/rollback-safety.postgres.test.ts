import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/bullmq', async (original) => ({
  ...(await original<typeof import('@nibleaf/bullmq')>()),
  createJob: vi.fn(async () => undefined),
  getJob: vi.fn(async () => undefined),
  removeJob: vi.fn(async () => undefined),
  sendRequiredEmail: vi.fn(async () => undefined),
}));

/**
 * Council fixes for #415: a rollback to the previous release must never grant
 * more than the new model (design §10.1, "Rollback compatibility").
 */
describe.skipIf(process.env.ROLLBACK_SAFETY_INTEGRATION !== '1')('rollback safety of the expand release', () => {
  let db: typeof import('@nibleaf/database');
  let members: typeof import('./members');
  let organizations: typeof import('./organizations');
  let projects: typeof import('./projects');
  const orgIds: string[] = [];
  const userIds: string[] = [];
  beforeAll(async () => {
    db = await import('@nibleaf/database');
    members = await import('./members');
    organizations = await import('./organizations');
    projects = await import('./projects');
  }, 120_000);
  afterAll(async () => {
    // project → organization is Restrict from PR 2 on: websites go first.
    await db.prisma.project.deleteMany({ where: { organizationId: { in: orgIds } } });
    await db.prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await db.prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await db.prisma.$disconnect();
  });
  const person = async (role = 'user') => {
    const id = `rollback-${randomUUID()}`;
    userIds.push(id);
    return db.prisma.user.create({ data: { id, name: 'Synthetic', email: `${id}@nibleaf.test`, emailVerified: true, role } });
  };
  /** A one-website org whose people were written the way the previous release
   * (and the expand backfill) wrote them: only the legacy `role` column. */
  const legacyFixture = async () => {
    const owner = await person();
    const org = await organizations.createOrganization(owner.id, `Rollback ${randomUUID().slice(0, 8)}`);
    orgIds.push(org.id);
    const site = await projects.createProject(owner.id, { name: `Rollback ${randomUUID().slice(0, 8)}`, organizationId: org.id });
    const legacy = async (role: string) => {
      const user = await person();
      // No orgRole: the legacy-writer triggers derive orgRole + the site grant.
      const member = await db.prisma.member.create({ data: { organizationId: site.organizationId, userId: user.id, role } });
      return { user, member };
    };
    return { owner, site, organizationId: site.organizationId, legacy };
  };
  const row = (organizationId: string, userId: string) =>
    db.prisma.member.findUnique({ where: { organizationId_userId: { organizationId, userId } }, include: { projectGrants: true } });

  describe('legacy mirror follows demotion and removal (fix 1)', () => {
    it('a legacy Admin demoted to Viewer keeps no legacy Admin role', async () => {
      const f = await legacyFixture();
      const { user, member } = await f.legacy('admin');
      expect((await row(f.organizationId, user.id))?.projectGrants[0]?.role).toBe('admin');
      await members.updateMemberRole(f.organizationId, member.id, f.owner.id, { role: 'viewer' }, f.site.id);
      const after = await row(f.organizationId, user.id);
      expect(after).toMatchObject({ role: 'viewer', orgRole: 'member', legacyWriter: false });
      expect(after?.projectGrants.map((g) => g.role)).toEqual(['viewer']);
    });
    it('a legacy Admin demoted to Editor gets legacy member, never more', async () => {
      const f = await legacyFixture();
      const { user, member } = await f.legacy('admin');
      await members.updateMemberRole(f.organizationId, member.id, f.owner.id, { role: 'member' }, f.site.id);
      expect(await row(f.organizationId, user.id)).toMatchObject({ role: 'member', orgRole: 'member' });
    });
    it('a promotion never raises the legacy role', async () => {
      const f = await legacyFixture();
      const { user, member } = await f.legacy('viewer');
      await members.updateMemberRole(f.organizationId, member.id, f.owner.id, { role: 'admin' }, f.site.id);
      const after = await row(f.organizationId, user.id);
      expect(after?.role).toBe('viewer');
      expect(after?.projectGrants.map((g) => g.role)).toEqual(['admin']);
    });
    it('removing a legacy Admin from the only website deletes the legacy membership row', async () => {
      const f = await legacyFixture();
      const { user, member } = await f.legacy('admin');
      await members.removeMember(f.organizationId, member.id, f.owner.id, f.site.id);
      expect(await row(f.organizationId, user.id)).toBeNull();
      expect(await db.prisma.projectMember.count({ where: { userId: user.id } })).toBe(0);
    });
    it('org-level access changes keep the legacy role at or below the remaining grant', async () => {
      const f = await legacyFixture();
      const { user, member } = await f.legacy('admin');
      await organizations.replaceOrganizationMemberAccess(f.organizationId, f.owner.id, member.id, [{ projectId: f.site.id, role: 'viewer' }]);
      expect(await row(f.organizationId, user.id)).toMatchObject({ role: 'viewer', orgRole: 'member' });
    });
    it('an org Admin demoted to member gets the least legacy role', async () => {
      const f = await legacyFixture();
      const user = await person();
      const member = await db.prisma.member.create({ data: { organizationId: f.organizationId, userId: user.id, orgRole: 'admin', role: 'admin' } });
      await organizations.updateOrganizationMember(f.organizationId, f.owner.id, member.id, {
        orgRole: 'member',
        grants: [{ projectId: f.site.id, role: 'admin' }],
      });
      expect(await row(f.organizationId, user.id)).toMatchObject({ role: 'viewer', orgRole: 'member' });
    });
    it('refuses to leave an org member with zero websites', async () => {
      const f = await legacyFixture();
      const { member } = await f.legacy('member');
      await expect(organizations.replaceOrganizationMemberAccess(f.organizationId, f.owner.id, member.id, [])).rejects.toMatchObject({ status: 409 });
      const admin = await person();
      const orgAdmin = await db.prisma.member.create({
        data: { organizationId: f.organizationId, userId: admin.id, orgRole: 'admin', role: 'admin' },
      });
      await expect(
        organizations.updateOrganizationMember(f.organizationId, f.owner.id, orgAdmin.id, { orgRole: 'member', grants: [] }),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        organizations.inviteOrganizationMembers(
          f.organizationId,
          f.owner.id,
          { emails: ['zero@nibleaf.test'], orgRole: 'member', grants: [] },
          { sendEmail: false },
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(await db.prisma.invitation.count({ where: { organizationId: f.organizationId } })).toBe(0);
    });
  });

  describe('website data partitions (fix 4, PR 2 follow-up)', () => {
    it('a new website gets an independent partition, never its org id', async () => {
      const owner = await person();
      const org = await organizations.createOrganization(owner.id, `Partition ${randomUUID().slice(0, 8)}`);
      orgIds.push(org.id);
      const a = await projects.createProject(owner.id, { name: `A ${randomUUID().slice(0, 8)}`, organizationId: org.id });
      const b = await projects.createProject(owner.id, { name: `B ${randomUUID().slice(0, 8)}`, organizationId: org.id });
      expect(a.dataTenantId).not.toBe(org.id);
      expect(b.dataTenantId).not.toBe(org.id);
      expect(a.dataTenantId).not.toBe(b.dataTenantId);
    });
    it('platform-created websites get an independent partition too', async () => {
      const admin = await import('./admin');
      const staff = await person('admin');
      const created = await admin.inviteOrganizationOwner(staff.id, {
        organizationName: 'Synthetic org',
        siteName: `Platform ${randomUUID().slice(0, 8)}`,
        ownerEmail: `${randomUUID()}@nibleaf.test`,
        delivery: 'link',
      });
      orgIds.push(created.organizationId);
      const site = await db.prisma.project.findUniqueOrThrow({ where: { id: created.projectId } });
      expect(site.dataTenantId).not.toBe(created.organizationId);
    });
  });

  describe('an organization with a website cannot be deleted (fix 5, PR 2 follow-up)', () => {
    it('project → organization is ON DELETE RESTRICT', async () => {
      const [fk] = await db.prisma.$queryRaw<Array<{ action: string }>>`
        SELECT confdeltype::text AS action FROM pg_constraint WHERE conname = 'project_organizationId_fkey'`;
      expect(fk?.action).toBe('r');
    });
    it('a raw organization delete is refused while it holds a website', async () => {
      const f = await legacyFixture();
      await expect(db.prisma.$executeRaw`DELETE FROM organization WHERE id = ${f.organizationId}`).rejects.toThrow();
      expect(await db.prisma.project.count({ where: { id: f.site.id } })).toBe(1);
    });
    it('PR 1 erasure (the rollback target) still works: website first, then the org', async () => {
      const { eraseProjectOrganization } = await import('@nibleaf/auth/tenant-erasure');
      const f = await legacyFixture();
      await eraseProjectOrganization(f.organizationId, f.site.id);
      expect(await db.prisma.project.count({ where: { id: f.site.id } })).toBe(0);
      expect(await db.prisma.organization.count({ where: { id: f.organizationId } })).toBe(0);
    });
  });
});
