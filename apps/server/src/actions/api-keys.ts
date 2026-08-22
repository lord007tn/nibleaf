import { type Prisma, prisma } from '@nibleaf/database';
import { hashApiKeySecret } from '@nibleaf/shared/crypto';
import { newApiKeySecret } from '@nibleaf/shared/ids';
import type { CreateApiKeyBody } from '@nibleaf/validators';
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

type PublicApiKey = Prisma.ApiKeyGetPayload<{ select: typeof publicSelect }>;

export const listApiKeys = async (projectId: string): Promise<PublicApiKey[]> =>
  await prisma.apiKey.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, select: publicSelect });

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
