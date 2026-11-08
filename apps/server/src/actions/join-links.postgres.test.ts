import { randomUUID } from 'node:crypto';
import { MemberRole } from '@nibleaf/shared/constants';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Admins get a "member joined" email; keep the queue out of this suite.
vi.mock('@nibleaf/bullmq', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@nibleaf/bullmq')>()),
  createJob: vi.fn(async () => undefined),
  sendRequiredEmail: vi.fn(async () => undefined),
}));

// Opt in only against a migrated test database. Every fixture is synthetic and
// cleanup is restricted to the exact IDs created by this suite.
describe.skipIf(process.env.JOIN_LINKS_INTEGRATION !== '1')('join links in PostgreSQL', () => {
  let db: typeof import('@nibleaf/database');
  let joinLinks: typeof import('./join-links');
  let auth: typeof import('@nibleaf/auth/join-links');
  let members: typeof import('./members');
  const organizationIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    db = await import('@nibleaf/database');
    joinLinks = await import('./join-links');
    auth = await import('@nibleaf/auth/join-links');
    members = await import('./members');
  }, 120_000);

  afterAll(async () => {
    if (!db) return;
    try {
      await db.prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
      await db.prisma.user.deleteMany({ where: { id: { in: userIds } } });
    } finally {
      await db.prisma.$disconnect();
    }
  });

  const person = async (label: string, { domain = 'nibleaf.test', verified = true } = {}) => {
    const user = await db.prisma.user.create({ data: { email: `${label}-${randomUUID()}@${domain}`, name: label, emailVerified: verified } });
    userIds.push(user.id);
    return user;
  };

  const site = async () => {
    const id = `join-${randomUUID()}`;
    const organization = await db.prisma.organization.create({ data: { name: id, slug: id } });
    organizationIds.push(organization.id);
    const project = await db.prisma.project.create({ data: { organizationId: organization.id, name: `Site ${id}`, slug: id } });
    const admin = await person('admin');
    await db.prisma.member.create({ data: { organizationId: organization.id, userId: admin.id, role: MemberRole.ADMIN } });
    return { organization, project, admin: { id: admin.id, role: MemberRole.ADMIN } };
  };

  it('lets a verified person join as the link role, records the use and stores only a hash', async () => {
    const { organization, project, admin } = await site();
    const created = await joinLinks.createJoinLink(organization.id, admin, { role: MemberRole.VIEWER, label: 'Support' });
    expect(created.url).toMatch(/\/join\/nlj_[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(created.link)).not.toContain(created.token);
    const row = await db.prisma.joinLink.findUniqueOrThrow({ where: { id: created.link.id } });
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(created.token.slice(4));

    expect(await joinLinks.getJoinLinkPreview(created.token)).toEqual({ siteName: project.name, role: MemberRole.VIEWER, allowedDomain: null });

    const joiner = await person('joiner');
    await expect(joinLinks.joinWithLink(created.token, joiner.id)).resolves.toEqual({
      status: 'joined',
      projectId: project.id,
      role: MemberRole.VIEWER,
    });
    const member = await db.prisma.member.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId: organization.id, userId: joiner.id } },
    });
    expect(member.role).toBe(MemberRole.VIEWER);
    const [listed] = await joinLinks.listJoinLinks(organization.id);
    expect(listed).toMatchObject({ useCount: 1, status: 'active', label: 'Support' });
    expect(listed?.uses.map((use) => use.email)).toEqual([joiner.email]);
  });

  it('tells an existing member they are already in, without using up the link', async () => {
    const { organization, admin } = await site();
    const { token, link } = await joinLinks.createJoinLink(organization.id, admin, { role: MemberRole.MEMBER, maxUses: 1 });
    await expect(joinLinks.joinWithLink(token, admin.id)).resolves.toMatchObject({ status: 'already_member', role: MemberRole.ADMIN });
    expect((await db.prisma.joinLink.findUniqueOrThrow({ where: { id: link.id } })).useCount).toBe(0);
  });

  it('never lets concurrent joins exceed max uses', async () => {
    const { organization, admin } = await site();
    const { token, link } = await joinLinks.createJoinLink(organization.id, admin, { role: MemberRole.MEMBER, maxUses: 3 });
    const people = await Promise.all(Array.from({ length: 10 }, (_, index) => person(`racer-${index}`)));
    const results = await Promise.allSettled(people.map((joiner) => joinLinks.joinWithLink(token, joiner.id)));
    const joined = results.filter((result) => result.status === 'fulfilled');
    const refused = results.filter((result) => result.status === 'rejected');
    expect(joined).toHaveLength(3);
    for (const result of refused) expect((result as PromiseRejectedResult).reason).toMatchObject({ code: 'join:invalid' });
    expect((await db.prisma.joinLink.findUniqueOrThrow({ where: { id: link.id } })).useCount).toBe(3);
    expect(await db.prisma.member.count({ where: { organizationId: organization.id, role: MemberRole.MEMBER } })).toBe(3);
    expect(await db.prisma.joinLinkUse.count({ where: { joinLinkId: link.id } })).toBe(3);
  });

  it('gives one answer for a bad, revoked, expired or used-up link', async () => {
    const { organization, admin } = await site();
    const revoked = await joinLinks.createJoinLink(organization.id, admin, { role: MemberRole.MEMBER });
    await joinLinks.revokeJoinLink(organization.id, revoked.link.id, admin);
    const expired = await joinLinks.createJoinLink(organization.id, admin, { role: MemberRole.MEMBER, expiresInDays: 1 });
    await db.prisma.joinLink.update({ where: { id: expired.link.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const usedUp = await joinLinks.createJoinLink(organization.id, admin, { role: MemberRole.MEMBER, maxUses: 1 });
    await joinLinks.joinWithLink(usedUp.token, (await person('first')).id);
    const joiner = await person('late');
    const tokens = ['not-a-token', `nlj_${'A'.repeat(43)}`, revoked.token, expired.token, usedUp.token];
    const answers = await Promise.all(
      tokens.flatMap((token) => [
        joinLinks.getJoinLinkPreview(token).then(
          () => 'ok',
          (error) => `${error.code}|${error.status}|${error.message}`,
        ),
        joinLinks.joinWithLink(token, joiner.id).then(
          () => 'ok',
          (error) => `${error.code}|${error.status}|${error.message}`,
        ),
      ]),
    );
    expect(new Set(answers)).toEqual(new Set(['join:invalid|404|This join link is not valid.']));
  });

  it('requires a verified address inside the allowed domain', async () => {
    const { organization, admin } = await site();
    const { token } = await joinLinks.createJoinLink(organization.id, admin, { role: MemberRole.MEMBER, allowedDomain: 'acme.example' });
    expect((await joinLinks.getJoinLinkPreview(token)).allowedDomain).toBe('acme.example');
    await expect(joinLinks.joinWithLink(token, (await person('outsider', { domain: 'other.example' })).id)).rejects.toMatchObject({
      code: 'join:domain_not_allowed',
    });
    await expect(joinLinks.joinWithLink(token, (await person('sub', { domain: 'eu.acme.example' })).id)).rejects.toMatchObject({
      code: 'join:domain_not_allowed',
    });
    await expect(joinLinks.joinWithLink(token, (await person('unverified', { domain: 'acme.example', verified: false })).id)).rejects.toMatchObject({
      code: 'join:email_unverified',
    });
    await expect(joinLinks.joinWithLink(token, (await person('insider', { domain: 'acme.example' })).id)).resolves.toMatchObject({
      status: 'joined',
    });
  });

  it('caps the granted role at the creator and never grants owner', async () => {
    const { organization } = await site();
    const editor = await person('editor');
    await db.prisma.member.create({ data: { organizationId: organization.id, userId: editor.id, role: MemberRole.MEMBER } });
    const asEditor = { id: editor.id, role: MemberRole.MEMBER };
    await expect(joinLinks.createJoinLink(organization.id, asEditor, { role: MemberRole.ADMIN })).rejects.toMatchObject({
      code: 'auth:insufficient_role',
    });
    await expect(
      joinLinks.createJoinLink(organization.id, { id: editor.id, role: MemberRole.OWNER }, { role: MemberRole.OWNER as never }),
    ).rejects.toMatchObject({ code: 'auth:insufficient_role' });
  });

  it('regenerates a token (the old one stops working) and keeps a disabled link disabled', async () => {
    const { organization, admin } = await site();
    const first = await joinLinks.createJoinLink(organization.id, admin, { role: MemberRole.VIEWER });
    const second = await joinLinks.regenerateJoinLink(organization.id, first.link.id, admin);
    expect(second.token).not.toBe(first.token);
    await expect(joinLinks.getJoinLinkPreview(first.token)).rejects.toMatchObject({ code: 'join:invalid' });
    await expect(joinLinks.getJoinLinkPreview(second.token)).resolves.toMatchObject({ role: MemberRole.VIEWER });
    await joinLinks.revokeJoinLink(organization.id, first.link.id, admin);
    await expect(joinLinks.regenerateJoinLink(organization.id, first.link.id, admin)).rejects.toMatchObject({ code: 'database:conflict' });
    // Another site's admin cannot touch it.
    const other = await site();
    await expect(joinLinks.revokeJoinLink(other.organization.id, first.link.id, other.admin)).rejects.toMatchObject({ code: 'database:not_found' });
  });

  it('skips the starter workspace only for a sign-up arriving through a link that admits it', async () => {
    const { organization, admin } = await site();
    const { token } = await joinLinks.createJoinLink(organization.id, admin, { role: MemberRole.MEMBER, allowedDomain: 'acme.example' });
    const cookie = (value: string) => new Headers({ cookie: `other=1; nibleaf_join=${value}` });
    await expect(auth.arrivingThroughJoinLink('new@acme.example', cookie(token))).resolves.toBe(true);
    await expect(auth.arrivingThroughJoinLink('new@other.example', cookie(token))).resolves.toBe(false);
    await expect(auth.arrivingThroughJoinLink('new@acme.example', cookie(`nlj_${'B'.repeat(43)}`))).resolves.toBe(false);
    await expect(auth.arrivingThroughJoinLink('new@acme.example', new Headers())).resolves.toBe(false);
  });

  /** A site with an owner and an admin; the admin makes an Admin link and a Viewer link. */
  const siteWithAdminLinks = async () => {
    const base = await site();
    const owner = await person('owner');
    await db.prisma.member.create({ data: { organizationId: base.organization.id, userId: owner.id, role: MemberRole.OWNER } });
    const adminLink = await joinLinks.createJoinLink(base.organization.id, base.admin, { role: MemberRole.ADMIN });
    const viewerLink = await joinLinks.createJoinLink(base.organization.id, base.admin, { role: MemberRole.VIEWER });
    const adminMember = await db.prisma.member.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId: base.organization.id, userId: base.admin.id } },
    });
    return { ...base, owner, adminLink, viewerLink, adminMemberId: adminMember.id };
  };
  const revokedAt = async (id: string) => (await db.prisma.joinLink.findUniqueOrThrow({ where: { id } })).revokedAt;

  it('disables every link of a removed member, in the same action, and refuses them at join', async () => {
    const { organization, owner, adminLink, viewerLink, adminMemberId } = await siteWithAdminLinks();
    await members.removeMember(organization.id, adminMemberId, owner.id);
    expect(await revokedAt(adminLink.link.id)).toBeInstanceOf(Date);
    expect(await revokedAt(viewerLink.link.id)).toBeInstanceOf(Date);
    // Not even from another account they control.
    const otherAccount = await person('second-account');
    for (const token of [adminLink.token, viewerLink.token]) {
      await expect(joinLinks.joinWithLink(token, otherAccount.id)).rejects.toMatchObject({ code: 'join:invalid', status: 404 });
    }
    expect(await db.prisma.member.count({ where: { organizationId: organization.id, userId: otherAccount.id } })).toBe(0);
  });

  it('disables only the links above a demoted member’s new role', async () => {
    const { organization, owner, adminLink, viewerLink, adminMemberId } = await siteWithAdminLinks();
    await members.updateMemberRole(organization.id, adminMemberId, owner.id, { role: MemberRole.MEMBER });
    expect(await revokedAt(adminLink.link.id)).toBeInstanceOf(Date);
    expect(await revokedAt(viewerLink.link.id)).toBeNull();
    await expect(joinLinks.getJoinLinkPreview(adminLink.token)).rejects.toMatchObject({ code: 'join:invalid' });
    await expect(joinLinks.joinWithLink(viewerLink.token, (await person('still-ok')).id)).resolves.toMatchObject({
      status: 'joined',
      role: MemberRole.VIEWER,
    });
  });

  it('refuses a link whose creator lost the role some other way (defense in depth)', async () => {
    const { organization, admin, adminLink } = await siteWithAdminLinks();
    // As if demoted or removed outside our actions (e.g. Better Auth's own endpoints).
    await db.prisma.member.update({
      where: { organizationId_userId: { organizationId: organization.id, userId: admin.id } },
      data: { role: MemberRole.VIEWER },
    });
    expect(await revokedAt(adminLink.link.id)).toBeNull();
    await expect(joinLinks.getJoinLinkPreview(adminLink.token)).rejects.toMatchObject({ code: 'join:invalid' });
    await expect(joinLinks.joinWithLink(adminLink.token, (await person('late')).id)).rejects.toMatchObject({ code: 'join:invalid' });
    const cookie = new Headers({ cookie: `nibleaf_join=${adminLink.token}` });
    await expect(auth.arrivingThroughJoinLink('new@nibleaf.test', cookie)).resolves.toBe(false);
    const listed = (await joinLinks.listJoinLinks(organization.id)).find((link) => link.id === adminLink.link.id);
    expect(listed?.status).toBe('revoked');
  });

  it('refuses every link of a deleted creator', async () => {
    const { admin, viewerLink } = await siteWithAdminLinks();
    await db.prisma.user.delete({ where: { id: admin.id } });
    expect((await db.prisma.joinLink.findUniqueOrThrow({ where: { id: viewerLink.link.id } })).createdById).toBeNull();
    await expect(joinLinks.getJoinLinkPreview(viewerLink.token)).rejects.toMatchObject({ code: 'join:invalid' });
    await expect(joinLinks.joinWithLink(viewerLink.token, (await person('after-delete')).id)).rejects.toMatchObject({ code: 'join:invalid' });
    await expect(auth.arrivingThroughJoinLink('new@nibleaf.test', new Headers({ cookie: `nibleaf_join=${viewerLink.token}` }))).resolves.toBe(false);
  });

  it('disables a deleted account’s links everywhere when the account deletion hook runs', async () => {
    const { admin, adminLink, viewerLink } = await siteWithAdminLinks();
    expect(await auth.revokeJoinLinksBeyondRole(db.prisma, null, admin.id, null)).toBe(2);
    expect(await revokedAt(adminLink.link.id)).toBeInstanceOf(Date);
    expect(await revokedAt(viewerLink.link.id)).toBeInstanceOf(Date);
  });

  it('keeps an owner transfer from leaving links above the new roles', async () => {
    const { organization, owner, adminMemberId, adminLink } = await siteWithAdminLinks();
    await members.transferOwnership(organization.id, owner.id, adminMemberId);
    // The new owner's Admin link still works; the former owner (now Admin) had none above Admin.
    await expect(joinLinks.getJoinLinkPreview(adminLink.token)).resolves.toMatchObject({ role: MemberRole.ADMIN });
  });
});
