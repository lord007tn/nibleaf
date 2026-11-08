import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Opt in only against a migrated test database. Every fixture is synthetic and
// cleanup is restricted to the exact organizations created by this suite.
describe.skipIf(process.env.GIT_WEBHOOK_SECRET_POSTGRES !== '1')('Git webhook secret storage in PostgreSQL', () => {
  let db: typeof import('@nibleaf/database');
  let store: typeof import('./git-webhook-secret');
  const organizationIds: string[] = [];

  beforeAll(async () => {
    db = await import('@nibleaf/database');
    store = await import('./git-webhook-secret');
  });
  afterAll(async () => {
    if (!db) return;
    try {
      await db.prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    } finally {
      await db.prisma.$disconnect();
    }
  });

  const organizationWith = async (metadata: unknown) => {
    const organization = await db.prisma.organization.create({
      data: { name: `webhook-secret-${randomUUID()}`, metadata: typeof metadata === 'string' ? metadata : JSON.stringify(metadata) },
    });
    organizationIds.push(organization.id);
    return organization.id;
  };
  const metadataOf = async (id: string) =>
    JSON.parse((await db.prisma.organization.findUniqueOrThrow({ where: { id }, select: { metadata: true } })).metadata ?? '{}');
  const storedSecret = async (organizationId: string) =>
    (await db.prisma.organizationGitWebhookSecret.findUnique({ where: { organizationId } }))?.secret ?? null;

  it('keeps a metadata write that lands between the read and the move', async () => {
    const id = await organizationWith({ plan: 'free', git: { repo: 'acme/docs', webhookSecret: 'legacy-secret' } });
    const read = await store.readGitWebhookSecret(id);
    // An admin saves Git settings (an older replica still carries the copy).
    await db.prisma.organization.update({
      where: { id },
      data: { metadata: JSON.stringify({ plan: 'free', git: { repo: 'acme/handbook', branch: 'docs', webhookSecret: 'legacy-secret' } }) },
    });
    await expect(store.settleGitWebhookSecret(read)).resolves.toBe('legacy-secret');

    expect(await metadataOf(id)).toEqual({ plan: 'free', git: { repo: 'acme/handbook', branch: 'docs' } });
    expect(await storedSecret(id)).toBe('legacy-secret');
  });

  it('removes a copy that differs from the stored secret and keeps the stored one', async () => {
    const id = await organizationWith({ git: { repo: 'acme/docs', webhookSecret: 'old-replica-secret' } });
    await db.prisma.organizationGitWebhookSecret.create({ data: { organizationId: id, secret: 'stored-secret' } });
    await expect(store.getGitWebhookSecret(id)).resolves.toBe('stored-secret');

    expect(await metadataOf(id)).toEqual({ git: { repo: 'acme/docs' } });
    expect(await storedSecret(id)).toBe('stored-secret');
  });

  // Valid JSON that PostgreSQL rejects as jsonb (a NUL escape and a lone surrogate).
  const uncastable = (secret: string) => `{"note":"a\\u0000b","label":"\\ud800","git":{"repo":"acme/docs","webhookSecret":"${secret}"}}`;

  it('moves a copy out of metadata PostgreSQL cannot cast to jsonb', async () => {
    const id = await organizationWith(uncastable('legacy-secret'));
    await expect(db.prisma.$queryRawUnsafe('SELECT metadata::jsonb FROM organization WHERE id = $1', id)).rejects.toThrow();
    await expect(store.getGitWebhookSecret(id)).resolves.toBe('legacy-secret');

    expect(await storedSecret(id)).toBe('legacy-secret');
    expect(await metadataOf(id)).toEqual({ note: 'a\u0000b', label: '\ud800', git: { repo: 'acme/docs' } });
  });

  it('rotates when the metadata cannot be cast to jsonb', async () => {
    const id = await organizationWith(uncastable('legacy-secret'));
    const secret = await store.rotateGitWebhookSecret(id);

    expect(await storedSecret(id)).toBe(secret);
    expect((await metadataOf(id)).git).toEqual({ repo: 'acme/docs' });
  });

  it('rotates without disturbing other metadata', async () => {
    const id = await organizationWith({ notifications: { member_joined: false }, git: { repo: 'acme/docs', webhookSecret: 'legacy-secret' } });
    const secret = await store.rotateGitWebhookSecret(id);

    expect(await storedSecret(id)).toBe(secret);
    expect(await metadataOf(id)).toEqual({ notifications: { member_joined: false }, git: { repo: 'acme/docs' } });
  });
});
