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
  let access: typeof import('@/lib/access');
  const orgIds: string[] = [];
  const userIds: string[] = [];
  beforeAll(async () => {
    db = await import('@nibleaf/database');
    members = await import('./members');
    organizations = await import('./organizations');
    projects = await import('./projects');
    access = await import('@/lib/access');
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
    it('removing a legacy Admin from the only website keeps them in the org with no website and the least legacy role', async () => {
      const f = await legacyFixture();
      const { user, member } = await f.legacy('admin');
      await members.removeMember(f.organizationId, member.id, f.owner.id, f.site.id);
      // PR 3: an org member without websites is legitimate (design §5, §6.7); removal from the org stays explicit.
      expect(await row(f.organizationId, user.id)).toMatchObject({ role: 'viewer', orgRole: 'member', legacyWriter: false, projectGrants: [] });
      // The 404 invariant holds: no grant, no website.
      await expect(access.resolveSiteAccess(user.id, f.site.id)).rejects.toMatchObject({ status: 404 });
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
    it('allows an org member with zero websites, at the least legacy role and with no website access', async () => {
      const f = await legacyFixture();
      const { user, member } = await f.legacy('member');
      await organizations.replaceOrganizationMemberAccess(f.organizationId, f.owner.id, member.id, []);
      expect(await row(f.organizationId, user.id)).toMatchObject({ role: 'viewer', orgRole: 'member', projectGrants: [] });
      await expect(access.resolveSiteAccess(user.id, f.site.id)).rejects.toMatchObject({ status: 404 });

      const admin = await person();
      const orgAdmin = await db.prisma.member.create({
        data: { organizationId: f.organizationId, userId: admin.id, orgRole: 'admin', role: 'admin' },
      });
      await organizations.updateOrganizationMember(f.organizationId, f.owner.id, orgAdmin.id, { orgRole: 'member', grants: [] });
      expect(await row(f.organizationId, admin.id)).toMatchObject({ role: 'viewer', orgRole: 'member', projectGrants: [] });
      await expect(access.resolveSiteAccess(admin.id, f.site.id)).rejects.toMatchObject({ status: 404 });

      const invited = await organizations.inviteOrganizationMembers(
        f.organizationId,
        f.owner.id,
        { emails: ['zero@nibleaf.test'], orgRole: 'member', grants: [] },
        { sendEmail: false },
      );
      expect(invited.invitations).toHaveLength(1);
      expect(await db.prisma.invitationGrant.count({ where: { invitationId: invited.invitations[0]?.id } })).toBe(0);
    });
    it('a demotion without a website list keeps the dormant grants', async () => {
      const f = await legacyFixture();
      const user = await person();
      const member = await db.prisma.member.create({ data: { organizationId: f.organizationId, userId: user.id, orgRole: 'admin', role: 'admin' } });
      await db.prisma.projectMember.create({ data: { organizationId: f.organizationId, projectId: f.site.id, userId: user.id, role: 'member' } });
      await organizations.updateOrganizationMember(f.organizationId, f.owner.id, member.id, { orgRole: 'member' });
      expect(await row(f.organizationId, user.id)).toMatchObject({
        role: 'viewer',
        orgRole: 'member',
        projectGrants: [expect.objectContaining({ role: 'member' })],
      });
    });
  });

  /**
   * Release rule: PR 1 (0a18349c) is the minimum supported rollback image. Its
   * resolver is pinned in `rollback-pr1-access.fixture.ts` and run here against
   * PR 3's writes: after any of them, rolling back to PR 1 must grant nothing
   * PR 3 doesn't (no website PR 3 hides, no higher role).
   */
  describe('the PR 1 floor grants nothing beyond PR 3 (pinned 0a18349c resolver)', () => {
    let pr1: typeof import('./rollback-pr1-access.fixture');
    let rbac: typeof import('@nibleaf/shared/rbac');
    beforeAll(async () => {
      pr1 = await import('./rollback-pr1-access.fixture');
      rbac = await import('@nibleaf/shared/rbac');
    });
    const role = async (resolve: (u: string, p: string) => Promise<{ role: string }>, userId: string, projectId: string) =>
      resolve(userId, projectId).then(
        (access) => access.role,
        (error: { status?: number }) => {
          if (error.status === 404) return null;
          throw error;
        },
      );
    /** For every website: PR 1 hides what PR 3 hides and never ranks higher; PR 1's listing ⊆ PR 3's. */
    const assertFloor = async (userId: string, organizationId: string, projectIds: string[]) => {
      for (const projectId of projectIds) {
        const now = await role(access.resolveSiteAccess, userId, projectId);
        const floor = await role(pr1.resolveSiteAccess, userId, projectId);
        if (now === null) expect(floor, `PR 1 must 404 ${projectId}`).toBeNull();
        else if (floor !== null) expect(rbac.rankOf(floor)).toBeLessThanOrEqual(rbac.rankOf(now));
      }
      const listedNow = await access.accessibleProjectIds(userId, organizationId);
      for (const id of await pr1.accessibleProjectIds(userId, organizationId)) expect(listedNow).toContain(id);
    };
    const twoWebsites = async () => {
      const owner = await person();
      const org = await organizations.createOrganization(owner.id, `Floor ${randomUUID().slice(0, 8)}`);
      orgIds.push(org.id);
      const w1 = await projects.createProject(owner.id, { name: `W1 ${randomUUID().slice(0, 8)}`, organizationId: org.id });
      const w2 = await projects.createProject(owner.id, { name: `W2 ${randomUUID().slice(0, 8)}`, organizationId: org.id });
      return { owner, org, sites: [w1.id, w2.id] as const };
    };

    it('a member reduced to zero websites, and one removed from their last website', async () => {
      const f = await twoWebsites();
      const a = await person();
      const am = await db.prisma.member.create({ data: { organizationId: f.org.id, userId: a.id, orgRole: 'member', role: 'viewer' } });
      await db.prisma.projectMember.create({ data: { organizationId: f.org.id, projectId: f.sites[0], userId: a.id, role: 'admin' } });
      await organizations.replaceOrganizationMemberAccess(f.org.id, f.owner.id, am.id, []);
      await assertFloor(a.id, f.org.id, [...f.sites]);
      expect(await pr1.accessibleProjectIds(a.id, f.org.id)).toEqual([]);

      const b = await person();
      const bm = await db.prisma.member.create({ data: { organizationId: f.org.id, userId: b.id, orgRole: 'member', role: 'viewer' } });
      await db.prisma.projectMember.create({ data: { organizationId: f.org.id, projectId: f.sites[1], userId: b.id, role: 'member' } });
      await members.removeMember(f.org.id, bm.id, f.owner.id, f.sites[1]);
      await assertFloor(b.id, f.org.id, [...f.sites]);
      expect(await pr1.accessibleProjectIds(b.id, f.org.id)).toEqual([]);
    });

    it('an accepted invitation with no website', async () => {
      const f = await twoWebsites();
      const admissions = await import('./admissions');
      const invitee = await person();
      const { invitations } = await organizations.inviteOrganizationMembers(
        f.org.id,
        f.owner.id,
        { emails: [invitee.email], orgRole: 'member', grants: [] },
        { sendEmail: false },
      );
      await admissions.admit(invitee.id, { invitationId: invitations[0]?.id ?? '' });
      await assertFloor(invitee.id, f.org.id, [...f.sites]);
      expect(await pr1.accessibleProjectIds(invitee.id, f.org.id)).toEqual([]);
    });

    it('post-merge sibling websites: a grant on one website never opens its sibling; demotion keeps exactly the chosen set', async () => {
      const f = await twoWebsites();
      const editor = await person();
      await db.prisma.member.create({ data: { organizationId: f.org.id, userId: editor.id, orgRole: 'member', role: 'viewer' } });
      await db.prisma.projectMember.create({ data: { organizationId: f.org.id, projectId: f.sites[0], userId: editor.id, role: 'member' } });
      await assertFloor(editor.id, f.org.id, [...f.sites]);
      await expect(pr1.resolveSiteAccess(editor.id, f.sites[1])).rejects.toMatchObject({ status: 404 });

      const admin = await person();
      const adm = await db.prisma.member.create({ data: { organizationId: f.org.id, userId: admin.id, orgRole: 'admin', role: 'admin' } });
      await organizations.updateOrganizationMember(f.org.id, f.owner.id, adm.id, {
        orgRole: 'member',
        grants: [{ projectId: f.sites[1], role: 'viewer' }],
      });
      await assertFloor(admin.id, f.org.id, [...f.sites]);
      expect(await pr1.accessibleProjectIds(admin.id, f.org.id)).toEqual([f.sites[1]]);
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
