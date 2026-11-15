import { createHash, randomBytes } from 'node:crypto';
import { type Asset, prisma } from '@nibleaf/database';
import { createLogger } from '@nibleaf/logger';
import {
  ASSET_UPLOAD_CLOCK_SKEW_MS,
  MAX_ASSET_UPLOAD_BYTES,
  MAX_PENDING_ASSET_UPLOAD_BYTES,
  MAX_PENDING_ASSET_UPLOADS,
  MAX_RETAINED_ASSET_UPLOADS,
  PENDING_ASSET_UPLOAD_GRACE_MS,
} from '@nibleaf/shared/constants';
import { newId } from '@nibleaf/shared/ids';
import { slugify } from '@nibleaf/shared/utils';
import {
  deleteObject,
  headObject,
  imageDimensions,
  isNotFound,
  presignPutUrl,
  putObject,
  putObjectStream,
  storedImageDimensions,
  UPLOAD_PRESIGN_EXPIRES_IN_SECONDS,
} from '@nibleaf/storage';
import { keys as storageKeys } from '@nibleaf/storage/keys';
import { type ConfirmAssetBody, type PresignAssetBody, safeInlineAssetContentType } from '@nibleaf/validators';
import { AppError, badRequest, conflict, notFound } from '@/errors';
import { assertProjectInOrg } from './projects';

const log = createLogger({ action: 'assets' });

const assetPrefix = (projectId: string): string => `projects/${projectId}/assets/`;

const assetKey = (projectId: string, filename: string): string => {
  const dot = filename.lastIndexOf('.');
  const ext = dot > -1 ? slugify(filename.slice(dot + 1)) : '';
  const base = slugify(dot > -1 ? filename.slice(0, dot) : filename) || 'file';
  return `${assetPrefix(projectId)}${newId()}-${base}${ext ? `.${ext}` : ''}`;
};

const importedAssetKey = (projectId: string, importId: string, filename: string): string => {
  const dot = filename.lastIndexOf('.');
  const ext = dot > -1 ? filename.slice(dot + 1).toLowerCase() : '';
  const base = slugify(dot > -1 ? filename.slice(0, dot) : filename) || 'file';
  return `${assetPrefix(projectId)}imports/${slugify(importId)}-${base}${ext ? `.${ext}` : ''}`;
};

/** Browser upload keys have one filename directly under the project's asset prefix. */
const assertOwnedKey = (projectId: string, key: string): void => {
  const leaf = key.slice(assetPrefix(projectId).length);
  if (!key.startsWith(assetPrefix(projectId)) || !leaf || leaf === '.' || leaf === '..' || /[/\\]/.test(leaf)) {
    throw badRequest('Invalid asset key', { key });
  }
};

// Assets are served by the API proxy (GET /api/public/assets/<key>) — a stable,
// browser-reachable, same-origin URL that needs no anonymous-bucket access or
// presigned-URL expiry. The server streams the object from storage internally.
const publicUrlForKey = (key: string): string => `/api/public/assets/${key}`;

/** Store bytes that were produced server-side (for example, a remote image
 * fetched by an importer) through the same Asset model and stable public URL
 * used by browser uploads. */
export const storeAsset = async ({
  projectId,
  filename,
  contentType,
  bytes,
  createdById = null,
  importId,
}: {
  projectId: string;
  filename: string;
  contentType: string;
  bytes: Uint8Array;
  createdById?: string | null;
  /** Stable source identifier used by importers to make repeated imports idempotent. */
  importId?: string;
}) => {
  const key = importId ? importedAssetKey(projectId, importId, filename) : assetKey(projectId, filename);
  await putObject(key, bytes, contentType);
  const dimensions = imageDimensions(bytes) ?? { width: null, height: null };
  return prisma.asset.upsert({
    where: { key },
    create: { projectId, key, url: publicUrlForKey(key), contentType, size: bytes.byteLength, createdById, ...dimensions },
    update: { contentType, size: bytes.byteLength, ...dimensions },
  });
};

export const findImportedAsset = async (projectId: string, importId: string, filename: string): Promise<Asset | null> =>
  await prisma.asset.findUnique({ where: { key: importedAssetKey(projectId, importId, filename) } });

export const presignAsset = async (organizationId: string, projectId: string, body: PresignAssetBody) => {
  await assertProjectInOrg(organizationId, projectId);
  const key = assetKey(projectId, body.filename);
  const signingDate = new Date();
  const token = storageKeys().STORAGE_PROVIDER === 'maxio' ? randomBytes(32).toString('base64url') : null;
  await prisma.$transaction(async (tx) => {
    // Serialize reservations against this project's outstanding upload budget; no storage I/O runs here.
    await tx.$queryRaw`SELECT "id" FROM "project" WHERE "id" = ${projectId} FOR NO KEY UPDATE`;
    // Active (500 MiB) plus retained (2 GiB) cap declared unconfirmed storage at 2.48828125 GiB per project.
    const pending = await tx.pendingAssetUpload.aggregate({ where: { projectId }, _sum: { size: true }, _count: { _all: true } });
    const cleanup = await tx.assetUploadTombstone.findMany({
      where: { projectId },
      select: { size: true, firstRecheckedAt: true },
      take: MAX_PENDING_ASSET_UPLOADS + MAX_RETAINED_ASSET_UPLOADS + 1,
    });
    const active = cleanup.filter((upload) => !upload.firstRecheckedAt);
    const activeBytes = (pending._sum.size ?? 0) + active.reduce((sum, upload) => sum + upload.size, 0);
    if (pending._count._all + active.length >= MAX_PENDING_ASSET_UPLOADS || activeBytes + body.size > MAX_PENDING_ASSET_UPLOAD_BYTES) {
      throw new AppError({
        code: 'http:rate_limited',
        message: 'Pending upload limit reached. Finish existing uploads or try again after cleanup.',
        details: {
          reason: 'pending_asset_upload_limit',
          budget: 'active',
          limitBytes: MAX_PENDING_ASSET_UPLOAD_BYTES,
          limitCount: MAX_PENDING_ASSET_UPLOADS,
        },
      });
    }
    await tx.pendingAssetUpload.create({
      data: {
        key,
        projectId,
        size: body.size,
        contentType: body.contentType,
        uploadTokenHash: token ? createHash('sha256').update(token).digest('hex') : null,
        expiresAt: new Date(signingDate.getTime() + PENDING_ASSET_UPLOAD_GRACE_MS),
        urlExpiresAt: new Date(signingDate.getTime() + UPLOAD_PRESIGN_EXPIRES_IN_SECONDS * 1000 + ASSET_UPLOAD_CLOCK_SKEW_MS),
      },
    });
  });
  const uploadUrl = token
    ? `/api/app/projects/${projectId}/assets/upload/${token}`
    : await presignPutUrl({ key, contentType: body.contentType, contentLength: body.size, signingDate });
  return { key, uploadUrl, contentType: body.contentType };
};

/** Atomically spend a reservation's capability before touching storage. Failed PUTs
 * retain their reservation for the existing rejection/reaper lifecycle. */
export const uploadAsset = async (organizationId: string, projectId: string, token: string, request: Request): Promise<void> => {
  await assertProjectInOrg(organizationId, projectId);
  if (storageKeys().STORAGE_PROVIDER !== 'maxio' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw badRequest('Invalid upload token.');
  const uploadTokenHash = createHash('sha256').update(token).digest('hex');
  const pending = await prisma.pendingAssetUpload.findUnique({ where: { uploadTokenHash } });
  const now = new Date();
  // urlExpiresAt includes clock-skew allowance for cleanup, not for accepting PUTs.
  if (!pending || pending.projectId !== projectId || pending.urlExpiresAt.getTime() - ASSET_UPLOAD_CLOCK_SKEW_MS <= now.getTime()) {
    throw badRequest('Upload expired. Please upload the file again.');
  }
  if (
    request.headers.get('content-length') !== String(pending.size) ||
    request.headers.get('content-type') !== pending.contentType ||
    !request.body
  ) {
    throw badRequest('Upload headers must match the reserved size and content type.');
  }
  const claimed = await prisma.pendingAssetUpload.updateMany({
    where: { key: pending.key, projectId, uploadTokenHash, uploadClaimedAt: null, rejectedAt: null, cleanupStartedAt: null },
    data: { uploadClaimedAt: now },
  });
  if (claimed.count !== 1) throw badRequest('Upload token has already been used or expired.');
  try {
    await putObjectStream(pending.key, request.body, pending.size, pending.contentType, request.signal);
  } catch (error) {
    await rejectUploadedAsset(projectId, pending.key);
    throw error;
  }
};

const confirmedAssetForRetry = (asset: Asset, projectId: string, body: ConfirmAssetBody): Asset => {
  if (asset.projectId !== projectId || asset.size !== body.size || asset.contentType !== body.contentType) {
    throw conflict('Asset has already been confirmed with different metadata.');
  }
  return asset;
};

const inspectUploadedAsset = async (key: string, reservation: { size: number; contentType: string }) => {
  const object = await headObject(key).catch((error: unknown) => {
    if (isNotFound(error)) throw badRequest('Uploaded asset was not found.');
    throw error;
  });
  const size = object.ContentLength;
  const contentType = safeInlineAssetContentType(object.ContentType);
  if (
    size === undefined ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > MAX_ASSET_UPLOAD_BYTES ||
    size !== reservation.size ||
    !contentType ||
    contentType !== reservation.contentType
  ) {
    // Privacy also requires that the bucket and CDN_URL/STORAGE_PUBLIC_URL do not expose anonymous object reads.
    // The worker removes unconfirmed uploads after the grace period.
    throw badRequest('Uploaded asset must match the declared size and supported image type, at most 50 MiB.', { reason: 'asset_upload_mismatch' });
  }
  return { contentType, size };
};

const rejectUploadedAsset = async (projectId: string, key: string): Promise<void> => {
  const rejectedAt = new Date();
  // A durable rejection and cleanup claim exclude confirmation before any storage I/O.
  const rejected = await prisma.$queryRaw<{ key: string }[]>`
    UPDATE "pending_asset_upload" AS pending
    SET "rejectedAt" = COALESCE(pending."rejectedAt", ${rejectedAt}),
        "cleanupStartedAt" = COALESCE(pending."cleanupStartedAt", ${rejectedAt}),
        "expiresAt" = LEAST(pending."expiresAt", pending."urlExpiresAt")
    WHERE pending."key" = ${key} AND pending."projectId" = ${projectId}
      AND NOT EXISTS (SELECT 1 FROM "asset" WHERE "key" = pending."key")
    RETURNING pending."key"`;
  if (!rejected.length) return;
  // Storage failures retain the durable reservation and the caller's validation error; the worker retries deletion.
  await deleteObject(key).catch(() => undefined);
  // Keep the reservation until the worker re-deletes after the signed URL and clock-skew window.
};

export const confirmAsset = async (organizationId: string, projectId: string, userId: string, body: ConfirmAssetBody) => {
  await assertProjectInOrg(organizationId, projectId);
  assertOwnedKey(projectId, body.key);
  const pending = await prisma.pendingAssetUpload.findUnique({
    where: { key: body.key, projectId },
    select: { rejectedAt: true, size: true, contentType: true },
  });
  if (pending?.rejectedAt) throw badRequest('Upload was rejected. Please upload the file again.', { reason: 'asset_upload_rejected' });
  const existing = await prisma.asset.findUnique({ where: { key: body.key } });
  if (existing) {
    const asset = confirmedAssetForRetry(existing, projectId, body);
    await prisma.pendingAssetUpload.deleteMany({ where: { key: body.key, projectId } });
    return asset;
  }
  if (!pending) throw badRequest('Upload expired. Please upload the file again.', { reason: 'asset_upload_expired' });
  const { contentType, size } = await inspectUploadedAsset(body.key, pending).catch(async (error: unknown) => {
    if (error instanceof AppError && error.details?.reason === 'asset_upload_mismatch') await rejectUploadedAsset(projectId, body.key);
    throw error;
  });
  if (body.size !== size || body.contentType !== contentType) {
    throw badRequest('Confirmation metadata must match the reserved upload.', { reason: 'asset_upload_mismatch' });
  }
  const dimensions = await storedImageDimensions(body.key);
  try {
    // A short atomic write batch excludes a cleanup claim. All storage I/O has already finished.
    const [, asset] = await prisma.$transaction([
      prisma.pendingAssetUpload.update({
        where: { key: body.key, projectId, size, contentType, cleanupStartedAt: null, rejectedAt: null },
        data: { cleanupStartedAt: null },
      }),
      prisma.asset.create({
        data: { projectId, key: body.key, url: publicUrlForKey(body.key), contentType, size, createdById: userId, ...dimensions },
      }),
      prisma.pendingAssetUpload.delete({ where: { key: body.key } }),
    ]);
    return asset;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error.code === 'P2002' || error.code === 'P2025')) {
      const confirmed = await prisma.asset.findUnique({ where: { key: body.key } });
      if (confirmed) {
        const asset = confirmedAssetForRetry(confirmed, projectId, body);
        await prisma.pendingAssetUpload.deleteMany({ where: { key: body.key, projectId } });
        return asset;
      }
      if (error.code === 'P2025') throw badRequest('Upload expired. Please upload the file again.', { reason: 'asset_upload_expired' });
      throw conflict('Asset has already been confirmed.');
    }
    throw error;
  }
};

export const listAssets = async (projectId: string): Promise<Asset[]> =>
  await prisma.asset.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 200 });

/** True while anything saved in the project can still point at the stored key:
 *  any page (every language and version, drafts included), the site, language
 *  and page settings, or a published, exported or preview snapshot. Snapshots
 *  taken before the upload cannot hold it, so only later ones are read. */
const assetInUse = async (tx: Pick<typeof prisma, '$queryRaw'>, projectId: string, key: string, since: Date): Promise<boolean> => {
  const [row] = await tx.$queryRaw<{ inUse: boolean }[]>`
    SELECT (
      EXISTS (SELECT 1 FROM "page" WHERE "projectId" = ${projectId}
        AND (strpos("content", ${key}) > 0 OR strpos(COALESCE("config"::text, ''), ${key}) > 0))
      OR EXISTS (SELECT 1 FROM "language" WHERE "projectId" = ${projectId} AND strpos(COALESCE("config"::text, ''), ${key}) > 0)
      OR EXISTS (SELECT 1 FROM "project" WHERE "id" = ${projectId} AND strpos(COALESCE("config"::text, ''), ${key}) > 0)
      OR EXISTS (SELECT 1 FROM "deployment" WHERE "projectId" = ${projectId} AND "createdAt" >= ${since}
        AND strpos(COALESCE("snapshot"::text, ''), ${key}) > 0)
      OR EXISTS (SELECT 1 FROM "export_snapshot" WHERE "projectId" = ${projectId} AND "createdAt" >= ${since}
        AND (strpos("snapshot"::text, ${key}) > 0 OR strpos("assets"::text, ${key}) > 0))
      OR EXISTS (SELECT 1 FROM "git_preview" WHERE "projectId" = ${projectId} AND "createdAt" >= ${since}
        AND strpos(COALESCE("snapshot"::text, ''), ${key}) > 0)
      OR EXISTS (SELECT 1 FROM "git_conflict" AS c
        JOIN "git_sync_operation" AS o ON o."id" = c."operationId"
        JOIN "git_connection" AS g ON g."id" = o."connectionId"
        WHERE g."projectId" = ${projectId} AND c."createdAt" >= ${since}
          AND strpos(concat_ws(' ', c."baseContent", c."oursContent", c."theirsContent", c."resolvedContent"), ${key}) > 0)
    ) AS "inUse"`;
  return row?.inUse ?? true;
};

/** Delete one asset that nothing saved uses any more. The editor calls this when
 *  a writer removes an upload card whose file was already recorded. Anything
 *  still referencing the file keeps it: the answer is 409 asset:in_use. */
export const deleteAsset = async (organizationId: string, projectId: string, assetId: string): Promise<{ id: string }> => {
  await assertProjectInOrg(organizationId, projectId);
  const asset = await prisma.$transaction(async (tx) => {
    // The row lock makes a concurrent delete of the same asset wait, then find nothing.
    const [locked] = await tx.$queryRaw<{ id: string; key: string; size: number; createdAt: Date }[]>`
      SELECT "id", "key", "size", "createdAt" FROM "asset" WHERE "id" = ${assetId} AND "projectId" = ${projectId} FOR UPDATE`;
    if (!locked) throw notFound('asset');
    if (await assetInUse(tx, projectId, locked.key, locked.createdAt)) {
      throw new AppError({ code: 'asset:in_use', message: 'This file is still used by saved content, so it was kept.' });
    }
    await tx.asset.delete({ where: { id: locked.id } });
    // The public route serves only recorded assets, so the file is unreachable from here on.
    // A cleanup record makes the worker retry the storage delete if the one below fails.
    const now = new Date();
    await tx.assetUploadTombstone.createMany({
      data: [
        {
          key: locked.key,
          projectId,
          size: locked.size,
          urlExpiresAt: new Date(0),
          firstRecheckedAt: now,
          nextCheckAt: new Date(now.getTime() + PENDING_ASSET_UPLOAD_GRACE_MS),
        },
      ],
      skipDuplicates: true,
    });
    return locked;
  });
  try {
    await deleteObject(asset.key);
    await prisma.assetUploadTombstone.deleteMany({ where: { key: asset.key, projectId } });
  } catch {
    log.warn('Asset storage delete will be retried by cleanup.');
  }
  return { id: asset.id };
};
