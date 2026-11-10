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
