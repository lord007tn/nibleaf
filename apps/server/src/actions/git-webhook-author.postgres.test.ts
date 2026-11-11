import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * A push-triggered publish is attributed to the org Owner by `orgRole`, never
 * the legacy `role` column, which can hold several `owner` rows (legacy data
 * flagged for repair, or the former owners of orgs merged by `org:merge`).
 */
describe.skipIf(process.env.GIT_WEBHOOK_SECRET_POSTGRES !== '1')('git webhook publish author on PostgreSQL', () => {
  let db: typeof import('@nibleaf/database');
  let webhook: typeof import('./git-webhook');
  const orgIds: string[] = [];
  const userIds: string[] = [];
  beforeAll(async () => {
    db = await import('@nibleaf/database');
    webhook = await import('./git-webhook');
  }, 120_000);
  afterAll(async () => {
    if (!db) return;
    await db.prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await db.prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await db.prisma.$disconnect();
  });
  const person = async () => {
    const id = `webhook-${randomUUID()}`;
    userIds.push(id);
    return db.prisma.user.create({ data: { id, name: 'Synthetic', email: `${id}@nibleaf.test`, emailVerified: true } });
  };
  const org = async () => {
    const id = `webhook-${randomUUID()}`;
    orgIds.push(id);
    return db.prisma.organization.create({ data: { id, name: 'Synthetic', slug: id, handles: { create: { slug: id, current: true } } } });
  };
  const member = async (organizationId: string, role: string, orgRole: string, minute: number) => {
    const user = await person();
    await db.prisma.member.create({
      data: { organizationId, userId: user.id, role, orgRole, createdAt: new Date(Date.UTC(2026, 0, 1, 0, minute)) },
    });
    return user;
  };

  it('picks the Owner by orgRole when several members carry the legacy owner role', async () => {
    const o = await org();
    // The earliest legacy "owner" is a former owner now holding orgRole member.
    await member(o.id, 'owner', 'member', 0);
    await member(o.id, 'owner', 'member', 1);
    const owner = await member(o.id, 'owner', 'owner', 2);
    await member(o.id, 'admin', 'admin', 3);
    expect(await webhook.webhookPublishAuthor(o.id)).toEqual({ userId: owner.id });
  });

  it('has no author for an org without an Owner (needs repair), never a legacy owner', async () => {
    const o = await org();
    await member(o.id, 'owner', 'member', 0);
    await member(o.id, 'admin', 'admin', 1);
    expect(await webhook.webhookPublishAuthor(o.id)).toBeNull();
  });
});
