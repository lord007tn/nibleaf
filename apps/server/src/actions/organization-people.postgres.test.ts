import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const jobs = vi.hoisted(() => ({ createJob: vi.fn(async (..._args: unknown[]) => undefined) }));
vi.mock('@nibleaf/bullmq', async (original) => ({
  ...(await original<typeof import('@nibleaf/bullmq')>()),
  createJob: jobs.createJob,
}));

/**
 * People management on the organization (PR 3, design §6.1–§6.7): pending
 * invitations, resend, members without websites, last activity.
 */
describe.skipIf(process.env.ORG_PEOPLE_INTEGRATION !== '1')('organization people management', () => {
  let db: typeof import('@nibleaf/database');
  let organizations: typeof import('./organizations');
  let members: typeof import('./members');
  let admissions: typeof import('./admissions');
  let access: typeof import('@/lib/access');
  const orgIds: string[] = [];
  const userIds: string[] = [];
  beforeAll(async () => {
    db = await import('@nibleaf/database');
    organizations = await import('./organizations');
    members = await import('./members');
    admissions = await import('./admissions');
    access = await import('@/lib/access');
  }, 120_000);
  afterAll(async () => {
    await db.prisma.project.deleteMany({ where: { organizationId: { in: orgIds } } });
    await db.prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await db.prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await db.prisma.$disconnect();
  });
  const person = async (name = 'Synthetic') => {
    const id = `people-${randomUUID()}`;
    userIds.push(id);
    return db.prisma.user.create({ data: { id, name, email: `${id}@example.test`, emailVerified: true } });
  };
  const fixture = async () => {
    const owner = await person('Owner');
    const org = await organizations.createOrganization(owner.id, `People ${randomUUID().slice(0, 8)}`);
    orgIds.push(org.id);
    const site = (name: string) => db.prisma.project.create({ data: { organizationId: org.id, name, slug: `${name}-${randomUUID().slice(0, 8)}` } });
    const [docs, api] = await Promise.all([site('docs'), site('api')]);
    return { owner, org, docs, api };
  };

  it('invites a person with no website; they join and open nothing (404) until granted', async () => {
    const f = await fixture();
    const invitee = await person('Invitee');
    const result = await organizations.inviteOrganizationMembers(
      f.org.id,
      f.owner.id,
      { emails: [invitee.email], orgRole: 'member', grants: [] },
      { sendEmail: false },
    );
    expect(result).toMatchObject({ emailed: false, existingMembers: [] });
    const invitationId = result.invitations[0]?.id ?? '';
    expect(await members.getInvitationInfo(invitationId)).toMatchObject({
      organizationId: f.org.id,
      inviterName: 'Owner',
      orgRole: 'member',
      grants: [],
      status: 'pending',
    });
    expect(await admissions.admit(invitee.id, { invitationId })).toEqual({ organizationId: f.org.id, landing: { organization: f.org.slug } });
    await expect(access.resolveSiteAccess(invitee.id, f.docs.id)).rejects.toMatchObject({ status: 404 });
    const listed = await organizations.listOrganizationMembers(f.org.id);
    expect(listed.find((m) => m.userId === invitee.id)).toMatchObject({ orgRole: 'member', projectGrants: [], lastActiveAt: null });
  });

  it('lists pending invitations with inviter and whole scope, newest first; not accepted or cancelled ones', async () => {
    const f = await fixture();
    const first = await organizations.inviteOrganizationMembers(
      f.org.id,
      f.owner.id,
      { emails: ['first@example.test'], orgRole: 'member', grants: [{ projectId: f.docs.id, role: 'member' }] },
      { sendEmail: false },
    );
    const second = await organizations.inviteOrganizationMembers(
      f.org.id,
      f.owner.id,
      { emails: ['second@example.test'], orgRole: 'admin', grants: [] },
      { sendEmail: false },
    );
    const cancelled = await organizations.inviteOrganizationMembers(
      f.org.id,
      f.owner.id,
      { emails: ['gone@example.test'], orgRole: 'member', grants: [{ projectId: f.api.id, role: 'viewer' }] },
      { sendEmail: false },
    );
    await organizations.cancelOrganizationInvitation(f.org.id, f.owner.id, cancelled.invitations[0]?.id ?? '');
    const list = await organizations.listOrganizationInvitations(f.org.id);
    expect(list.map((i) => i.email)).toEqual(['second@example.test', 'first@example.test']);
    expect(list[1]).toMatchObject({
      id: first.invitations[0]?.id,
      orgRole: 'member',
      inviter: { id: f.owner.id, name: 'Owner' },
      grants: [{ projectId: f.docs.id, role: 'member', project: { name: 'docs' } }],
    });
    expect(list[0]).toMatchObject({ id: second.invitations[0]?.id, orgRole: 'admin', grants: [] });
  });

  it('resends a pending invitation with a fresh expiry, and refuses an accepted one with 409', async () => {
    const f = await fixture();
    const invitee = await person('Late');
    const { invitations } = await organizations.inviteOrganizationMembers(
      f.org.id,
      f.owner.id,
      { emails: [invitee.email], orgRole: 'member', grants: [{ projectId: f.docs.id, role: 'viewer' }] },
      { sendEmail: false },
    );
    const id = invitations[0]?.id ?? '';
    await db.prisma.invitation.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    jobs.createJob.mockClear();
    const resent = await organizations.resendOrganizationInvitation(f.org.id, f.owner.id, id);
    expect(resent.emailed).toBe(true);
    expect(resent.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    expect(jobs.createJob).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(jobs.createJob.mock.calls[0])).toContain(invitee.email);
    await admissions.admit(invitee.id, { invitationId: id });
    await expect(organizations.resendOrganizationInvitation(f.org.id, f.owner.id, id)).rejects.toMatchObject({
      status: 409,
      details: { reason: 'invitation_accepted' },
    });
  });

  it('lets a site Admin resend only invitations to their website, and an org Member nothing', async () => {
    const f = await fixture();
    const siteAdmin = await person('Site admin');
    await db.prisma.member.create({ data: { organizationId: f.org.id, userId: siteAdmin.id, orgRole: 'member', role: 'viewer' } });
    await db.prisma.projectMember.create({ data: { organizationId: f.org.id, projectId: f.docs.id, userId: siteAdmin.id, role: 'admin' } });
    const docsInvite = await organizations.inviteOrganizationMembers(
      f.org.id,
      f.owner.id,
      { emails: ['docs@example.test'], orgRole: 'member', grants: [{ projectId: f.docs.id, role: 'member' }] },
      { sendEmail: false },
    );
    const apiInvite = await organizations.inviteOrganizationMembers(
      f.org.id,
      f.owner.id,
      { emails: ['api@example.test'], orgRole: 'member', grants: [{ projectId: f.api.id, role: 'member' }] },
      { sendEmail: false },
    );
    await expect(members.resendInvitation(f.org.id, docsInvite.invitations[0]?.id ?? '', siteAdmin.id, f.docs.id)).resolves.toMatchObject({
      id: docsInvite.invitations[0]?.id,
    });
    await expect(members.resendInvitation(f.org.id, apiInvite.invitations[0]?.id ?? '', siteAdmin.id, f.docs.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(organizations.resendOrganizationInvitation(f.org.id, siteAdmin.id, docsInvite.invitations[0]?.id ?? '')).rejects.toMatchObject({
      status: 403,
    });
    const site = await members.listMembers(f.org.id, f.docs.id);
    expect(site.invitations).toEqual([
      expect.objectContaining({ email: 'docs@example.test', role: 'member', inviter: { name: 'Owner', email: f.owner.email } }),
    ]);
  });

  it('removing the last website grant keeps the person in the org; removing them from the org is explicit', async () => {
    const f = await fixture();
    const user = await person('Editor');
    const member = await db.prisma.member.create({ data: { organizationId: f.org.id, userId: user.id, orgRole: 'member', role: 'viewer' } });
    await db.prisma.projectMember.create({ data: { organizationId: f.org.id, projectId: f.docs.id, userId: user.id, role: 'member' } });
    await members.removeMember(f.org.id, member.id, f.owner.id, f.docs.id);
    expect(await db.prisma.member.findUnique({ where: { id: member.id } })).toMatchObject({ orgRole: 'member', role: 'viewer' });
    await expect(access.resolveSiteAccess(user.id, f.docs.id)).rejects.toMatchObject({ status: 404 });
    await organizations.removeOrganizationMember(f.org.id, f.owner.id, member.id);
    expect(await db.prisma.member.findUnique({ where: { id: member.id } })).toBeNull();
  });

  it('suggests org members without websites to an org Owner, never by prefix to a site-only Admin', async () => {
    const f = await fixture();
    const people = await import('./people');
    const loner = await person('Zorro Nowebsite');
    await db.prisma.member.create({ data: { organizationId: f.org.id, userId: loner.id, orgRole: 'member', role: 'viewer' } });
    const siteAdmin = await person('Site admin');
    await db.prisma.member.create({ data: { organizationId: f.org.id, userId: siteAdmin.id, orgRole: 'member', role: 'viewer' } });
    await db.prisma.projectMember.create({ data: { organizationId: f.org.id, projectId: f.docs.id, userId: siteAdmin.id, role: 'admin' } });
    expect((await people.suggestPeopleToInvite(f.owner.id, f.org.id, 'Zorro', f.docs.id)).map((u) => u.id)).toEqual([loner.id]);
    expect(await people.suggestPeopleToInvite(siteAdmin.id, f.org.id, 'Zorro', f.docs.id)).toEqual([]);
    // An exact address still finds them for the site Admin (design §6.5).
    expect((await people.suggestPeopleToInvite(siteAdmin.id, f.org.id, loner.email, f.docs.id)).map((u) => u.id)).toEqual([loner.id]);
  });

  describe('council fixes on #441', () => {
    const siteAdminOf = async (f: Awaited<ReturnType<typeof fixture>>, projectId: string) => {
      const admin = await person('Site admin');
      await db.prisma.member.create({ data: { organizationId: f.org.id, userId: admin.id, orgRole: 'member', role: 'viewer' } });
      await db.prisma.projectMember.create({ data: { organizationId: f.org.id, projectId, userId: admin.id, role: 'admin' } });
      return admin;
    };

    it('deleting a join link keeps it as a tombstone with its admission history and who deleted it, from where', async () => {
      const f = await fixture();
      const links = await import('./join-links');
      const { link, token } = await organizations.createOrganizationJoinLink(f.org.id, f.owner.id, {
        grants: [{ projectId: f.docs.id, role: 'viewer' }],
      });
      const joiner = await person('Joiner');
      await admissions.admit(joiner.id, { token });
      await organizations.changeOrganizationJoinLink(f.org.id, f.owner.id, link.id, false);
      const before = Date.now();
      await organizations.deleteOrganizationJoinLink(f.org.id, f.owner.id, link.id);
      const row = await db.prisma.joinLink.findUniqueOrThrow({ where: { id: link.id } });
      expect(row).toMatchObject({ deletedById: f.owner.id, deletedScope: 'organization' });
      expect(row.deletedAt?.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(row.revokedAt).not.toBeNull();
      expect(await db.prisma.joinLinkUse.findMany({ where: { joinLinkId: link.id }, select: { userId: true } })).toEqual([{ userId: joiner.id }]);
      expect((await organizations.listOrganizationJoinLinks(f.org.id)).map((listed) => listed.id)).not.toContain(link.id);
      await expect(links.getJoinLinkPreview(token)).rejects.toMatchObject({ code: 'join:invalid' });
      await expect(organizations.deleteOrganizationJoinLink(f.org.id, f.owner.id, link.id)).rejects.toMatchObject({ status: 404 });
      await expect(organizations.changeOrganizationJoinLink(f.org.id, f.owner.id, link.id, true)).rejects.toMatchObject({ status: 404 });
    });

    it('a link that lost its creator is revoked when deleted, so even the PR 1 floor admits nobody', async () => {
      const f = await fixture();
      const creator = await siteAdminOf(f, f.docs.id);
      const { link } = await organizations.createOrganizationJoinLink(
        f.org.id,
        creator.id,
        { grants: [{ projectId: f.docs.id, role: 'viewer' }] },
        f.docs.id,
      );
      // The creator loses the grant without the revocation hook: the link is inactive but not revoked.
      await db.prisma.projectMember.deleteMany({ where: { userId: creator.id } });
      expect((await db.prisma.joinLink.findUniqueOrThrow({ where: { id: link.id } })).revokedAt).toBeNull();
      await organizations.deleteOrganizationJoinLink(f.org.id, f.owner.id, link.id);
      expect((await db.prisma.joinLink.findUniqueOrThrow({ where: { id: link.id } })).revokedAt).not.toBeNull();
    });

    it('denies deleting a join link of another organization or, from a website, of another website', async () => {
      const f = await fixture();
      const other = await fixture();
      const links = await import('./join-links');
      const { link: apiLink } = await organizations.createOrganizationJoinLink(f.org.id, f.owner.id, {
        grants: [{ projectId: f.api.id, role: 'viewer' }],
      });
      await organizations.changeOrganizationJoinLink(f.org.id, f.owner.id, apiLink.id, false);
      await expect(organizations.deleteOrganizationJoinLink(other.org.id, other.owner.id, apiLink.id)).rejects.toMatchObject({ status: 404 });
      await expect(organizations.deleteOrganizationJoinLink(f.org.id, other.owner.id, apiLink.id)).rejects.toMatchObject({ status: 404 });
      const docsAdmin = await siteAdminOf(f, f.docs.id);
      await expect(links.deleteJoinLink(f.org.id, apiLink.id, { id: docsAdmin.id, role: 'admin' }, f.docs.id)).rejects.toMatchObject({ status: 404 });
      await expect(organizations.deleteOrganizationJoinLink(f.org.id, docsAdmin.id, apiLink.id)).rejects.toMatchObject({ status: 403 });
      expect(await db.prisma.joinLink.findUniqueOrThrow({ where: { id: apiLink.id } })).toMatchObject({ deletedAt: null, deletedById: null });
    });

    it.each(['pending', 'accepted', 'canceled'] as const)(
      'an out-of-scope %s invitation is 404 to a site Admin for resend and revoke, and nothing changes',
      async (state) => {
        const f = await fixture();
        const docsAdmin = await siteAdminOf(f, f.docs.id);
        const invitee = await person('Elsewhere');
        const { invitations } = await organizations.inviteOrganizationMembers(
          f.org.id,
          f.owner.id,
          { emails: [invitee.email], orgRole: 'member', grants: [{ projectId: f.api.id, role: 'viewer' }] },
          { sendEmail: false },
        );
        const id = invitations[0]?.id ?? '';
        if (state === 'accepted') await admissions.admit(invitee.id, { invitationId: id });
        if (state === 'canceled') await organizations.cancelOrganizationInvitation(f.org.id, f.owner.id, id);
        const before = await db.prisma.invitation.findUniqueOrThrow({ where: { id }, include: { grants: true } });
        await expect(members.resendInvitation(f.org.id, id, docsAdmin.id, f.docs.id)).rejects.toMatchObject({ status: 404 });
        await expect(members.cancelInvitation(f.org.id, id, docsAdmin.id, f.docs.id)).rejects.toMatchObject({ status: 404 });
        expect(await db.prisma.invitation.findUniqueOrThrow({ where: { id }, include: { grants: true } })).toEqual(before);
      },
    );

    it('reports each recipient whose email could not be queued, and keeps their invitation', async () => {
      const f = await fixture();
      jobs.createJob.mockImplementation(async (...args: unknown[]) => {
        if (JSON.stringify(args).includes('broken@example.test')) throw new Error('queue down');
      });
      try {
        const partial = await organizations.inviteOrganizationMembers(f.org.id, f.owner.id, {
          emails: ['ok@example.test', 'broken@example.test'],
          orgRole: 'member',
          grants: [],
        });
        expect(partial.emailed).toBe(false);
        expect(partial.invitations.map((i) => [i.email, i.delivery])).toEqual([
          ['ok@example.test', 'queued'],
          ['broken@example.test', 'failed'],
        ]);
        expect(await db.prisma.invitation.count({ where: { organizationId: f.org.id, status: 'pending' } })).toBe(2);
        const broken = partial.invitations.find((i) => i.email === 'broken@example.test')?.id ?? '';
        await expect(organizations.resendOrganizationInvitation(f.org.id, f.owner.id, broken)).resolves.toMatchObject({
          delivery: 'failed',
          emailed: false,
        });

        jobs.createJob.mockRejectedValue(new Error('queue down'));
        const full = await organizations.inviteOrganizationMembers(f.org.id, f.owner.id, {
          emails: ['a@example.test', 'b@example.test'],
          orgRole: 'admin',
          grants: [],
        });
        expect(full.invitations.map((i) => i.delivery)).toEqual(['failed', 'failed']);
        expect(full.emailed).toBe(false);
        const site = await members.inviteMember(f.org.id, f.owner.id, 'owner', { email: 'c@example.test', role: 'viewer' }, { projectId: f.docs.id });
        expect(site).toMatchObject({ delivery: 'failed', emailed: false });
      } finally {
        jobs.createJob.mockReset();
        jobs.createJob.mockImplementation(async () => undefined);
      }
    });
  });

  it('reports last activity from the newest session', async () => {
    const f = await fixture();
    const at = new Date('2026-11-01T10:00:00.000Z');
    await db.prisma.session.create({
      data: { userId: f.owner.id, token: `t-${randomUUID()}`, expiresAt: new Date(Date.now() + 86_400_000), updatedAt: at },
    });
    await db.prisma.session.create({
      data: {
        userId: f.owner.id,
        token: `t-${randomUUID()}`,
        expiresAt: new Date(Date.now() + 86_400_000),
        updatedAt: new Date('2026-10-01T10:00:00.000Z'),
      },
    });
    const [owner] = await organizations.listOrganizationMembers(f.org.id);
    expect(owner?.lastActiveAt?.toISOString()).toBe(at.toISOString());
  });
});
