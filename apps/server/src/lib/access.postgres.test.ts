import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { MemberRole } from '@nibleaf/shared/constants';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe.skipIf(process.env.ORG_ACCESS_INTEGRATION !== '1')('organization grants on PostgreSQL', () => {
  let db: typeof import('@nibleaf/database');
  let access: typeof import('./access');
  const run = `org-access-${randomUUID()}`;
  const orgIds = [`${run}-a`, `${run}-b`] as const;
  const userIds = [`${run}-0`, `${run}-1`, `${run}-2`, `${run}-3`, `${run}-4`, `${run}-5`] as const;
  const siteIds = [`${run}-p`, `${run}-sibling`, `${run}-other`] as const;

  beforeAll(async () => {
    db = await import('@nibleaf/database');
    access = await import('./access');
    for (const id of orgIds) await db.prisma.organization.create({ data: { id, name: id, slug: id } });
    for (const id of userIds) await db.prisma.user.create({ data: { id, name: id, email: `${id}@nibleaf.test` } });
    for (const [i, id] of siteIds.entries())
      await db.prisma.project.create({ data: { id, name: id, slug: id, organizationId: orgIds[i === 2 ? 1 : 0] } });
    for (const [i, id] of userIds.entries())
      await db.prisma.member.create({
        data: { id, organizationId: orgIds[0], userId: id, role: 'viewer', orgRole: i === 0 ? 'owner' : i === 1 ? 'admin' : 'member' },
      });
    for (const [i, role] of ['admin', 'member', 'viewer'].entries())
      await db.prisma.projectMember.create({ data: { organizationId: orgIds[0], projectId: siteIds[0], userId: userIds[i + 2] ?? '', role } });
  });

  afterAll(async () => {
    if (!db) return;
    await db.prisma.notification.deleteMany({ where: { projectId: { in: [...siteIds] } } });
    await db.prisma.project.deleteMany({ where: { id: { in: [...siteIds] } } });
    await db.prisma.organization.deleteMany({ where: { id: { in: [...orgIds] } } });
    await db.prisma.user.deleteMany({ where: { id: { in: [...userIds] } } });
    await db.prisma.$disconnect();
  });

  it('resolves inherited and granted roles, hiding ungranted siblings and other orgs', async () => {
    for (const [i, role] of ['owner', 'admin', 'admin', 'member', 'viewer'].entries()) {
      expect((await access.resolveSiteAccess(userIds[i] ?? '', siteIds[0])).role).toBe(role);
      expect(await access.accessibleProjectIds(userIds[i] ?? '', orgIds[0])).toEqual(i < 2 ? siteIds.slice(0, 2) : [siteIds[0]]);
      await expect(access.resolveSiteAccess(userIds[i] ?? '', siteIds[2])).rejects.toMatchObject({ status: 404 });
    }
    await expect(access.resolveSiteAccess(userIds[5], siteIds[0])).rejects.toMatchObject({ status: 404 });
    await expect(access.resolveSiteAccess(userIds[4], siteIds[1])).rejects.toMatchObject({ status: 404 });
    await expect(access.resolveOrgAccess(userIds[4], orgIds[1])).rejects.toMatchObject({ status: 404 });
  });

  it('limits People and prefix suggestions to administered websites while supporting exact org-member email', async () => {
    const people = await import('../actions/people');
    const result = await people.listPeople(userIds[2]);
    expect(result.sites.map((site) => site.projectId)).toEqual([siteIds[0]]);
    expect(result.people.map((person) => person.user.id).sort()).toEqual(userIds.slice(0, 5).sort());
    expect(await people.suggestPeopleToInvite(userIds[2], orgIds[0], run, siteIds[0])).toEqual([]);
    expect((await people.suggestPeopleToInvite(userIds[2], orgIds[0], `${userIds[5]}@nibleaf.test`, siteIds[0])).map((user) => user.id)).toEqual([
      userIds[5],
    ]);
  });

  it('checks account existence, banning and suspension', async () => {
    await expect(access.assertUsableAccount('missing')).rejects.toMatchObject({ code: 'auth:invalid_session' });
    for (const data of [{ banned: true }, { banned: false, suspendedAt: new Date() }]) {
      await db.prisma.user.update({ where: { id: userIds[5] }, data });
      await expect(access.assertUsableAccount(userIds[5])).rejects.toMatchObject({ code: 'auth:invalid_session' });
    }
  });

  it('authorizes organizations from the path, keeping site admins out of org administration and fencing repairs', async () => {
    const guards = await import('../middlewares/guard');
    const runGuard = async (userId: string, required: MemberRole, organizationId: string = orgIds[0], method = 'GET') => {
      const values = new Map<string, unknown>([
        ['user', { id: userId }],
        ['organizationId', orgIds[1]],
      ]);
      let passed = false;
      await guards.requireOrgRole(required)(
        {
          get: (key: string) => values.get(key),
          set: (key: string, value: unknown) => values.set(key, value),
          req: { param: () => organizationId, method },
        } as never,
        async () => {
          passed = true;
        },
      );
      return { passed, membership: values.get('membership') };
    };
    expect(await runGuard(userIds[0], MemberRole.ADMIN)).toMatchObject({ passed: true, membership: { organizationId: orgIds[0], role: 'owner' } });
    await expect(runGuard(userIds[2], MemberRole.ADMIN)).rejects.toMatchObject({ code: 'auth:insufficient_role' });
    await expect(runGuard(userIds[0], MemberRole.MEMBER, orgIds[1])).rejects.toMatchObject({ status: 404 });
    await db.prisma.organization.update({ where: { id: orgIds[0] }, data: { needsRepair: true } });
    await expect(runGuard(userIds[1], MemberRole.ADMIN, orgIds[0], 'POST')).rejects.toMatchObject({ status: 409 });
    await db.prisma.organization.update({ where: { id: orgIds[0] }, data: { needsRepair: false } });
  });

  it('enforces same-org grant parents, role checks, one owner and deletion restriction', async () => {
    const base = { organizationId: orgIds[0], userId: userIds[5], projectId: siteIds[0] };
    await expect(db.prisma.projectMember.create({ data: { ...base, projectId: siteIds[2], role: 'viewer' } })).rejects.toThrow();
    await expect(db.prisma.projectMember.create({ data: { ...base, role: 'owner' } })).rejects.toThrow();
    await expect(db.prisma.member.update({ where: { id: userIds[5] }, data: { orgRole: 'viewer' } })).rejects.toThrow();
    await expect(db.prisma.member.update({ where: { id: userIds[5] }, data: { orgRole: 'owner' } })).rejects.toThrow();
    await expect(db.prisma.organization.delete({ where: { id: orgIds[0] } })).rejects.toThrow();
    const invitation = await db.prisma.invitation.create({
      data: { organizationId: orgIds[0], email: `${run}@nibleaf.test`, inviterId: userIds[0], expiresAt: new Date(Date.now() + 60_000) },
    });
    const link = await db.prisma.joinLink.create({ data: { organizationId: orgIds[0], tokenHash: run } });
    await expect(
      db.prisma.invitationGrant.create({ data: { organizationId: orgIds[0], invitationId: invitation.id, projectId: siteIds[2], role: 'viewer' } }),
    ).rejects.toThrow();
    await expect(
      db.prisma.joinLinkGrant.create({ data: { organizationId: orgIds[1], joinLinkId: link.id, projectId: siteIds[2], role: 'viewer' } }),
    ).rejects.toThrow();
    await expect(db.prisma.invitation.update({ where: { id: invitation.id }, data: { orgRole: 'owner' } })).rejects.toThrow();
    await expect(db.prisma.joinLink.update({ where: { id: link.id }, data: { orgRole: 'admin' } })).rejects.toThrow();
    // Every organization gets its current handle on insert (legacy writers included).
    expect(await db.prisma.organizationHandle.count({ where: { organizationId: orgIds[0], current: true } })).toBe(1);
    await expect(
      db.prisma.organizationHandle.create({ data: { slug: `${run}-second-handle`, organizationId: orgIds[0], current: true } }),
    ).rejects.toThrow();
    const constraints = await db.prisma.$queryRaw<Array<{ condeferrable: boolean; condeferred: boolean }>>`
      SELECT condeferrable, condeferred FROM pg_constraint WHERE conrelid IN ('project_member'::regclass, 'invitation_grant'::regclass, 'join_link_grant'::regclass) AND contype = 'f'`;
    expect(constraints).toHaveLength(6);
    expect(constraints.every((row) => row.condeferrable && !row.condeferred)).toBe(true);
  });

  it('removing an org member cascades their grants', async () => {
    await db.prisma.member.delete({ where: { id: userIds[4] } });
    expect(await db.prisma.projectMember.count({ where: { userId: userIds[4] } })).toBe(0);
    await expect(access.resolveSiteAccess(userIds[4], siteIds[0])).rejects.toMatchObject({ status: 404 });
  });

  it('filters notification recipients, inbox pagination and unread counts by current site access', async () => {
    const notifications = await import('../actions/notifications');
    await notifications.createNotificationsForOrgMembers(siteIds[0], { type: 'test', title: 'Synthetic' });
    const rows = await db.prisma.notification.findMany({ where: { projectId: siteIds[0] }, select: { userId: true } });
    expect(rows.map((row) => row.userId).sort()).toEqual(userIds.slice(0, 4).sort());
    expect((await notifications.listNotifications(userIds[3])).items).toHaveLength(1);
    expect(await notifications.getUnreadNotificationCount(userIds[3])).toBe(1);
    await db.prisma.projectMember.delete({ where: { projectId_userId: { projectId: siteIds[0], userId: userIds[3] } } });
    expect((await notifications.listNotifications(userIds[3])).items).toHaveLength(0);
    expect(await notifications.getUnreadNotificationCount(userIds[3])).toBe(0);
  });

  it('backfills a seeded pre-migration schema without changing any legacy role bytes', async () => {
    const migrations = new URL('../../../../packages/database/prisma/migrations/', import.meta.url);
    const schema = `org_backfill_${randomUUID().replaceAll('-', '')}`;
    await db.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"; SET LOCAL search_path TO "${schema}"`);
        for (const name of (await readdir(migrations)).filter((name) => name < '20261110120000_organization_grants').sort()) {
          if (name === 'migration_lock.toml') continue;
          // Historical concurrent indexes are ordinary indexes in this isolated,
          // transactional schema; their definitions and all data DML are unchanged.
          await tx.$executeRawUnsafe(
            (await readFile(new URL(`${name}/migration.sql`, migrations), 'utf8'))
              .replace(/^BEGIN;$/m, '')
              .replace(/^COMMIT;$/m, '')
              .replaceAll('INDEX CONCURRENTLY', 'INDEX'),
          );
        }
        await tx.$executeRawUnsafe(`
        INSERT INTO "user" (id,name,email,"updatedAt") SELECT 'u'||n,'User '||n,'u'||n||'@nibleaf.test',now() FROM generate_series(1,8) n;
        INSERT INTO organization(id,name,slug,metadata,"createdAt") VALUES
          ('one','API',NULL,'{"notifications":{"project_deploy":false}}','2020-01-01'),
          ('zero','العربية',NULL,'{"notifications":{"project_deploy":true}}','2020-01-02'),
          ('multi','Same',NULL,'invalid json','2020-01-03'),('noowner','Same',NULL,NULL,'2020-01-04'),
          ('keep','Keep','same',NULL,'2020-01-05');
        INSERT INTO project(id,"organizationId",name,slug,"updatedAt") VALUES ('p','one','P','p',now()),('m','multi','M','m',now()),('n','noowner','N','n',now());
        INSERT INTO member(id,"organizationId","userId",role,"createdAt") VALUES
          ('a','one','u1','owner','2020-01-01'),('b','one','u2','admin','2020-01-02'),('c','one','u3','member','2020-01-03'),
          ('d','one','u4','viewer','2020-01-04'),('e','one','u5','UNKNOWN','2020-01-05'),
          ('f','zero','u1','owner','2020-01-01'),('g','zero','u2','admin','2020-01-02'),('h','zero','u4','viewer','2020-01-03'),
          ('i','multi','u6','owner','2020-01-01'),('j','multi','u7','owner','2020-01-02'),('k','noowner','u8','admin','2020-01-01');
        INSERT INTO invitation(id,"organizationId",email,role,"expiresAt","inviterId") VALUES
          ('invite','one','new@nibleaf.test','member',now()+interval '1 day','u1'),
          ('boot','one','owner@nibleaf.test','owner',now()+interval '1 day','u1'),
          ('empty','zero','none@nibleaf.test','admin',now()+interval '1 day','u1');
        INSERT INTO join_link(id,"organizationId","tokenHash",role,"updatedAt") VALUES ('link','one','hash','admin',now()),('empty','zero','hash2','viewer',now());
      `);
        const legacy = () => tx.$queryRaw<Array<{ kind: string; id: string; role: string | null }>>`
        SELECT 'member' AS kind, id, role FROM member UNION ALL SELECT 'invitation', id, role FROM invitation UNION ALL SELECT 'link', id, role FROM join_link ORDER BY kind,id`;
        const before = await legacy();
        const sql = await readFile(new URL('20261110120000_organization_grants/migration.sql', migrations), 'utf8');
        await tx.$executeRawUnsafe(
          sql
            .replace(/^BEGIN;$/m, '')
            .replace(/^COMMIT;$/m, '')
            .replaceAll('INDEX CONCURRENTLY', 'INDEX'),
        );
        expect(await legacy()).toEqual(before);
        expect(await tx.$queryRaw`SELECT id, "orgRole" FROM member ORDER BY id`).toEqual(
          'abcdefghijk'.split('').map((id) => ({ id, orgRole: ['a', 'f', 'i'].includes(id) ? 'owner' : 'member' })),
        );
        expect(await tx.$queryRaw`SELECT "userId", role FROM project_member ORDER BY "userId"`).toEqual([
          { userId: 'u2', role: 'admin' },
          { userId: 'u3', role: 'member' },
          { userId: 'u4', role: 'viewer' },
          { userId: 'u7', role: 'admin' },
          { userId: 'u8', role: 'admin' },
        ]);
        expect(await tx.$queryRaw`SELECT "needsRepair" FROM organization WHERE id = 'noowner'`).toEqual([{ needsRepair: true }]);
        expect(await tx.$queryRaw`SELECT kind, "orgRole" FROM invitation WHERE id = 'boot'`).toEqual([{ kind: 'bootstrap_owner', orgRole: 'owner' }]);
        expect(await tx.$queryRaw`SELECT status FROM invitation WHERE id = 'empty'`).toEqual([{ status: 'canceled' }]);
        expect(await tx.$queryRaw`SELECT "revokedAt" IS NOT NULL AS revoked FROM join_link WHERE id = 'empty'`).toEqual([{ revoked: true }]);
        expect(await tx.$queryRaw`SELECT "invitationId", role FROM invitation_grant`).toEqual([{ invitationId: 'invite', role: 'member' }]);
        expect(await tx.$queryRaw`SELECT "joinLinkId", role FROM join_link_grant`).toEqual([{ joinLinkId: 'link', role: 'admin' }]);
        expect(await tx.$queryRaw`SELECT id, slug FROM organization ORDER BY id`).toEqual([
          { id: 'keep', slug: 'same' },
          { id: 'multi', slug: 'same-2' },
          { id: 'noowner', slug: 'same-3' },
          { id: 'one', slug: 'org-one' },
          { id: 'zero', slug: 'org-zero' },
        ]);
        const prefs = await tx.$queryRaw<
          Array<{ userId: string; notifications: Record<string, boolean> }>
        >`SELECT "userId", notifications FROM user_preference`;
        expect(prefs.find((p) => p.userId === 'u3')?.notifications).toMatchObject({ project_deploy: false, security_login: true });
        expect(prefs.find((p) => p.userId === 'u2')?.notifications).toMatchObject({ project_deploy: true });
        await tx.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      },
      { timeout: 120_000 },
    );
  }, 130_000);
});
