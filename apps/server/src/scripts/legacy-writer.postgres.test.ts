import { randomUUID } from 'node:crypto';
import { prisma } from '@nibleaf/database';
import { afterAll, describe, expect, it } from 'vitest';
import { resolveSiteAccess } from '../lib/access';

describe.skipIf(process.env.ORG_MERGE_INTEGRATION !== '1')('legacy insert and update sentinels', () => {
  const run = `legacy-trigger-${randomUUID().slice(0, 8)}`;
  const ids = [`${run}-a`, `${run}-b`, `${run}-c`];
  afterAll(async () => {
    if (process.env.ORG_MERGE_INTEGRATION !== '1') return;
    await prisma.project.deleteMany({ where: { organizationId: { in: ids } } });
    await prisma.organization.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: run } } });
    await prisma.$disconnect();
  });
  it('allocates handles, resolves missing role columns, catches role-only updates, and ignores explicit new writes', async () => {
    const org = ids[0] ?? '';
    const name = 'My fixture organization';
    await prisma.$executeRaw`INSERT INTO organization(id,name) VALUES(${org},${name})`;
    const row = await prisma.organization.findUniqueOrThrow({ where: { id: org } });
    expect(row.slug).toBe('my-fixture-organization');
    expect(await prisma.organizationHandle.findUnique({ where: { slug: row.slug } })).toMatchObject({ organizationId: org, current: true });
    const userIds = [`${run}-owner`, `${run}-viewer`, `${run}-explicit`, `${run}-second-owner`];
    for (const id of userIds) await prisma.user.create({ data: { id, name: id, email: `${id}@nibleaf.test` } });
    await prisma.$executeRaw`INSERT INTO member(id,"organizationId","userId",role) VALUES(${userIds[0]},${org},${userIds[0]},'owner')`;
    await prisma.$executeRaw`INSERT INTO member(id,"organizationId","userId",role) VALUES(${userIds[1]},${org},${userIds[1]},'viewer')`;
    await prisma.$executeRaw`INSERT INTO project(id,"organizationId",name,slug,"updatedAt") VALUES(${org},${org},'Fixture',${run},now())`;
    expect((await resolveSiteAccess(userIds[0] ?? '', org)).role).toBe('owner');
    expect((await resolveSiteAccess(userIds[1] ?? '', org)).role).toBe('viewer');
    await prisma.$executeRaw`INSERT INTO member(id,"organizationId","userId",role) VALUES(${userIds[3]},${org},${userIds[3]},'owner')`;
    expect((await resolveSiteAccess(userIds[3] ?? '', org)).role).toBe('admin');
    await prisma.member.create({ data: { id: userIds[2], organizationId: org, userId: userIds[2] ?? '', role: 'viewer', orgRole: 'member' } });
    await expect(resolveSiteAccess(userIds[2] ?? '', org)).rejects.toMatchObject({ status: 404 });
    await prisma.$executeRaw`UPDATE member SET role='admin' WHERE id=${userIds[2]}`;
    expect((await resolveSiteAccess(userIds[2] ?? '', org)).role).toBe('admin');
    // New code's explicit orgRole SET must disable the legacy role bridge even
    // when that value is unchanged. Its grant writer owns the grant transition.
    await prisma.member.update({ where: { id: userIds[2] }, data: { role: 'viewer', orgRole: 'member' } });
    expect((await resolveSiteAccess(userIds[2] ?? '', org)).role).toBe('admin');
    await prisma.$executeRaw`UPDATE member SET role='viewer' WHERE id=${userIds[2]}`;
    expect((await resolveSiteAccess(userIds[2] ?? '', org)).role).toBe('viewer');
    await prisma.member.delete({ where: { id: userIds[2] } });
    expect(await prisma.projectMember.count({ where: { userId: userIds[2] } })).toBe(0);
  });
  it('creates all grants for bulk old admissions, cancels zero-site admissions, and copies old setting edits', async () => {
    const org = ids[0] ?? '',
      zero = ids[1] ?? '',
      arabic = ids[2] ?? '';
    await prisma.$executeRaw`INSERT INTO organization(id,name) VALUES(${zero},'Zero'),(${arabic},'مؤسسة')`;
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: arabic } })).slug).toBe(`org-${arabic.slice(0, 6)}`);
    const owner = `${run}-owner`;
    await prisma.$executeRaw`INSERT INTO invitation(id,"organizationId",email,role,"expiresAt","inviterId") VALUES
      (${`${run}-i1`},${org},'first@nibleaf.test','admin',now()+interval '1 hour',${owner}),
      (${`${run}-i2`},${org},'second@nibleaf.test','viewer',now()+interval '1 hour',${owner}),
      (${`${run}-i3`},${zero},'zero@nibleaf.test','member',now()+interval '1 hour',${owner})`;
    expect(await prisma.invitationGrant.count({ where: { invitationId: { in: [`${run}-i1`, `${run}-i2`] } } })).toBe(2);
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: `${run}-i3` } })).status).toBe('canceled');
    await prisma.$executeRaw`INSERT INTO join_link(id,"organizationId","tokenHash",role,"updatedAt") VALUES
      (${`${run}-l1`},${org},${`${run}-hash1`},'viewer',now()),(${`${run}-l2`},${org},${`${run}-hash2`},'admin',now())`;
    expect(await prisma.joinLinkGrant.count({ where: { joinLinkId: { in: [`${run}-l1`, `${run}-l2`] } } })).toBe(2);
    const meta = JSON.stringify({ git: { repo: 'synthetic/updated' }, integrations: { fixture: true } });
    await prisma.organization.update({ where: { id: org }, data: { metadata: meta } });
    expect((await prisma.projectGitSettings.findUniqueOrThrow({ where: { projectId: org } })).settings).toEqual({ repo: 'synthetic/updated' });
    await prisma.organizationGitWebhookSecret.create({ data: { organizationId: org, secret: 'fictional-old-secret' } });
    expect((await prisma.projectGitWebhookSecret.findUniqueOrThrow({ where: { projectId: org } })).secret).toBe('fictional-old-secret');
    const unsupported = '{"note":"a\\u0000b","git":{"webhookSecret":"fictional"}}';
    await expect(prisma.organization.update({ where: { id: org }, data: { metadata: unsupported } })).resolves.toMatchObject({
      metadata: unsupported,
    });
    const explicit = await prisma.invitation.create({
      data: {
        organizationId: org,
        inviterId: owner,
        email: 'explicit@nibleaf.test',
        role: 'admin',
        kind: 'member',
        orgRole: 'member',
        expiresAt: new Date(),
      },
    });
    expect(await prisma.invitationGrant.count({ where: { invitationId: explicit.id } })).toBe(0);
    await prisma.$executeRaw`INSERT INTO usage_storage_marker("organizationId") VALUES(${org})`;
    expect(await prisma.usageStorageMarker.findUnique({ where: { organizationId: org } })).toMatchObject({ projectId: org, partitionId: org });
  });
});
