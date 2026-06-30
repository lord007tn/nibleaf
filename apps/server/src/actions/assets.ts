import { prisma } from '@midad/database';
import { newId } from '@midad/shared/ids';
import { slugify } from '@midad/shared/utils';
import { presignPutUrl } from '@midad/storage';
import type { ConfirmAssetBody, PresignAssetBody } from '@midad/validators';
import { badRequest } from '@/errors';
import { assertProjectInOrg } from './projects';

const assetPrefix = (projectId: string): string => `projects/${projectId}/assets/`;

const assetKey = (projectId: string, filename: string): string => {
  const dot = filename.lastIndexOf('.');
  const ext = dot > -1 ? filename.slice(dot + 1).toLowerCase() : '';
  const base = slugify(dot > -1 ? filename.slice(0, dot) : filename) || 'file';
  return `${assetPrefix(projectId)}${newId()}-${base}${ext ? `.${ext}` : ''}`;
};

/** Guard against IDOR: a client-supplied key must live under this project's asset prefix. */
const assertOwnedKey = (projectId: string, key: string): void => {
  if (!key.startsWith(assetPrefix(projectId))) {
    throw badRequest('Invalid asset key', { key });
  }
};

// Assets are served by the API proxy (GET /api/public/assets/<key>) — a stable,
// browser-reachable, same-origin URL that needs no anonymous-bucket access or
// presigned-URL expiry. The server streams the object from storage internally.
const publicUrlForKey = (key: string): string => `/api/public/assets/${key}`;

export const presignAsset = async (organizationId: string, projectId: string, body: PresignAssetBody) => {
  await assertProjectInOrg(organizationId, projectId);
  const key = assetKey(projectId, body.filename);
  const uploadUrl = await presignPutUrl({ key, contentType: body.contentType });
  return { key, uploadUrl };
};

export const confirmAsset = async (organizationId: string, projectId: string, userId: string, body: ConfirmAssetBody) => {
  await assertProjectInOrg(organizationId, projectId);
  assertOwnedKey(projectId, body.key);
  return prisma.asset.create({
    data: { projectId, key: body.key, url: publicUrlForKey(body.key), contentType: body.contentType, size: body.size, createdById: userId },
  });
};

export const listAssets = (projectId: string) => prisma.asset.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 200 });
