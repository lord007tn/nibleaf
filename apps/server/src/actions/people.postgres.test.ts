import { randomUUID } from 'node:crypto';
import { MemberRole } from '@nibleaf/shared/constants';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Opt in only against a migrated test database. Every fixture is synthetic and
// cleanup is restricted to the exact IDs created by this suite.
describe.skipIf(process.env.PEOPLE_INTEGRATION !== '1')('People page and invite suggestions in PostgreSQL', () => {
  let db: typeof import('@nibleaf/database');
  let people: typeof import('./people');
  const organizationIds: string[] = [];
  const userIds: string[] = [];
  const run = randomUUID().slice(0, 8);

  beforeAll(async () => {
    db = await import('@nibleaf/database');
    people = await import('./people');
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

  const person = async (name: string) => {
    const user = await db.prisma.user.create({
      data: { email: `${name.toLowerCase().replace(/\s+/g, '.')}-${run}@nibleaf.test`, name, emailVerified: true },
    });
    userIds.push(user.id);
    return user;
  };
  const site = async (label: string) => {
    const id = `people-${label}-${randomUUID()}`;
    const organization = await db.prisma.organization.create({ data: { name: id, slug: id } });
    organizationIds.push(organization.id);
    const project = await db.prisma.project.create({ data: { organizationId: organization.id, name: `${label} ${run}`, slug: id } });
    return { organizationId: organization.id, projectId: project.id };
  };
  const add = (organizationId: string, userId: string, role: string) => db.prisma.member.create({ data: { organizationId, userId, role } });

  it('lists only the sites the caller administers, with each person role per site, and suggests only from them', async () => {
    const me = await person('Ada Admin');
    const grace = await person('Grace Hopper');
    const linus = await person('Linus Editor');
    const secret = await person('Grace Secret');
    const [owned, administered, edited, foreign] = await Promise.all([site('owned'), site('administered'), site('edited'), site('foreign')]);
    await add(owned.organizationId, me.id, MemberRole.OWNER);
    await add(administered.organizationId, me.id, MemberRole.ADMIN);
    await add(edited.organizationId, me.id, MemberRole.MEMBER);
    await add(owned.organizationId, grace.id, MemberRole.VIEWER);
    await add(administered.organizationId, grace.id, MemberRole.MEMBER);
    await add(administered.organizationId, linus.id, MemberRole.MEMBER);
    // Only on sites I don't administer: must never appear.
    await add(edited.organizationId, secret.id, MemberRole.ADMIN);
    await add(foreign.organizationId, secret.id, MemberRole.OWNER);
    await db.prisma.invitation.create({
      data: {
        organizationId: administered.organizationId,
        email: `pending-${run}@nibleaf.test`,
        role: MemberRole.VIEWER,
        status: 'pending',
        expiresAt: new Date(Date.now() + 86_400_000),
        inviterId: me.id,
      },
    });

    const result = await people.listPeople(me.id);
    expect(result.sites.map((s) => s.projectId).sort()).toEqual([owned.projectId, administered.projectId].sort());
    expect(result.sites.find((s) => s.projectId === owned.projectId)?.myRole).toBe(MemberRole.OWNER);
    const byId = new Map(result.people.map((p) => [p.user.id, p.memberships]));
    expect(byId.has(secret.id)).toBe(false);
    expect(
      byId
        .get(grace.id)
        ?.map((m) => [m.projectId, m.role])
        .sort(),
    ).toEqual(
      [
        [owned.projectId, MemberRole.VIEWER],
        [administered.projectId, MemberRole.MEMBER],
      ].sort(),
    );
    expect(
      byId
        .get(me.id)
        ?.map((m) => m.projectId)
        .sort(),
    ).toEqual([owned.projectId, administered.projectId].sort());
    expect(result.invitations).toEqual([
      expect.objectContaining({ email: `pending-${run}@nibleaf.test`, projectId: administered.projectId, role: MemberRole.VIEWER }),
    ]);

    // Inviting into "owned": Linus is on my other administered site → suggested by
    // name, word or email prefix. Grace is already on "owned" → not suggested.
    // "Grace Secret" is only on sites I don't administer → never suggested.
    const ids = async (q: string) => (await people.suggestPeopleToInvite(me.id, owned.organizationId, q)).map((u) => u.id);
    expect(await ids('lin')).toEqual([linus.id]);
    expect(await ids('EDIT')).toEqual([linus.id]);
    expect(await ids(`linus.editor-${run}`)).toEqual([linus.id]);
    expect(await ids('grace')).toEqual([]);
    expect(await ids('secret')).toEqual([]);
    expect(await ids('ada')).toEqual([]);
    expect(await ids('  ')).toEqual([]);
    // Someone who administers no other site gets nothing.
    expect(await people.suggestPeopleToInvite(grace.id, owned.organizationId, 'lin')).toEqual([]);
  });

  it('caps suggestions', async () => {
    const me = await person('Cap Admin');
    const [here, there] = await Promise.all([site('here'), site('there')]);
    await add(here.organizationId, me.id, MemberRole.ADMIN);
    await add(there.organizationId, me.id, MemberRole.ADMIN);
    for (let index = 0; index < people.MAX_INVITE_SUGGESTIONS + 3; index++) {
      await add(there.organizationId, (await person(`Zed ${index}`)).id, MemberRole.VIEWER);
    }
    expect(await people.suggestPeopleToInvite(me.id, here.organizationId, 'zed')).toHaveLength(people.MAX_INVITE_SUGGESTIONS);
  });

  it('shows nothing to someone who administers no site', async () => {
    const viewer = await person('Only Viewer');
    const somewhere = await site('somewhere');
    await add(somewhere.organizationId, viewer.id, MemberRole.VIEWER);
    expect(await people.listPeople(viewer.id)).toEqual({ sites: [], people: [], invitations: [] });
  });
});
