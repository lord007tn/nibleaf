import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

describe.skipIf(process.env.TENANT_FENCE_INTEGRATION !== '1')('tenant fences with the real PostgreSQL adapter', () => {
  let database: typeof import('./index');
  let organizationId: string;
  let projectId: string;

  beforeAll(async () => {
    database = await import('./index');
  });
  beforeEach(async () => {
    organizationId = `fence-org-${randomUUID()}`;
    projectId = `fence-project-${randomUUID()}`;
    await database.prisma.organization.create({
      data: { id: organizationId, name: 'Synthetic fence test', projects: { create: { id: projectId, name: 'Synthetic', slug: projectId } } },
    });
  });
  afterEach(async () => {
    await database.prisma.organization.deleteMany({ where: { id: organizationId } });
  });
  afterAll(async () => {
    await database.prisma.$disconnect();
  });

  it('establishes a deletion fence and allows relational erasure without void deserialization', async () => {
    await expect(database.beginUsageDeletion(organizationId, projectId)).resolves.toEqual({
      exists: true,
      hadStorageMarker: false,
      pendingCount: 0,
    });
    expect((await database.prisma.usageStorageMarker.findUnique({ where: { organizationId } }))?.deletionPendingAt).toBeInstanceOf(Date);
    await database.prisma.organization.delete({ where: { id: organizationId } });
    expect(await database.prisma.project.findUnique({ where: { id: projectId } })).toBeNull();
  });

  it('holds the shared lock through an analytics write and fences subsequent writes', async () => {
    let release: () => void = () => undefined;
    let entered: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const writer = database.runWithTenantAnalyticsWriteFence(organizationId, projectId, null, async () => {
      entered();
      await held;
      return 'written';
    });
    // A rejected writer must settle the handshake as well, so regressions cannot hang the test.
    const outcome = writer.then(
      (value) => ({ value }),
      (error: unknown) => {
        entered();
        return { error };
      },
    );
    try {
      await started;
      const lock = await database.prisma.$transaction(
        (tx) => tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_xact_lock(hashtextextended(${organizationId}, 904711)) AS locked
      `,
      );
      expect(lock[0]?.locked).toBe(false);
    } finally {
      release();
    }
    expect(await outcome).toEqual({ value: { accepted: true, value: 'written' } });
    await database.beginUsageDeletion(organizationId, projectId);
    let called = false;
    expect(
      await database.runWithTenantAnalyticsWriteFence(organizationId, projectId, null, async () => {
        called = true;
      }),
    ).toEqual({ accepted: false, value: null });
    expect(called).toBe(false);
  });

  it('releases a failed write transaction so deletion can proceed', async () => {
    await expect(
      database.runWithTenantAnalyticsWriteFence(organizationId, projectId, null, async () => {
        throw new Error('Synthetic write failure');
      }),
    ).rejects.toThrow('Synthetic write failure');
    await expect(database.beginUsageDeletion(organizationId, projectId)).resolves.toMatchObject({ exists: true, pendingCount: 0 });
  });
});
