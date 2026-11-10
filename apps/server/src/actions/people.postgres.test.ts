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
      await db.prisma.project.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await db.prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
      await db.prisma.user.deleteMany({ where: { id: { in: userIds } } });
    } finally {
      await db.prisma.$disconnect();
    }
  });

  const person = async (name: string, email = `${name.toLowerCase().replace(/\s+/g, '.')}-${run}@nibleaf.test`) => {
    const user = await db.prisma.user.create({ data: { email, name, emailVerified: true } });
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
  const add = async (organizationId: string, userId: string, role: string) => {
    const member = await db.prisma.member.create({
      data: { organizationId, userId, orgRole: role === 'owner' ? 'owner' : 'member', role: role === 'owner' ? 'owner' : 'viewer' },
    });
    const project = await db.prisma.project.findFirstOrThrow({ where: { organizationId } });
    if (role !== 'owner') await db.prisma.projectMember.create({ data: { organizationId, projectId: project.id, userId, role } });
    return member;
  };

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
        role: 'viewer',
        orgRole: 'member',
        grants: { create: { projectId: administered.projectId, role: 'viewer' } },
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
    expect(await people.listPeople(viewer.id)).toEqual({ sites: [], people: [], total: 0, nextCursor: null, invitations: [], invitationsTotal: 0 });
  });

  it('pages through people in a stable order, without skipping or repeating anyone', async () => {
    const me = await person(`Pager ${run}`);
    const [big, other] = await Promise.all([site('big'), site('other')]);
    await add(big.organizationId, me.id, MemberRole.OWNER);
    await add(other.organizationId, me.id, MemberRole.ADMIN);
    // Same name twice: the email, then the id, keeps their order fixed.
    const names = ['Yara', 'Bo', 'Bo', 'Mona', 'Ali', 'Zoe', 'Kim'].map((name) => `${name} ${run}`);
    const created: Array<{ id: string }> = [];
    for (const [index, name] of names.entries()) {
      const user = await person(name, `pager-${index}-${run}@nibleaf.test`);
      created.push(user);
      await add(big.organizationId, user.id, MemberRole.VIEWER);
    }
    // On both sites: one person, both memberships.
    const onBoth = created[0];
    if (!onBoth) throw new Error('fixture missing');
    await add(other.organizationId, onBoth.id, MemberRole.MEMBER);

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await people.listPeople(me.id, { q: run, limit: 3, cursor });
      expect(page.total).toBe(names.length + 1);
      expect(page.people.length).toBeLessThanOrEqual(3);
      seen.push(...page.people.map((p) => p.user.id));
      cursor = page.nextCursor ?? undefined;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.sort()).toEqual([me.id, ...created.map((user) => user.id)].sort());

    const everyone = await people.listPeople(me.id, { q: run, limit: 100 });
    const order = everyone.people.map((p) => `${p.user.name}|${p.user.email}`);
    expect(order).toEqual([...order].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(
      everyone.people
        .find((p) => p.user.id === onBoth.id)
        ?.memberships.map((m) => m.projectId)
        .sort(),
    ).toEqual([big.projectId, other.projectId].sort());
  });

  it('searches names and emails in the database, ignoring case', async () => {
    const me = await person(`Seeker ${run}`);
    const here = await site('search');
    await add(here.organizationId, me.id, MemberRole.ADMIN);
    const hopper = await person(`Grace Hopper ${run}`);
    const lovelace = await person(`Ada Lovelace ${run}`);
    await add(here.organizationId, hopper.id, MemberRole.MEMBER);
    await add(here.organizationId, lovelace.id, MemberRole.MEMBER);

    const ids = async (q: string) => (await people.listPeople(me.id, { q })).people.map((p) => p.user.id).filter((id) => id !== me.id);
    expect(await ids('HOPPER')).toEqual([hopper.id]);
    expect(await ids(`ada.lovelace.${run}`)).toEqual([lovelace.id]);
    expect(await ids('nobody-matches-this')).toEqual([]);
    expect((await people.listPeople(me.id, { q: 'HOPPER' })).total).toBe(1);
  });

  it('lists only the most recent invitations, with their total, on the first page', async () => {
    const me = await person(`Inviter ${run}`);
    const here = await site('invites');
    await add(here.organizationId, me.id, MemberRole.OWNER);
    const extra = 2;
    await Promise.all(
      Array.from({ length: people.MAX_PEOPLE_INVITATIONS + extra }, (_, index) =>
        db.prisma.invitation.create({
          data: {
            organizationId: here.organizationId,
            email: `invitee-${index}-${run}@nibleaf.test`,
            role: 'viewer',
            orgRole: 'member',
            grants: { create: { projectId: here.projectId, role: 'viewer' } },
            status: 'pending',
            expiresAt: new Date(Date.now() + 86_400_000),
            inviterId: me.id,
            createdAt: new Date(Date.now() - index * 1000),
          },
        }),
      ),
    );
    const first = await people.listPeople(me.id, { limit: 1 });
    expect(first.invitations).toHaveLength(people.MAX_PEOPLE_INVITATIONS);
    expect(first.invitationsTotal).toBe(people.MAX_PEOPLE_INVITATIONS + extra);
    expect(first.invitations[0]?.email).toBe(`invitee-0-${run}@nibleaf.test`);
    expect((await people.listPeople(me.id, { q: `invitee-51-${run}` })).invitations.map((i) => i.email)).toEqual([`invitee-51-${run}@nibleaf.test`]);
    // Later pages carry people only.
    const second = await people.listPeople(me.id, { limit: 1, cursor: first.people[0]?.user.id });
    expect(second.invitations).toEqual([]);
  });
});
