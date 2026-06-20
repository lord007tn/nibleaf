import { prisma } from '@plume/database';
import { hashApiKeySecret } from '@plume/shared/crypto';
import { newApiKeySecret } from '@plume/shared/ids';
import type { CreateApiKeyBody } from '@plume/validators';
import { notFound } from '@/errors';
import { assertProjectInOrg } from './projects';

const publicSelect = {
  id: true,
  name: true,
  lastFour: true,
  scopes: true,
  createdAt: true,
  lastUsedAt: true,
  revokedAt: true,
} as const;

export const listApiKeys = (projectId: string) => prisma.apiKey.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, select: publicSelect });

/** Create a key and return the full secret ONCE (only its hash is stored). */
export const createApiKey = async (organizationId: string, projectId: string, body: CreateApiKeyBody) => {
  await assertProjectInOrg(organizationId, projectId);
  const { secret } = newApiKeySecret('live');
  const key = await prisma.apiKey.create({
    data: { projectId, name: body.name, hashedSecret: hashApiKeySecret(secret), lastFour: secret.slice(-4), scopes: body.scopes },
    select: publicSelect,
  });
  return { ...key, secret };
};

export const revokeApiKey = async (organizationId: string, projectId: string, id: string) => {
  await assertProjectInOrg(organizationId, projectId);
  const key = await prisma.apiKey.findFirst({ where: { id, projectId }, select: { id: true } });
  if (!key) {
    throw notFound('api key', { id });
  }
  return prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() }, select: publicSelect });
};
