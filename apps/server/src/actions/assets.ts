import { type Asset, prisma } from '@nibleaf/database';
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
import { deleteObject, headObject, isNotFound, presignPutUrl, putObject, UPLOAD_PRESIGN_EXPIRES_IN_SECONDS } from '@nibleaf/storage';
import { type ConfirmAssetBody, type PresignAssetBody, safeInlineAssetContentType } from '@nibleaf/validators';
import { AppError, badRequest, conflict } from '@/errors';
import { assertProjectInOrg } from './projects';

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
  return prisma.asset.upsert({
    where: { key },
    create: { projectId, key, url: publicUrlForKey(key), contentType, size: bytes.byteLength, createdById },
    update: { contentType, size: bytes.byteLength },
  });
};

export const findImportedAsset = async (projectId: string, importId: string, filename: string): Promise<Asset | null> =>
  await prisma.asset.findUnique({ where: { key: importedAssetKey(projectId, importId, filename) } });

export const presignAsset = async (organizationId: string, projectId: string, body: PresignAssetBody) => {
  await assertProjectInOrg(organizationId, projectId);
  const key = assetKey(projectId, body.filename);
  const signingDate = new Date();
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
        expiresAt: new Date(signingDate.getTime() + PENDING_ASSET_UPLOAD_GRACE_MS),
        urlExpiresAt: new Date(signingDate.getTime() + UPLOAD_PRESIGN_EXPIRES_IN_SECONDS * 1000 + ASSET_UPLOAD_CLOCK_SKEW_MS),
      },
    });
  });
  const uploadUrl = await presignPutUrl({ key, contentType: body.contentType, contentLength: body.size, signingDate });
  return { key, uploadUrl, contentType: body.contentType };
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
  try {
    // A short atomic write batch excludes a cleanup claim. All storage I/O has already finished.
    const [, asset] = await prisma.$transaction([
      prisma.pendingAssetUpload.update({
        where: { key: body.key, projectId, size, contentType, cleanupStartedAt: null, rejectedAt: null },
        data: { cleanupStartedAt: null },
      }),
      prisma.asset.create({
        data: { projectId, key: body.key, url: publicUrlForKey(body.key), contentType, size, createdById: userId },
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
