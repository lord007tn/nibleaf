import { prisma } from '@nibleaf/database';
import { hashApiKeySecret } from '@nibleaf/shared/crypto';
import { newApiKeySecret } from '@nibleaf/shared/ids';
import type { CreateApiKeyBody, RotateApiKeyBody } from '@nibleaf/validators';
import { notFound } from '@/errors';
import { assertProjectInOrg } from './projects';

const expiresAt = (days: number) => new Date(Date.now() + days * 86_400_000);
const apiKeyDto = <T extends { scopes: string[]; expiresAt: Date | null; revokedAt: Date | null }>(key: T) => {
  const legacy = !key.expiresAt || !key.scopes.includes('mcp:connect');
  const state = key.revokedAt ? 'revoked' : key.expiresAt && key.expiresAt <= new Date() ? 'expired' : legacy ? 'rotation_required' : 'active';
  return { ...key, legacy, state };
};

export const listApiKeys = async (organizationId: string, projectId: string) => {
  await assertProjectInOrg(organizationId, projectId);
  const keys = await prisma.apiKey.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      lastFour: true,
      scopes: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
      rotatedFromId: true,
    },
  });
  return keys.map(apiKeyDto);
};

export const createApiKey = async (organizationId: string, projectId: string, createdById: string, body: CreateApiKeyBody) => {
  await assertProjectInOrg(organizationId, projectId);
  const { secret } = newApiKeySecret('live');
  const key = await prisma.apiKey.create({
    data: {
      projectId,
      createdById,
      name: body.name,
      hashedSecret: hashApiKeySecret(secret),
      lastFour: secret.slice(-4),
      scopes: body.scopes,
      expiresAt: expiresAt(body.expiresInDays),
    },
    select: {
      id: true,
      name: true,
      lastFour: true,
      scopes: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
      rotatedFromId: true,
    },
  });
  return { ...apiKeyDto(key), secret };
};

export const rotateApiKey = async (organizationId: string, projectId: string, id: string, createdById: string, body: RotateApiKeyBody) => {
  await assertProjectInOrg(organizationId, projectId);
  const { secret } = newApiKeySecret('live');
  const key = await prisma.$transaction(async (tx) => {
    const current = await tx.apiKey.findFirst({ where: { id, projectId }, select: { id: true, name: true } });
    if (!current) throw notFound('api key', { id });
    await tx.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    return tx.apiKey.create({
      data: {
        projectId,
        createdById,
        rotatedFromId: current.id,
        name: current.name,
        hashedSecret: hashApiKeySecret(secret),
        lastFour: secret.slice(-4),
        scopes: body.scopes,
        expiresAt: expiresAt(body.expiresInDays),
      },
      select: {
        id: true,
        name: true,
        lastFour: true,
        scopes: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        rotatedFromId: true,
      },
    });
  });
  return { ...apiKeyDto(key), secret };
};

export const revokeApiKey = async (organizationId: string, projectId: string, id: string) => {
  await assertProjectInOrg(organizationId, projectId);
  const current = await prisma.apiKey.findFirst({ where: { id, projectId }, select: { id: true, revokedAt: true } });
  if (!current) throw notFound('api key', { id });
  const key = await prisma.apiKey.update({
    where: { id },
    data: current.revokedAt ? {} : { revokedAt: new Date() },
    select: {
      id: true,
      name: true,
      lastFour: true,
      scopes: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
      rotatedFromId: true,
    },
  });
  return apiKeyDto(key);
};
