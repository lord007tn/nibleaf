import { prisma } from '@nibleaf/database';
import { logger } from '@nibleaf/logger';
import {
  ASSET_UPLOAD_FIRST_RECHECK_MS,
  MAX_ACCEPTED_PUT_DURATION_MS,
  MAX_RETAINED_ASSET_UPLOAD_BYTES,
  MAX_RETAINED_ASSET_UPLOADS,
} from '@nibleaf/shared/constants';
import { deleteObjects, StorageDeleteError } from '@nibleaf/storage';

const SWEEP_INTERVAL_MS = 15 * 60 * 1000;
const SWEEP_BATCH_SIZE = 100;
const SWEEP_TIME_BUDGET_MS = 30_000;
const FIRST_RECHECK_MS = ASSET_UPLOAD_FIRST_RECHECK_MS;
// Accepted PUTs must finish within the same allowance used by project erasure.
const FINAL_RECHECK_MS = MAX_ACCEPTED_PUT_DURATION_MS;
const RETRY_BASE_MS = 5 * 60 * 1000;

const deletedKeys = async (keys: string[]): Promise<string[]> => {
  try {
    await deleteObjects(keys);
    return keys;
  } catch (error) {
    logger.warn('Asset cleanup will retry failed keys.');
    if (!(error instanceof StorageDeleteError)) return [];
    const failed = new Set(error.getFailedKeys());
    return failed.size ? keys.filter((key) => !failed.has(key)) : [];
  }
};

/** Rechecks are batched and reported separately from released pending reservations. */
export const sweepAssetUploadTombstones = async (now = new Date(), deadline = performance.now() + SWEEP_TIME_BUDGET_MS): Promise<number> => {
  let rechecked = 0;
  while (performance.now() < deadline) {
    const due = await prisma.assetUploadTombstone.findMany({
      where: { nextCheckAt: { lte: now }, nextAttemptAt: { lte: now } },
      orderBy: [{ nextCheckAt: 'asc' }, { key: 'asc' }],
      take: SWEEP_BATCH_SIZE,
      select: { key: true },
    });
    if (!due.length) break;
    let progress = 0;
    let claimedBatchProgress = false;
    try {
      if (performance.now() >= deadline) return rechecked;
      const keys = due.map(({ key }) => key);
      const stale = await prisma.$queryRaw<{ key: string }[]>`
        DELETE FROM "asset_upload_tombstone" AS tombstone WHERE tombstone."key" = ANY(${keys}::text[])
          AND EXISTS (SELECT 1 FROM "asset" WHERE "key" = tombstone."key") RETURNING tombstone."key"`;
      progress += stale.length;
      if (performance.now() >= deadline) return rechecked;
      const claimed = await prisma.$queryRaw<{ key: string }[]>`
        UPDATE "asset_upload_tombstone" AS tombstone SET "nextAttemptAt" = ${now}::timestamp +
          LEAST(${6 * 60 * 60 * 1000}, ${RETRY_BASE_MS} * power(2, LEAST(tombstone."attempts", 7))) * INTERVAL '1 millisecond', "attempts" = "attempts" + 1
        WHERE tombstone."key" = ANY(${keys}::text[]) AND tombstone."nextCheckAt" <= ${now} AND tombstone."nextAttemptAt" <= ${now}
          AND NOT EXISTS (SELECT 1 FROM "asset" WHERE "key" = tombstone."key")
          AND NOT EXISTS (SELECT 1 FROM "pending_asset_upload" WHERE "key" = tombstone."key")
        RETURNING tombstone."key"`;
      claimedBatchProgress = claimed.length > 0;
      if (claimed.length) {
        const claimedKeys = await deletedKeys(claimed.map(({ key }) => key));
        if (!claimedKeys.length) continue;
        // Serialize promotion with presign accounting. These two queries hold no connection across storage I/O.
        const result = await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "project" WHERE "id" IN (
            SELECT "projectId" FROM "asset_upload_tombstone" WHERE "key" = ANY(${claimedKeys}::text[])
          ) ORDER BY "id" FOR NO KEY UPDATE`;
          const [finished] = await tx.$queryRaw<{ count: number }[]>`
            WITH usage AS (
              SELECT "projectId", count(*) AS records, COALESCE(sum("size"), 0) AS bytes FROM "asset_upload_tombstone"
              WHERE "firstRecheckedAt" IS NOT NULL
                AND "projectId" IN (SELECT "projectId" FROM "asset_upload_tombstone" WHERE "key" = ANY(${claimedKeys}::text[]))
                AND NOT ("key" = ANY(${claimedKeys}::text[]) AND "urlExpiresAt" <= ${new Date(now.getTime() - FINAL_RECHECK_MS)})
              GROUP BY "projectId"
            ), candidates AS (
              SELECT "key", "projectId", row_number() OVER (PARTITION BY "projectId" ORDER BY "key") AS records,
                sum("size") OVER (PARTITION BY "projectId" ORDER BY "key") AS bytes
              FROM "asset_upload_tombstone" WHERE "key" = ANY(${claimedKeys}::text[])
                AND "firstRecheckedAt" IS NULL AND "urlExpiresAt" > ${new Date(now.getTime() - FINAL_RECHECK_MS)}
            ), promoted AS (
              SELECT c."key" FROM candidates c LEFT JOIN usage u ON u."projectId" = c."projectId"
              WHERE c.records + COALESCE(u.records, 0) <= ${MAX_RETAINED_ASSET_UPLOADS}
                AND c.bytes + COALESCE(u.bytes, 0) <= ${MAX_RETAINED_ASSET_UPLOAD_BYTES}
            ), removed AS (
              DELETE FROM "asset_upload_tombstone" WHERE "key" = ANY(${claimedKeys}::text[])
                AND "urlExpiresAt" <= ${new Date(now.getTime() - FINAL_RECHECK_MS)} RETURNING "key"
            ), rechecked AS (
              UPDATE "asset_upload_tombstone" SET
                "firstRecheckedAt" = CASE WHEN "key" IN (SELECT "key" FROM promoted) THEN ${now} ELSE "firstRecheckedAt" END,
                "nextCheckAt" = CASE
                  WHEN "firstRecheckedAt" IS NULL AND "key" NOT IN (SELECT "key" FROM promoted) THEN ${new Date(now.getTime() + SWEEP_INTERVAL_MS)}
                  ELSE "urlExpiresAt" + ${FINAL_RECHECK_MS} * INTERVAL '1 millisecond' END,
                "nextAttemptAt" = ${now}, "attempts" = 0
              WHERE "key" = ANY(${claimedKeys}::text[]) AND "urlExpiresAt" > ${new Date(now.getTime() - FINAL_RECHECK_MS)}
              RETURNING "key"
            ) SELECT ((SELECT count(*) FROM removed) + (SELECT count(*) FROM rechecked))::int AS count`;
          return finished;
        });
        rechecked += result?.count ?? 0;
        progress += result?.count ?? 0;
      }
    } catch {
      logger.warn('Asset upload tombstone cleanup will retry.');
    }
    if (due.length < SWEEP_BATCH_SIZE || (!progress && !claimedBatchProgress)) break;
  }
  return rechecked;
};

/** Claim before storage I/O. Confirmation requires an unclaimed reservation.
 * Returns pending reservations removed, including stale rows for confirmed assets. */
export const sweepPendingAssetUploads = async (now = new Date(), deadline = performance.now() + SWEEP_TIME_BUDGET_MS): Promise<number> => {
  let released = 0;
  while (performance.now() < deadline) {
    const expired = await prisma.pendingAssetUpload.findMany({
      where: { expiresAt: { lte: now }, nextAttemptAt: { lte: now }, OR: [{ cleanupStartedAt: null }, { cleanupStartedAt: { lt: now } }] },
      orderBy: [{ cleanupStartedAt: { sort: 'desc', nulls: 'first' } }, { expiresAt: 'asc' }, { key: 'asc' }],
      take: SWEEP_BATCH_SIZE,
      select: { key: true },
    });
    if (!expired.length) break;
    const beforeBatch = released;
    let claimedBatchProgress = false;
    try {
      if (performance.now() >= deadline) return released;
      const keys = expired.map(({ key }) => key);
      const stale = await prisma.$queryRaw<{ key: string }[]>`
        DELETE FROM "pending_asset_upload" AS pending WHERE pending."key" = ANY(${keys}::text[])
          AND EXISTS (SELECT 1 FROM "asset" WHERE "key" = pending."key") RETURNING pending."key"`;
      released += stale.length;
      if (performance.now() >= deadline) return released;
      const claimed = await prisma.$queryRaw<{ key: string }[]>`
        UPDATE "pending_asset_upload" AS pending SET "cleanupStartedAt" = ${now},
          "nextAttemptAt" = ${now}::timestamp + LEAST(${6 * 60 * 60 * 1000}, ${RETRY_BASE_MS} * power(2, LEAST(pending."attempts", 7))) * INTERVAL '1 millisecond',
          "attempts" = "attempts" + 1
        WHERE pending."key" = ANY(${keys}::text[]) AND pending."expiresAt" <= ${now} AND pending."nextAttemptAt" <= ${now}
          AND (pending."cleanupStartedAt" IS NULL OR pending."cleanupStartedAt" < ${now})
          AND NOT EXISTS (SELECT 1 FROM "asset" WHERE "key" = pending."key")
        RETURNING pending."key"`;
      claimedBatchProgress = claimed.length > 0;
      if (claimed.length) {
        const claimedKeys = await deletedKeys(claimed.map(({ key }) => key));
        if (!claimedKeys.length) continue;
        // Move quota and tracking only for keys whose storage deletion succeeded.
        const [result] = await prisma.$queryRaw<{ count: number }[]>`
          WITH released AS (
            DELETE FROM "pending_asset_upload" WHERE "key" = ANY(${claimedKeys}::text[]) AND "cleanupStartedAt" = ${now}
            RETURNING "key", "projectId", "size", "urlExpiresAt"
          ), retained AS (
            INSERT INTO "asset_upload_tombstone" ("key", "projectId", "size", "urlExpiresAt", "firstRecheckedAt", "nextCheckAt", "nextAttemptAt")
            SELECT "key", "projectId", "size", "urlExpiresAt", NULL,
              GREATEST(${now}, "urlExpiresAt" + ${FIRST_RECHECK_MS} * INTERVAL '1 millisecond'), ${now}
            FROM released WHERE "urlExpiresAt" + ${FINAL_RECHECK_MS} * INTERVAL '1 millisecond' > ${now}
            ON CONFLICT ("key") DO NOTHING RETURNING "key"
          ) SELECT count(*)::int AS count FROM released`;
        released += result?.count ?? 0;
      }
    } catch {
      // Failed finalization keeps the claimed reservation counted for retry.
      logger.warn('Pending asset upload cleanup will retry.');
    }
    if (expired.length < SWEEP_BATCH_SIZE || (released === beforeBatch && !claimedBatchProgress)) break;
  }
  return released;
};

/** Independent maintenance task; does not depend on a particular queue being enabled. */
export const startPendingAssetUploadSweeper = (): NodeJS.Timeout => {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const now = new Date();
      const deadline = performance.now() + SWEEP_TIME_BUDGET_MS;
      await sweepPendingAssetUploads(now, Math.min(deadline, performance.now() + SWEEP_TIME_BUDGET_MS / 3));
      await sweepAssetUploadTombstones(now, deadline);
    } catch {
      logger.warn('Pending asset upload sweep will retry.');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => {
    void run();
  }, SWEEP_INTERVAL_MS);
  timer.unref();
  void run();
  return timer;
};
