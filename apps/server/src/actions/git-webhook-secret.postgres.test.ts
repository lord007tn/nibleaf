import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe.skipIf(process.env.GIT_WEBHOOK_SECRET_POSTGRES !== '1')('website Git webhook secrets on PostgreSQL', () => {
  let db: typeof import('@nibleaf/database');
  let store: typeof import('./git-webhook-secret');
  const ids: string[] = [];
  beforeAll(async () => {
    db = await import('@nibleaf/database');
    store = await import('./git-webhook-secret');
  });
  afterAll(async () => {
    if (!db) return;
    await db.prisma.project.deleteMany({ where: { organizationId: { in: ids } } });
    await db.prisma.organization.deleteMany({ where: { id: { in: ids } } });
    await db.prisma.$disconnect();
  });
  it('dual-writes explicit rotation and preserves every byte of legacy metadata', async () => {
    const metadata = '{"note":"a\\u0000b","git":{"repo":"acme/docs"}}';
    const org = await db.prisma.organization.create({ data: { name: 'Synthetic secret test', metadata } });
    ids.push(org.id);
    const id = randomUUID();
    const project = await db.prisma.project.create({ data: { organizationId: org.id, name: id, slug: id } });
    const secret = await store.rotateGitWebhookSecret(project.id);
    expect(await store.getGitWebhookSecret(project.id)).toBe(secret);
    expect(await db.prisma.organizationGitWebhookSecret.findUnique({ where: { organizationId: org.id } })).toMatchObject({ secret });
    expect((await db.prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).metadata).toBe(metadata);
  });
});
