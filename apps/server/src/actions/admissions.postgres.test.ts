import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/bullmq', async (original) => ({
  ...(await original<typeof import('@nibleaf/bullmq')>()),
  createJob: vi.fn(async () => undefined),
  sendRequiredEmail: vi.fn(async () => undefined),
}));

describe.skipIf(process.env.ADMISSION_INTEGRATION !== '1')('transactional organization admissions', () => {
  let db: typeof import('@nibleaf/database');
  let admissions: typeof import('./admissions');
  let organizations: typeof import('./organizations');
  let members: typeof import('./members');
  const orgIds: string[] = [];
  const userIds: string[] = [];
  beforeAll(async () => {
    db = await import('@nibleaf/database');
    admissions = await import('./admissions');
    organizations = await import('./organizations');
    members = await import('./members');
  }, 120_000);
  afterAll(async () => {
    await db.prisma.project.deleteMany({ where: { organizationId: { in: orgIds } } });
    await db.prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await db.prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await db.prisma.$disconnect();
  });
  const person = async (data: { emailVerified?: boolean; banned?: boolean; suspendedAt?: Date; role?: string } = {}) => {
    const id = `admission-${randomUUID()}`;
    const user = await db.prisma.user.create({ data: { id, name: 'Synthetic', email: `${id}@nibleaf.test`, emailVerified: true, ...data } });
    userIds.push(id);
    return user;
  };
  const fixture = async () => {
    const id = `admission-${randomUUID()}`;
    const org = await db.prisma.organization.create({
      data: { id, name: 'Synthetic organization', slug: id, handles: { create: { slug: id, current: true } } },
    });
    orgIds.push(id);
    const projects: Array<{ id: string; name: string }> = [];
    for (let i = 0; i < 2; i++)
      projects.push(await db.prisma.project.create({ data: { organizationId: id, name: `Website ${i}`, slug: `${id}-${i}` } }));
    const owner = await person();
    await db.prisma.member.create({ data: { organizationId: id, userId: owner.id, orgRole: 'owner', role: 'owner' } });
    return { org, projects, projectId: projects[0]?.id ?? '', owner };
  };
  const add = async (organizationId: string, userId: string, orgRole = 'member') =>
    db.prisma.member.create({ data: { organizationId, userId, orgRole, role: orgRole === 'member' ? 'viewer' : orgRole } });
  const invite = async (
    f: Awaited<ReturnType<typeof fixture>>,
    user: { email: string },
    orgRole: 'admin' | 'member' = 'member',
    grants = [{ projectId: f.projectId, role: 'member' }],
    issuerId = f.owner.id,
  ) =>
    db.prisma.invitation.create({
      data: {
        organizationId: f.org.id,
        inviterId: issuerId,
        email: user.email,
        orgRole,
        kind: 'member',
        role: 'viewer',
        expiresAt: new Date(Date.now() + 86_400_000),
        grants: { create: grants },
      },
    });
  const grantRoles = async (organizationId: string, userId: string) =>
    (await db.prisma.projectMember.findMany({ where: { organizationId, userId }, orderBy: { projectId: 'asc' } })).map((g) => [g.projectId, g.role]);

  for (const current of ['none', 'member', 'admin', 'owner'])
    for (const offered of ['member', 'admin'] as const) {
      it(`${current} accepting ${offered} follows the transition table without downgrading grants`, async () => {
        const f = await fixture();
        const user = current === 'owner' ? f.owner : await person();
        // Issue before membership is added: accepting an old invite must use current state.
        const invitation = await invite(f, user, offered);
        if (current !== 'none' && current !== 'owner') await add(f.org.id, user.id, current);
        if (current !== 'none')
          await db.prisma.projectMember.create({ data: { organizationId: f.org.id, projectId: f.projectId, userId: user.id, role: 'admin' } });
        const unrelated = await db.prisma.invitation.create({
          data: {
            organizationId: f.org.id,
            inviterId: f.owner.id,
            email: user.email,
            role: 'viewer',
            orgRole: 'member',
            kind: 'member',
            expiresAt: new Date(Date.now() + 86_400_000),
          },
        });
        const result = await admissions.admit(user.id, { invitationId: invitation.id });
        expect(result.organizationId).toBe(f.org.id);
        const member = await db.prisma.member.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: f.org.id, userId: user.id } } });
        const expected = current === 'owner' ? 'owner' : current === 'admin' || offered === 'admin' ? 'admin' : 'member';
        expect(member.orgRole).toBe(expected);
        expect(member.role).toBe(expected === 'member' ? 'viewer' : expected);
        expect(await grantRoles(f.org.id, user.id)).toEqual([[f.projectId, current === 'none' ? 'member' : 'admin']]);
        expect((await db.prisma.invitation.findUniqueOrThrow({ where: { id: unrelated.id } })).status).toBe('pending');
        expect(result.landing).toEqual(expected === 'member' ? { projectId: f.projectId } : { organization: f.org.slug });
        await expect(admissions.admit(user.id, { invitationId: invitation.id })).rejects.toMatchObject({ status: 404 });
      });
    }
  it('joins a grantless membership and lands in the organization', async () => {
    const f = await fixture();
    const user = await person();
    const invitation = await invite(f, user, 'member', []);
    expect((await admissions.admit(user.id, { invitationId: invitation.id })).landing).toEqual({ organization: f.org.slug });
  });
  it('normalizes invitation addresses and keeps unrelated grants on upgrade', async () => {
    const f = await fixture();
    const user = await person();
    const invitation = await invite(f, user);
    await db.prisma.invitation.update({ where: { id: invitation.id }, data: { email: ` ${user.email.toUpperCase()} ` } });
    await add(f.org.id, user.id);
    const other = f.projects[1];
    if (!other) throw new Error('Expected sibling');
    await db.prisma.projectMember.create({ data: { organizationId: f.org.id, userId: user.id, projectId: other.id, role: 'viewer' } });
    await admissions.admit(user.id, { invitationId: invitation.id });
    expect(await grantRoles(f.org.id, user.id)).toHaveLength(2);
  });
  it.each(['wrong-email', 'unverified', 'banned', 'suspended', 'expired', 'revoked', 'unknown'])(
    'refuses %s without membership or a claim',
    async (state) => {
      const f = await fixture();
      const user = await person();
      const invitation = await invite(f, user);
      if (state === 'wrong-email') await db.prisma.user.update({ where: { id: user.id }, data: { email: `other-${user.email}` } });
      if (state === 'unverified') await db.prisma.user.update({ where: { id: user.id }, data: { emailVerified: false } });
      if (state === 'banned') await db.prisma.user.update({ where: { id: user.id }, data: { banned: true } });
      if (state === 'suspended') await db.prisma.user.update({ where: { id: user.id }, data: { suspendedAt: new Date() } });
      if (state === 'expired') await db.prisma.invitation.update({ where: { id: invitation.id }, data: { expiresAt: new Date(0) } });
      if (state === 'revoked') await organizations.cancelOrganizationInvitation(f.org.id, f.owner.id, invitation.id);
      await expect(admissions.admit(user.id, { invitationId: state === 'unknown' ? 'missing' : invitation.id })).rejects.toBeDefined();
      expect(await db.prisma.member.count({ where: { organizationId: f.org.id, userId: user.id } })).toBe(0);
      expect((await db.prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).status).not.toBe('accepted');
    },
  );
  it.each(['demoted', 'removed', 'suspended', 'one-grant-lost'])('refuses the whole invitation when issuer is %s', async (state) => {
    const f = await fixture();
    const issuer = await person();
    const issuerMember = await add(f.org.id, issuer.id, 'admin');
    const user = await person();
    const grants = f.projects.map((p) => ({ projectId: p.id, role: 'member' }));
    const invitation = await invite(f, user, 'member', grants, issuer.id);
    if (state === 'suspended') await db.prisma.user.update({ where: { id: issuer.id }, data: { suspendedAt: new Date() } });
    else if (state === 'removed') await organizations.removeOrganizationMember(f.org.id, f.owner.id, issuerMember.id);
    else
      await organizations.updateOrganizationMember(f.org.id, f.owner.id, issuerMember.id, {
        orgRole: 'member',
        // "demoted" keeps one Viewer grant, so the issuer still opens the website but can no longer grant Editor.
        grants: state === 'one-grant-lost' ? [{ projectId: f.projectId, role: 'admin' }] : [{ projectId: f.projectId, role: 'viewer' }],
      });
    await expect(admissions.admit(user.id, { invitationId: invitation.id })).rejects.toMatchObject({ status: 404 });
    expect(await grantRoles(f.org.id, user.id)).toEqual([]);
  });
  it('serializes concurrent acceptance and issuer removal without partial grants', async () => {
    const f = await fixture();
    const issuer = await person();
    const member = await add(f.org.id, issuer.id, 'admin');
    const user = await person();
    const invitation = await invite(
      f,
      user,
      'member',
      f.projects.map((p) => ({ projectId: p.id, role: 'member' })),
      issuer.id,
    );
    const results = await Promise.allSettled([
      admissions.admit(user.id, { invitationId: invitation.id }),
      organizations.removeOrganizationMember(f.org.id, f.owner.id, member.id),
    ]);
    expect(results[1]?.status).toBe('fulfilled');
    const accepted = results[0]?.status === 'fulfilled';
    expect(await grantRoles(f.org.id, user.id)).toHaveLength(accepted ? 2 : 0);
    expect((await db.prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).status).toBe(accepted ? 'accepted' : 'canceled');
  });
  it('site admins can issue only grants they currently administer and lose the whole invitation on demotion', async () => {
    const f = await fixture();
    const issuer = await person();
    await add(f.org.id, issuer.id);
    await db.prisma.projectMember.create({ data: { organizationId: f.org.id, projectId: f.projectId, userId: issuer.id, role: 'admin' } });
    const user = await person();
    const result = await organizations.inviteOrganizationMembers(
      f.org.id,
      issuer.id,
      { emails: [user.email], orgRole: 'member', grants: [{ projectId: f.projectId, role: 'member' }] },
      { siteProjectId: f.projectId, sendEmail: false },
    );
    await db.prisma.projectMember.update({ where: { projectId_userId: { projectId: f.projectId, userId: issuer.id } }, data: { role: 'viewer' } });
    await expect(admissions.admit(user.id, { invitationId: result.invitations[0]?.id ?? '' })).rejects.toMatchObject({ status: 404 });
  });
  it('bootstrap claims exactly one owner under concurrent accepts and records the legacy mirror', async () => {
    const f = await fixture();
    await db.prisma.member.deleteMany({ where: { organizationId: f.org.id } });
    const staff = await person({ role: 'admin' });
    const users = [await person(), await person()];
    const invitations = await Promise.all(
      users.map((u) =>
        members.inviteMember(f.org.id, staff.id, 'owner', { email: u.email, role: 'owner' }, { bootstrapOwner: true, sendEmail: false }),
      ),
    );
    const results = await Promise.allSettled(users.map((u, i) => admissions.admit(u.id, { invitationId: invitations[i]?.id ?? '' })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.prisma.member.count({ where: { organizationId: f.org.id, orgRole: 'owner', role: 'owner' } })).toBe(1);
    expect(await db.prisma.invitation.count({ where: { organizationId: f.org.id, status: 'accepted' } })).toBe(1);
  });
  it('bootstrap issuance is platform-only and a populated owner invalidates it', async () => {
    const f = await fixture();
    const user = await person();
    await expect(
      members.inviteMember(f.org.id, user.id, 'owner', { email: user.email, role: 'owner' }, { bootstrapOwner: true }),
    ).rejects.toMatchObject({ status: 403 });
    const invitation = await db.prisma.invitation.create({
      data: {
        organizationId: f.org.id,
        inviterId: user.id,
        email: user.email,
        kind: 'bootstrap_owner',
        orgRole: 'owner',
        role: 'viewer',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    await expect(admissions.admit(user.id, { invitationId: invitation.id })).rejects.toMatchObject({ status: 404 });
  });

  for (const existing of [false, true])
    it(`maxUses=1 serializes concurrent joins, existing membership=${existing}`, async () => {
      const f = await fixture();
      const users = [await person(), await person()];
      if (existing) for (const u of users) await add(f.org.id, u.id);
      const { token, link } = await organizations.createOrganizationJoinLink(f.org.id, f.owner.id, {
        grants: [{ projectId: f.projectId, role: 'member' }],
        maxUses: 1,
      });
      const results = await Promise.allSettled(users.map((u) => admissions.admit(u.id, { token })));
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect((await db.prisma.joinLink.findUniqueOrThrow({ where: { id: link.id } })).useCount).toBe(1);
      expect(await db.prisma.joinLinkRedemption.count({ where: { joinLinkId: link.id } })).toBe(1);
      const winner = users.find((_u, i) => results[i]?.status === 'fulfilled');
      if (!winner) throw new Error('Expected winner');
      await admissions.admit(winner.id, { token });
      expect((await db.prisma.joinLink.findUniqueOrThrow({ where: { id: link.id } })).useCount).toBe(1);
    });
  it('upgrades a prior grant, counts another change after revocation of access, and leaves invitations pending', async () => {
    const f = await fixture();
    const user = await person();
    const invitation = await invite(f, user);
    const m = await add(f.org.id, user.id);
    await db.prisma.projectMember.create({ data: { organizationId: f.org.id, projectId: f.projectId, userId: user.id, role: 'viewer' } });
    const { token, link } = await organizations.createOrganizationJoinLink(f.org.id, f.owner.id, {
      grants: [{ projectId: f.projectId, role: 'admin' }],
    });
    await admissions.admit(user.id, { token });
    // Removing the last website keeps the person in the org with no website (PR 3, design §6.7).
    await members.removeMember(f.org.id, m.id, f.owner.id, f.projectId);
    expect(await grantRoles(f.org.id, user.id)).toEqual([]);
    expect(await db.prisma.member.count({ where: { organizationId: f.org.id, userId: user.id } })).toBe(1);
    await admissions.admit(user.id, { token });
    expect((await db.prisma.joinLink.findUniqueOrThrow({ where: { id: link.id } })).useCount).toBe(2);
    expect((await db.prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).status).toBe('pending');
  });
  it.each(['unverified', 'wrong-domain', 'revoked', 'expired', 'regenerated', 'issuer-removed', 'banned', 'unknown'])(
    'checks link %s for existing members too',
    async (state) => {
      const f = await fixture();
      const user = await person();
      await add(f.org.id, user.id);
      const { token, link } = await organizations.createOrganizationJoinLink(f.org.id, f.owner.id, {
        grants: [{ projectId: f.projectId, role: 'member' }],
      });
      if (state === 'unverified') await db.prisma.user.update({ where: { id: user.id }, data: { emailVerified: false } });
      if (state === 'banned') await db.prisma.user.update({ where: { id: user.id }, data: { banned: true } });
      if (state === 'wrong-domain') await db.prisma.joinLink.update({ where: { id: link.id }, data: { allowedDomain: 'elsewhere.test' } });
      if (state === 'expired') await db.prisma.joinLink.update({ where: { id: link.id }, data: { expiresAt: new Date(0) } });
      if (state === 'revoked') await organizations.changeOrganizationJoinLink(f.org.id, f.owner.id, link.id, false);
      if (state === 'regenerated') await organizations.changeOrganizationJoinLink(f.org.id, f.owner.id, link.id, true);
      if (state === 'issuer-removed') await db.prisma.member.deleteMany({ where: { organizationId: f.org.id, userId: f.owner.id } });
      await expect(admissions.admit(user.id, { token: state === 'unknown' ? 'nlj_invalid' : token })).rejects.toBeDefined();
      expect(await grantRoles(f.org.id, user.id)).toEqual([]);
      expect((await db.prisma.joinLink.findUniqueOrThrow({ where: { id: link.id } })).useCount).toBe(0);
    },
  );
  it.each(['invitation', 'link', 'access'])('cross-org project in %s body is 404 and writes nothing', async (kind) => {
    const f = await fixture();
    const other = await fixture();
    const user = await person();
    const m = await add(f.org.id, user.id);
    const grants = [{ projectId: other.projectId, role: 'admin' }];
    const operation =
      kind === 'invitation'
        ? organizations.inviteOrganizationMembers(f.org.id, f.owner.id, { emails: ['cross@nibleaf.test'], orgRole: 'member', grants })
        : kind === 'link'
          ? organizations.createOrganizationJoinLink(f.org.id, f.owner.id, { grants })
          : organizations.replaceOrganizationMemberAccess(f.org.id, f.owner.id, m.id, grants);
    await expect(operation).rejects.toMatchObject({ status: 404 });
    expect(await grantRoles(f.org.id, user.id)).toEqual([]);
  });
  it('website list and cancellation reveal and remove only that websites invitation part', async () => {
    const f = await fixture();
    const siteAdmin = await person();
    await add(f.org.id, siteAdmin.id);
    await db.prisma.projectMember.create({ data: { organizationId: f.org.id, projectId: f.projectId, userId: siteAdmin.id, role: 'admin' } });
    const user = await person();
    const invitation = await invite(
      f,
      user,
      'member',
      f.projects.map((p) => ({ projectId: p.id, role: 'viewer' })),
    );
    const list = await members.listMembers(f.org.id, f.projectId);
    expect(list.invitations).toHaveLength(1);
    expect(JSON.stringify(list.invitations)).not.toContain(f.projects[1]?.id ?? 'missing');
    expect(list.invitations[0]).not.toHaveProperty('grants');
    await expect(members.cancelInvitation(f.org.id, invitation.id, siteAdmin.id, f.projects[1]?.id)).rejects.toMatchObject({ status: 404 });
    await members.cancelInvitation(f.org.id, invitation.id, siteAdmin.id, f.projectId);
    expect((await db.prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).status).toBe('pending');
    expect(await db.prisma.invitationGrant.count({ where: { invitationId: invitation.id } })).toBe(1);
    expect((await members.listMembers(f.org.id, f.projectId)).invitations).toEqual([]);
  });
  it('existing email members get upgrades directly without an invitation; role demotion keeps exactly selected grants', async () => {
    const f = await fixture();
    const user = await person();
    const m = await add(f.org.id, user.id);
    const result = await organizations.inviteOrganizationMembers(f.org.id, f.owner.id, {
      emails: [user.email],
      orgRole: 'admin',
      grants: [{ projectId: f.projectId, role: 'admin' }],
    });
    expect(result.invitations).toEqual([]);
    expect(result.existingMembers).toEqual([{ userId: user.id, email: user.email, changed: true }]);
    // "None" is a valid answer to "Which websites can they still open?" (design §6.6).
    await organizations.updateOrganizationMember(f.org.id, f.owner.id, m.id, { orgRole: 'member', grants: [] });
    expect(await grantRoles(f.org.id, user.id)).toEqual([]);
    await organizations.updateOrganizationMember(f.org.id, f.owner.id, m.id, { orgRole: 'admin' });
    const kept = f.projects[1]?.id ?? '';
    await organizations.updateOrganizationMember(f.org.id, f.owner.id, m.id, { orgRole: 'member', grants: [{ projectId: kept, role: 'viewer' }] });
    expect(await grantRoles(f.org.id, user.id)).toEqual([[kept, 'viewer']]);
  });
  it.each(['needsRepair', 'deletionStartedAt'])('fences %s mutations and admissions', async (field) => {
    const f = await fixture();
    const user = await person();
    const invitation = await invite(f, user);
    await db.prisma.organization.update({
      where: { id: f.org.id },
      data: field === 'needsRepair' ? { needsRepair: true } : { deletionStartedAt: new Date() },
    });
    await expect(admissions.admit(user.id, { invitationId: invitation.id })).rejects.toMatchObject({ status: 409 });
    await expect(organizations.updateOrganization(f.org.id, f.owner.id, { name: 'Changed' })).rejects.toMatchObject({ status: 409 });
  });
  it('keeps a renamed handle as a members-only alias and transfers only to an organization admin', async () => {
    const f = await fixture();
    const user = await person();
    const m = await add(f.org.id, user.id);
    await expect(organizations.transferOrganizationOwnership(f.org.id, f.owner.id, m.id)).rejects.toMatchObject({ status: 409 });
    await organizations.updateOrganizationMember(f.org.id, f.owner.id, m.id, { orgRole: 'admin' });
    await organizations.transferOrganizationOwnership(f.org.id, f.owner.id, m.id);
    await organizations.updateOrganization(f.org.id, user.id, { slug: `${f.org.slug}-renamed` });
    expect((await organizations.organizationBySlug(user.id, f.org.slug)).slug).toBe(`${f.org.slug}-renamed`);
    await expect(organizations.organizationBySlug((await person()).id, f.org.slug)).rejects.toMatchObject({ status: 404 });
    await expect(organizations.removeOrganizationMember(f.org.id, user.id)).rejects.toMatchObject({ status: 403 });
  });
  it('accepts one invitation once under two concurrent requests', async () => {
    const f = await fixture();
    const user = await person();
    const invitation = await invite(f, user);
    const results = await Promise.allSettled([
      admissions.admit(user.id, { invitationId: invitation.id }),
      admissions.admit(user.id, { invitationId: invitation.id }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await grantRoles(f.org.id, user.id)).toEqual([[f.projectId, 'member']]);
  });
  it('public invitation information exposes only confirmation fields and named grants', async () => {
    const f = await fixture();
    const user = await person();
    const invitation = await invite(f, user);
    await db.prisma.organization.update({ where: { id: f.org.id }, data: { metadata: JSON.stringify({ secret: 'server-only-sentinel' }) } });
    const info = await members.getInvitationInfo(invitation.id);
    expect(Object.keys(info).sort()).toEqual(
      [
        'id',
        'email',
        'orgRole',
        'role',
        'organizationId',
        'organizationName',
        'organizationLogo',
        'inviterName',
        'grants',
        'status',
        'expired',
      ].sort(),
    );
    expect(info.grants).toEqual([{ projectId: f.projectId, name: 'Website 0', role: 'member' }]);
    expect(JSON.stringify(info)).not.toContain('server-only-sentinel');
  });
  it('revokes only outstanding invitations beyond a demoted site issuers current grants', async () => {
    const f = await fixture();
    const issuer = await person();
    const m = await add(f.org.id, issuer.id);
    await db.prisma.projectMember.create({ data: { organizationId: f.org.id, projectId: f.projectId, userId: issuer.id, role: 'admin' } });
    const high = await invite(f, await person(), 'member', [{ projectId: f.projectId, role: 'admin' }], issuer.id);
    const low = await invite(f, await person(), 'member', [{ projectId: f.projectId, role: 'viewer' }], issuer.id);
    await members.updateMemberRole(f.org.id, m.id, f.owner.id, { role: 'member' }, f.projectId);
    expect((await db.prisma.invitation.findUniqueOrThrow({ where: { id: high.id } })).status).toBe('canceled');
    expect((await db.prisma.invitation.findUniqueOrThrow({ where: { id: low.id } })).status).toBe('pending');
    await members.updateMemberRole(f.org.id, m.id, f.owner.id, { role: 'admin' }, f.projectId);
    expect((await db.prisma.invitation.findUniqueOrThrow({ where: { id: high.id } })).status).toBe('canceled');
  });

  it('adding an organization admin from a website writes no dormant grant', async () => {
    const f = await fixture();
    const user = await person();
    await add(f.org.id, user.id, 'admin');
    const result = await organizations.inviteOrganizationMembers(
      f.org.id,
      f.owner.id,
      { emails: [user.email], orgRole: 'member', grants: [{ projectId: f.projectId, role: 'viewer' }] },
      { siteProjectId: f.projectId, sendEmail: false },
    );
    expect(result.existingMembers[0]?.changed).toBe(false);
    expect(await grantRoles(f.org.id, user.id)).toEqual([]);
  });
  it('removing website access keeps organization membership and other website grants', async () => {
    const f = await fixture();
    const user = await person();
    const m = await add(f.org.id, user.id);
    await db.prisma.projectMember.createMany({
      data: f.projects.map((p) => ({ organizationId: f.org.id, projectId: p.id, userId: user.id, role: 'member' })),
    });
    await members.removeMember(f.org.id, m.id, f.owner.id, f.projectId);
    expect(await db.prisma.member.count({ where: { id: m.id } })).toBe(1);
    expect(await grantRoles(f.org.id, user.id)).toHaveLength(1);
  });
  it('concurrent handle claims cannot capture another organizations alias', async () => {
    const a = await fixture();
    const b = await fixture();
    const slug = `claim-${randomUUID()}`;
    const results = await Promise.allSettled([
      organizations.updateOrganization(a.org.id, a.owner.id, { slug }),
      organizations.updateOrganization(b.org.id, b.owner.id, { slug }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((r) => r.status === 'rejected');
    expect(refused).toMatchObject({ reason: { status: 409 } });
    const handle = await db.prisma.organizationHandle.findUniqueOrThrow({ where: { slug } });
    expect((await db.prisma.organization.findUniqueOrThrow({ where: { id: handle.organizationId } })).slug).toBe(slug);
  });
  it.each(['member', 'admin', 'owner'])('join links preserve %s and store upgrade-only dormant grants', async (orgRole) => {
    const f = await fixture();
    const user = orgRole === 'owner' ? f.owner : await person();
    if (orgRole !== 'owner') await add(f.org.id, user.id, orgRole);
    const { link, token } = await organizations.createOrganizationJoinLink(f.org.id, f.owner.id, {
      grants: [{ projectId: f.projectId, role: 'viewer' }],
    });
    const result = await admissions.admit(user.id, { token });
    expect(
      (await db.prisma.member.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: f.org.id, userId: user.id } } })).orgRole,
    ).toBe(orgRole);
    expect(await grantRoles(f.org.id, user.id)).toEqual([[f.projectId, 'viewer']]);
    expect(result.landing).toEqual(orgRole === 'member' ? { projectId: f.projectId } : { organization: f.org.slug });
    await admissions.admit(user.id, { token });
    expect((await db.prisma.joinLink.findUniqueOrThrow({ where: { id: link.id } })).useCount).toBe(1);
  });
  it('a first no-change redemption costs no use and still records the redemption', async () => {
    const f = await fixture();
    const user = await person();
    await add(f.org.id, user.id);
    await db.prisma.projectMember.create({ data: { organizationId: f.org.id, projectId: f.projectId, userId: user.id, role: 'admin' } });
    const { link, token } = await organizations.createOrganizationJoinLink(f.org.id, f.owner.id, {
      grants: [{ projectId: f.projectId, role: 'viewer' }],
      maxUses: 1,
    });
    await admissions.admit(user.id, { token });
    expect((await db.prisma.joinLink.findUniqueOrThrow({ where: { id: link.id } })).useCount).toBe(0);
    expect(await db.prisma.joinLinkRedemption.count({ where: { joinLinkId: link.id, userId: user.id } })).toBe(1);
    expect(await grantRoles(f.org.id, user.id)).toEqual([[f.projectId, 'admin']]);
  });
  describe('revoking an invitation that is no longer pending (WORKSPACE-09)', () => {
    for (const via of ['website', 'organization'] as const)
      it(`refuses an accepted invitation from the ${via} and leaves the membership alone`, async () => {
        const f = await fixture();
        const user = await person();
        const invitation = await invite(f, user, 'member', [{ projectId: f.projectId, role: 'viewer' }]);
        await admissions.admit(user.id, { invitationId: invitation.id });
        const revoke =
          via === 'website'
            ? members.cancelInvitation(f.org.id, invitation.id, f.owner.id, f.projectId)
            : organizations.cancelOrganizationInvitation(f.org.id, f.owner.id, invitation.id);
        await expect(revoke).rejects.toMatchObject({ status: 409, details: { reason: 'invitation_accepted' } });
        expect((await db.prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).status).toBe('accepted');
        expect(await db.prisma.invitationGrant.count({ where: { invitationId: invitation.id } })).toBe(1);
        expect(await grantRoles(f.org.id, user.id)).toEqual([[f.projectId, 'viewer']]);
      });
    it('refuses a canceled invitation and still revokes a pending one', async () => {
      const f = await fixture();
      const pending = await invite(f, await person(), 'member', [{ projectId: f.projectId, role: 'viewer' }]);
      await members.cancelInvitation(f.org.id, pending.id, f.owner.id, f.projectId);
      expect((await db.prisma.invitation.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('canceled');
      await expect(members.cancelInvitation(f.org.id, pending.id, f.owner.id, f.projectId)).rejects.toMatchObject({
        status: 409,
        details: { reason: 'invitation_not_pending' },
      });
    });
  });
});
