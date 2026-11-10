import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({ headObject: vi.fn(), deleteObject: vi.fn(), deleteObjects: vi.fn(), presignPutUrl: vi.fn() }));
vi.mock('@nibleaf/storage', async (importOriginal) => ({
  StorageDeleteError: (await importOriginal<typeof import('@nibleaf/storage')>()).StorageDeleteError,
  UPLOAD_PRESIGN_EXPIRES_IN_SECONDS: 600,
  ...storage,
  putObject: vi.fn(),
  isNotFound: () => false,
}));
vi.mock('./projects', () => ({ assertProjectInOrg: vi.fn() }));

// Opt in against an already migrated disposable database. Storage is synthetic; no provider objects are touched.
describe.skipIf(process.env.ASSET_UPLOADS_POSTGRES !== '1')('pending asset uploads in PostgreSQL', () => {
  let db: typeof import('@nibleaf/database');
  let actions: typeof import('./assets');
  let sweeper: { sweepPendingAssetUploads(now?: Date): Promise<number>; sweepAssetUploadTombstones(now?: Date): Promise<number> };
  const organizationIds: string[] = [];

  beforeAll(async () => {
    db = await import('@nibleaf/database');
    const [target] = await db.prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
    // The sweeper processes every pending upload in the database, so the suite
    // only runs against a test database with no pending uploads or tombstones of its own.
    if (
      !target?.name.includes('test') ||
      (await db.prisma.pendingAssetUpload.count()) !== 0 ||
      (await db.prisma.assetUploadTombstone.count()) !== 0
    ) {
      throw new Error('Pending-upload PostgreSQL tests require a test database with no pending uploads.');
    }
    actions = await import('./assets');
    const workerModule = new URL('../../../worker/src/pending-asset-uploads.ts', import.meta.url).href;
    sweeper = await import(workerModule);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    storage.headObject.mockResolvedValue({ ContentLength: 1024, ContentType: 'image/png' });
    storage.presignPutUrl.mockResolvedValue('https://storage.example.test/synthetic');
    storage.deleteObject.mockResolvedValue(undefined);
    storage.deleteObjects.mockImplementation(async (keys: string[]) => {
      for (const key of keys) await storage.deleteObject(key);
    });
  });
  afterAll(async () => {
    if (!db) return;
    try {
      await db.prisma.project.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await db.prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    } finally {
      await db.prisma.$disconnect();
    }
  });

  const fixture = async () => {
    const label = `asset-cleanup-${randomUUID()}`;
    const organization = await db.prisma.organization.create({ data: { name: label } });
    organizationIds.push(organization.id);
    const project = await db.prisma.project.create({ data: { organizationId: organization.id, name: label, slug: label } });
    const upload = await actions.presignAsset(organization.id, project.id, { filename: 'image.png', contentType: 'image/png', size: 1024 });
    return { organization, project, upload, body: { key: upload.key, contentType: 'image/png', size: 1024 } };
  };
  const expire = (key: string) => db.prisma.pendingAssetUpload.update({ where: { key }, data: { expiresAt: new Date(Date.now() - 1000) } });

  it('retains fresh uploads and sweeps abandoned uploads after the grace period', async () => {
    const { upload } = await fixture();
    await sweeper.sweepPendingAssetUploads();
    expect(storage.deleteObject).not.toHaveBeenCalled();
    await expire(upload.key);
    await sweeper.sweepPendingAssetUploads();
    expect(storage.deleteObject).toHaveBeenCalledWith(upload.key);
    expect(await db.prisma.pendingAssetUpload.findUnique({ where: { key: upload.key } })).toBeNull();
    expect(await db.prisma.assetUploadTombstone.findUnique({ where: { key: upload.key } })).toMatchObject({ nextCheckAt: expect.any(Date) });
    storage.deleteObject.mockClear();
    await sweeper.sweepPendingAssetUploads();
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('never sweeps a confirmed asset with a stale pending row', async () => {
    const { organization, project, upload, body } = await fixture();
    const confirmed = await actions.confirmAsset(organization.id, project.id, 'synthetic-user', body);
    await db.prisma.pendingAssetUpload.create({
      data: {
        key: upload.key,
        projectId: project.id,
        size: 1024,
        contentType: 'image/png',
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    await sweeper.sweepPendingAssetUploads();
    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(await db.prisma.asset.findUnique({ where: { key: upload.key } })).toMatchObject({ id: confirmed.id });
  });

  it('refuses confirmation after cleanup has durably claimed the upload', async () => {
    const { organization, project, upload, body } = await fixture();
    await db.prisma.pendingAssetUpload.update({ where: { key: upload.key }, data: { cleanupStartedAt: new Date() } });
    await expect(actions.confirmAsset(organization.id, project.id, 'synthetic-user', body)).rejects.toMatchObject({ status: 400 });
    expect(await db.prisma.asset.findUnique({ where: { key: upload.key } })).toBeNull();
  });

  it('keeps a confirmation that races the sweep at the pending-row write', async () => {
    const { organization, project, upload, body } = await fixture();
    await expire(upload.key);
    let release: () => void = () => undefined;
    let acquired: (pid: number) => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = new Promise<number>((resolve) => {
      acquired = resolve;
    });
    const holder = db.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "key" FROM "pending_asset_upload" WHERE "key" = ${upload.key} FOR UPDATE`;
        const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        if (!backend) throw new Error('Missing test backend');
        acquired(backend.pid);
        await gate;
      },
      { timeout: 15_000 },
    );
    const pid = await Promise.race([
      held,
      holder.then(() => {
        throw new Error('Test lock ended early');
      }),
    ]);
    const waitForBlocked = async (count: number) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        // A second waiter on the same row queues behind the first waiter, not
        // the holder, so count the whole wait chain.
        const [row] = await db.prisma.$queryRaw<{ count: number }[]>`
          WITH RECURSIVE chain(pid) AS (
            SELECT ${pid}::int
            UNION
            SELECT activity.pid FROM pg_stat_activity activity JOIN chain ON chain.pid = ANY(pg_blocking_pids(activity.pid))
            WHERE activity.datname = current_database()
          )
          SELECT (count(*) - 1)::int AS count FROM chain`;
        if ((row?.count ?? 0) >= count) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('Expected concurrent pending-upload writes to block');
    };
    const confirmation = actions.confirmAsset(organization.id, project.id, 'synthetic-user', body);
    let sweep: Promise<number> | undefined;
    try {
      await waitForBlocked(1);
      sweep = sweeper.sweepPendingAssetUploads();
      await waitForBlocked(2);
    } finally {
      release();
      await holder;
      await Promise.allSettled([confirmation, sweep]);
    }
    const confirmed = await confirmation;
    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(await db.prisma.asset.findUnique({ where: { key: upload.key } })).toMatchObject({ id: confirmed.id });
  });

  it('serializes concurrent reservations at the per-project pending count limit', async () => {
    const { organization, project } = await fixture();
    await db.prisma.pendingAssetUpload.createMany({
      data: Array.from({ length: 18 }, (_, index) => ({
        key: `projects/${project.id}/assets/reserved-${index}.png`,
        projectId: project.id,
        size: 1024,
        contentType: 'image/png',
        expiresAt: new Date(Date.now() + 86_400_000),
      })),
    });
    const body = { filename: 'next.png', contentType: 'image/png', size: 1024 };
    const results = await Promise.allSettled([
      actions.presignAsset(organization.id, project.id, body),
      actions.presignAsset(organization.id, project.id, body),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { status: 429 } });
    expect(await db.prisma.pendingAssetUpload.count({ where: { projectId: project.id } })).toBe(20);
  });

  it('deletes a rejected upload, refuses re-confirmation, and sweeps a recreated PUT after the shortened expiry', async () => {
    const { organization, project, upload, body } = await fixture();
    const original = await db.prisma.pendingAssetUpload.findUniqueOrThrow({ where: { key: upload.key } });
    storage.headObject.mockResolvedValue({ ContentLength: 1, ContentType: 'image/png' });
    const objects = new Set([upload.key]);
    storage.deleteObject.mockImplementation(async (key: string) => {
      objects.delete(key);
    });
    await expect(actions.confirmAsset(organization.id, project.id, 'synthetic-user', { ...body, size: 1 })).rejects.toMatchObject({ status: 400 });
    expect(objects.has(upload.key)).toBe(false);
    const rejected = await db.prisma.pendingAssetUpload.findUniqueOrThrow({ where: { key: upload.key } });
    expect(rejected.rejectedAt).toBeInstanceOf(Date);
    expect(rejected.cleanupStartedAt).toBeInstanceOf(Date);
    expect(rejected.expiresAt).toEqual(original.urlExpiresAt);
    const budget = await db.prisma.pendingAssetUpload.aggregate({
      where: { projectId: project.id },
      _sum: { size: true },
      _count: { _all: true },
    });
    expect(budget).toMatchObject({ _sum: { size: 1024 }, _count: { _all: 1 } });
    objects.add(upload.key);
    await expect(actions.confirmAsset(organization.id, project.id, 'synthetic-user', body)).rejects.toMatchObject({
      status: 400,
      details: { reason: 'asset_upload_rejected' },
    });
    await sweeper.sweepPendingAssetUploads();
    expect(objects.has(upload.key)).toBe(true);
    await expire(upload.key);
    await sweeper.sweepPendingAssetUploads();
    expect(objects.has(upload.key)).toBe(false);
    expect(storage.deleteObject).toHaveBeenCalledTimes(2);
    objects.add(upload.key);
    await expect(actions.confirmAsset(organization.id, project.id, 'synthetic-user', body)).rejects.toMatchObject({ status: 400 });
    expect(await db.prisma.pendingAssetUpload.findUnique({ where: { key: upload.key } })).toBeNull();
    expect(await db.prisma.assetUploadTombstone.findUnique({ where: { key: upload.key } })).toMatchObject({ nextCheckAt: expect.any(Date) });
    expect(await db.prisma.asset.findUnique({ where: { key: upload.key } })).toBeNull();
  });

  it('preserves a confirmed asset even with a stale post-cleanup tombstone', async () => {
    const { organization, project, upload, body } = await fixture();
    const confirmed = await actions.confirmAsset(organization.id, project.id, 'synthetic-user', body);
    await db.prisma.assetUploadTombstone.create({
      data: {
        key: upload.key,
        projectId: project.id,
        size: 1024,
        urlExpiresAt: new Date(Date.now() - 1000),
        nextCheckAt: new Date(Date.now() - 1000),
      },
    });
    await sweeper.sweepAssetUploadTombstones();
    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(await db.prisma.asset.findUnique({ where: { key: upload.key } })).toMatchObject({ id: confirmed.id });
  });

  it('drains more than one full batch of stale confirmed reservations without any storage deletion', async () => {
    const { organization, project, upload, body } = await fixture();
    await actions.confirmAsset(organization.id, project.id, 'synthetic-user', body);
    const keys = [upload.key, ...Array.from({ length: 100 }, (_, index) => `projects/${project.id}/assets/confirmed-${index}.png`)];
    await db.prisma.asset.createMany({
      data: keys.slice(1).map((key) => ({ projectId: project.id, key, url: `/api/public/assets/${key}`, size: 1024, contentType: 'image/png' })),
    });
    await db.prisma.pendingAssetUpload.createMany({
      data: keys.map((key) => ({ projectId: project.id, key, size: 1024, contentType: 'image/png', expiresAt: new Date(Date.now() - 1000) })),
    });
    await expect(sweeper.sweepPendingAssetUploads()).resolves.toBe(101);
    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(storage.deleteObjects).not.toHaveBeenCalled();
    expect(await db.prisma.pendingAssetUpload.count({ where: { projectId: project.id } })).toBe(0);
    expect(await db.prisma.asset.count({ where: { projectId: project.id } })).toBe(101);
  });

  it('does not create a new tombstone when initial cleanup already succeeds beyond the final 23-hour reconciliation', async () => {
    const { upload } = await fixture();
    await db.prisma.pendingAssetUpload.update({
      where: { key: upload.key },
      data: {
        createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
        urlExpiresAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    await expect(sweeper.sweepPendingAssetUploads()).resolves.toBe(1);
    expect(storage.deleteObjects).toHaveBeenCalledWith([upload.key]);
    expect(await db.prisma.pendingAssetUpload.findUnique({ where: { key: upload.key } })).toBeNull();
    expect(await db.prisma.assetUploadTombstone.findUnique({ where: { key: upload.key } })).toBeNull();
  });

  it.each([
    { count: 20, size: 1024 },
    { count: 10, size: 50 * 1024 * 1024 },
  ])('keeps the cap after $count rejection cycles of $size bytes, including a failed deletion', async ({ count, size }) => {
    const { organization, project, upload } = await fixture();
    await db.prisma.pendingAssetUpload.delete({ where: { key: upload.key } });
    storage.headObject.mockResolvedValue({ ContentLength: size - 1, ContentType: 'image/png' });
    const objects = new Set<string>();
    storage.deleteObject.mockImplementation(async (key: string) => {
      objects.delete(key);
    });
    for (let index = 0; index < count; index++) {
      const pending = await actions.presignAsset(organization.id, project.id, { filename: 'again.png', contentType: 'image/png', size });
      objects.add(pending.key);
      if (index === count - 1) storage.deleteObject.mockRejectedValueOnce(new Error('storage unavailable'));
      await expect(
        actions.confirmAsset(organization.id, project.id, 'synthetic-user', { key: pending.key, contentType: 'image/png', size: 1 }),
      ).rejects.toMatchObject({ status: 400, details: { reason: 'asset_upload_mismatch' } });
      objects.add(pending.key);
    }
    await expect(actions.presignAsset(organization.id, project.id, { filename: 'next.png', contentType: 'image/png', size })).rejects.toMatchObject({
      status: 429,
      details: { reason: 'pending_asset_upload_limit' },
    });
    expect(objects.size).toBe(count);
    expect(await db.prisma.pendingAssetUpload.count({ where: { projectId: project.id } })).toBe(count);
    expect(await db.prisma.pendingAssetUpload.count({ where: { projectId: project.id, rejectedAt: { not: null } } })).toBe(count);
    await db.prisma.pendingAssetUpload.updateMany({ where: { projectId: project.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await sweeper.sweepPendingAssetUploads();
    expect(objects.size).toBe(0);
    await expect(actions.presignAsset(organization.id, project.id, { filename: 'next.png', contentType: 'image/png', size })).rejects.toMatchObject({
      status: 429,
    });
    if (count === 20) {
      await sweeper.sweepAssetUploadTombstones(new Date(Date.now() + 41 * 60 * 1000));
      await expect(
        actions.presignAsset(organization.id, project.id, { filename: 'next.png', contentType: 'image/png', size }),
      ).resolves.toHaveProperty('key');
    }
    await sweeper.sweepAssetUploadTombstones(new Date(Date.now() + (24 * 60 * 60 + 601) * 1000));
    await expect(actions.presignAsset(organization.id, project.id, { filename: 'next.png', contentType: 'image/png', size })).resolves.toHaveProperty(
      'key',
    );
  });

  it('counts a slow rejected PUT until its 30-minute recheck, retains its slot, and releases tracking only after the shared 23-hour PUT allowance', async () => {
    const { organization, project, upload, body } = await fixture();
    await db.prisma.pendingAssetUpload.update({ where: { key: upload.key }, data: { size: 50 * 1024 * 1024 } });
    storage.headObject.mockResolvedValue({ ContentLength: 1, ContentType: 'image/png' });
    const objects = new Set([upload.key]);
    storage.deleteObject.mockImplementation(async (key: string) => {
      objects.delete(key);
    });
    await expect(actions.confirmAsset(organization.id, project.id, 'synthetic-user', { ...body, size: 1 })).rejects.toMatchObject({ status: 400 });
    await expire(upload.key);
    await sweeper.sweepPendingAssetUploads();
    const tombstone = await db.prisma.assetUploadTombstone.findUniqueOrThrow({ where: { key: upload.key } });
    expect(tombstone.size).toBe(50 * 1024 * 1024);
    expect(tombstone.firstRecheckedAt).toBeNull();
    expect(tombstone.nextCheckAt.getTime()).toBe(tombstone.urlExpiresAt.getTime() + 30 * 60 * 1000);
    // Nine other retained records fill the byte budget while this late completion is still counted.
    await db.prisma.assetUploadTombstone.createMany({
      data: Array.from({ length: 9 }, (_, index) => ({
        key: `projects/${project.id}/assets/retained-${index}.png`,
        projectId: project.id,
        size: tombstone.size,
        urlExpiresAt: tombstone.urlExpiresAt,
        nextCheckAt: tombstone.nextCheckAt,
      })),
    });
    objects.add(upload.key);
    await expect(
      actions.presignAsset(organization.id, project.id, { filename: 'next.png', contentType: 'image/png', size: 1 }),
    ).rejects.toMatchObject({ status: 429 });
    await sweeper.sweepAssetUploadTombstones(new Date(tombstone.nextCheckAt.getTime() - 1));
    expect(objects.has(upload.key)).toBe(true);
    await sweeper.sweepAssetUploadTombstones(tombstone.nextCheckAt);
    expect(objects.has(upload.key)).toBe(false);
    const checked = await db.prisma.assetUploadTombstone.findUniqueOrThrow({ where: { key: upload.key } });
    expect(checked.firstRecheckedAt).toEqual(tombstone.nextCheckAt);
    const finalAt = new Date(tombstone.urlExpiresAt.getTime() + 23 * 60 * 60 * 1000);
    expect(checked.nextCheckAt).toEqual(finalAt);
    await expect(
      actions.presignAsset(organization.id, project.id, { filename: 'next.png', contentType: 'image/png', size: 1 }),
    ).resolves.toHaveProperty('key');
    await sweeper.sweepAssetUploadTombstones(new Date(finalAt.getTime() - 1));
    expect(await db.prisma.assetUploadTombstone.count({ where: { projectId: project.id } })).toBe(10);
    objects.add(upload.key);
    storage.deleteObjects.mockRejectedValueOnce(new Error('storage unavailable'));
    await sweeper.sweepAssetUploadTombstones(finalAt);
    expect(await db.prisma.assetUploadTombstone.count({ where: { projectId: project.id } })).toBe(10);
    await sweeper.sweepAssetUploadTombstones(new Date(finalAt.getTime() + 15 * 60 * 1000));
    expect(objects.has(upload.key)).toBe(false);
    expect(await db.prisma.assetUploadTombstone.count({ where: { projectId: project.id } })).toBe(0);
    expect(await db.prisma.asset.findUnique({ where: { key: upload.key } })).toBeNull();
  });

  it.each([
    { count: 500, size: 1 },
    { count: 41, size: 50 * 1024 * 1024 },
  ])('allows active reservations while the retained pool is full ($count records of $size bytes)', async ({ count, size }) => {
    const { organization, project, upload } = await fixture();
    await db.prisma.pendingAssetUpload.delete({ where: { key: upload.key } });
    const now = new Date();
    await db.prisma.assetUploadTombstone.createMany({
      data: Array.from({ length: count }, (_, index) => ({
        key: `projects/${project.id}/assets/retained-budget-${index}.png`,
        projectId: project.id,
        size,
        urlExpiresAt: now,
        firstRecheckedAt: now,
        nextCheckAt: new Date(now.getTime() + 23 * 60 * 60 * 1000),
      })),
    });
    await expect(
      actions.presignAsset(organization.id, project.id, { filename: 'next.png', contentType: 'image/png', size: 1 }),
    ).resolves.toHaveProperty('key');
    expect(await db.prisma.pendingAssetUpload.count({ where: { projectId: project.id } })).toBe(1);
    await sweeper.sweepAssetUploadTombstones(new Date(now.getTime() + 23 * 60 * 60 * 1000));
    await expect(
      actions.presignAsset(organization.id, project.id, { filename: 'next.png', contentType: 'image/png', size: 1 }),
    ).resolves.toHaveProperty('key');
  });

  it('backs off only the failed delete while other projects drain in the same run', async () => {
    const { project, upload } = await fixture();
    const other = await fixture();
    const now = new Date();
    const expired = new Date(now.getTime() - 1000);
    await db.prisma.pendingAssetUpload.updateMany({
      where: { key: { in: [upload.key, other.upload.key] } },
      data: { expiresAt: expired, nextAttemptAt: expired },
    });
    await db.prisma.pendingAssetUpload.createMany({
      data: Array.from({ length: 100 }, (_, index) => ({
        key: `projects/${other.project.id}/assets/drain-${index}.png`,
        projectId: other.project.id,
        size: 1,
        contentType: 'image/png',
        expiresAt: expired,
        nextAttemptAt: expired,
      })),
    });
    const { StorageDeleteError } = await import('@nibleaf/storage');
    storage.deleteObjects.mockImplementation(async (keys: string[]) => {
      if (keys.includes(upload.key)) throw new StorageDeleteError(1, keys.length - 1, 'AccessDenied', [upload.key]);
    });
    await expect(sweeper.sweepPendingAssetUploads(now)).resolves.toBe(101);
    expect(await db.prisma.pendingAssetUpload.count({ where: { projectId: other.project.id } })).toBe(0);
    const failed = await db.prisma.pendingAssetUpload.findUniqueOrThrow({ where: { key: upload.key } });
    expect(failed.nextAttemptAt.getTime()).toBe(now.getTime() + 5 * 60 * 1000);
    expect(failed.attempts).toBe(1);
    expect(failed.projectId).toBe(project.id);
    storage.deleteObjects.mockClear();
    await expect(sweeper.sweepPendingAssetUploads(new Date(now.getTime() + 5 * 60 * 1000 - 1))).resolves.toBe(0);
    expect(storage.deleteObjects).not.toHaveBeenCalled();
    storage.deleteObjects.mockResolvedValue(undefined);
    await expect(sweeper.sweepPendingAssetUploads(new Date(now.getTime() + 5 * 60 * 1000))).resolves.toBe(1);
    expect(storage.deleteObjects).toHaveBeenCalledExactlyOnceWith([upload.key]);
  });

  it('keeps first-recheck reservations active when promoting them would exceed retained bytes', async () => {
    const { project, upload } = await fixture();
    await db.prisma.pendingAssetUpload.delete({ where: { key: upload.key } });
    const now = new Date();
    const urlExpiresAt = new Date(now.getTime() - 31 * 60 * 1000);
    await db.prisma.assetUploadTombstone.createMany({
      data: [
        ...Array.from({ length: 40 }, (_, index) => ({
          key: `projects/${project.id}/assets/retained-${index}.png`,
          projectId: project.id,
          size: 50 * 1024 * 1024,
          urlExpiresAt,
          firstRecheckedAt: urlExpiresAt,
          nextCheckAt: new Date(now.getTime() + 23 * 60 * 60 * 1000),
        })),
        ...['a', 'b'].map((leaf) => ({
          key: `projects/${project.id}/assets/first-${leaf}.png`,
          projectId: project.id,
          size: 25 * 1024 * 1024,
          urlExpiresAt,
          firstRecheckedAt: null,
          nextCheckAt: now,
          nextAttemptAt: now,
        })),
      ],
    });
    await expect(sweeper.sweepAssetUploadTombstones(now)).resolves.toBe(2);
    const retained = await db.prisma.assetUploadTombstone.aggregate({
      where: { projectId: project.id, firstRecheckedAt: { not: null } },
      _sum: { size: true },
      _count: { _all: true },
    });
    expect(retained._count._all).toBe(41);
    expect(retained._sum.size).toBe(2025 * 1024 * 1024);
    expect(await db.prisma.assetUploadTombstone.count({ where: { projectId: project.id, firstRecheckedAt: null } })).toBe(1);
  });
  it('preserves a teammate reservation when only confirmation metadata is wrong', async () => {
    const { organization, project, upload, body } = await fixture();
    await expect(actions.confirmAsset(organization.id, project.id, 'teammate', { ...body, size: 1 })).rejects.toMatchObject({ status: 400 });
    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(await db.prisma.pendingAssetUpload.findUniqueOrThrow({ where: { key: upload.key } })).toMatchObject({ rejectedAt: null });
    await expect(actions.confirmAsset(organization.id, project.id, 'user', body)).resolves.toMatchObject({ key: upload.key });
  });
});
