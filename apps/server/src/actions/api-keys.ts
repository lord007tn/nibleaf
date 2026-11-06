import { Prisma, prisma } from '@nibleaf/database';
import { hashApiKeySecret } from '@nibleaf/shared/crypto';
import { newApiKeySecret } from '@nibleaf/shared/ids';
import { MCP_KEY_PRESETS, MCP_PRESET_MIN_ROLE, MCP_PRESET_SCOPES, mcpScopesForRole } from '@nibleaf/shared/mcp';
import { canAdminister, roleAtLeast } from '@nibleaf/shared/rbac';
import type { CreateApiKeyBody, RotateApiKeyBody } from '@nibleaf/validators';
import { conflict, forbidden, notFound } from '@/errors';
import { assertProjectInOrg } from './projects';

type Actor = { id: string; role: string };
const keySelect = {
  id: true,
  name: true,
  lastFour: true,
  scopes: true,
  createdAt: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
  rotatedFromId: true,
  createdBy: { select: { id: true, name: true, email: true } },
} as const;
const ownership = (actor: Actor) => (canAdminister(actor.role) ? {} : { createdById: actor.id });
const issueScopes = (body: RotateApiKeyBody, role: string) => {
  if (body.preset && !roleAtLeast(role, MCP_PRESET_MIN_ROLE[body.preset])) throw forbidden('Your project role cannot issue this preset.');
  const scopes = body.preset ? [...MCP_PRESET_SCOPES[body.preset]] : body.scopes;
  const allowed = mcpScopesForRole(role);
  if (!scopes?.length || scopes.some((scope) => !allowed.includes(scope))) throw forbidden('Requested scopes exceed your current project role.');
  return scopes;
};
const expiresAt = (days: number) => new Date(Date.now() + days * 86_400_000);
const apiKeyDto = <T extends { scopes: string[]; expiresAt: Date | null; revokedAt: Date | null }>(key: T) => {
  const legacy = !key.expiresAt || !key.scopes.includes('mcp:connect');
  const state = key.revokedAt ? 'revoked' : key.expiresAt && key.expiresAt <= new Date() ? 'expired' : legacy ? 'rotation_required' : 'active';
  const scopeSet = new Set(key.scopes);
  const preset =
    MCP_KEY_PRESETS.find(
      (preset) => MCP_PRESET_SCOPES[preset].length === scopeSet.size && MCP_PRESET_SCOPES[preset].every((scope) => scopeSet.has(scope)),
    ) ?? 'custom';
  return { ...key, legacy, state, preset, lastActivity: null } as const;
};

export const listApiKeys = async (organizationId: string, projectId: string, actor: Actor) => {
  await assertProjectInOrg(organizationId, projectId);
  const keys = await prisma.apiKey.findMany({ where: { projectId, ...ownership(actor) }, orderBy: { createdAt: 'desc' }, select: keySelect });
  // DISTINCT ON bounds the result to one event per visible key in one query.
  const events = keys.length
    ? await prisma.$queryRaw<Array<{ apiKeyId: string; operation: string; outcome: string; errorCode: string | null; at: Date }>>(Prisma.sql`
    SELECT DISTINCT ON ("apiKeyId") "apiKeyId", operation, outcome, "errorCode", "createdAt" AS at
    FROM mcp_audit_event WHERE "projectId" = ${projectId} AND "apiKeyId" IN (${Prisma.join(keys.map((key) => key.id))})
    ORDER BY "apiKeyId", "createdAt" DESC, id DESC
  `)
    : [];
  const activity = new Map(events.map(({ apiKeyId, ...event }) => [apiKeyId, event]));
  return keys.map((key) => ({ ...apiKeyDto(key), lastActivity: activity.get(key.id) ?? null, ownedByViewer: key.createdBy?.id === actor.id }));
};

export const createApiKey = async (organizationId: string, projectId: string, actor: Actor, body: CreateApiKeyBody) => {
  await assertProjectInOrg(organizationId, projectId);
  const scopes = issueScopes(body, actor.role);
  const { secret } = newApiKeySecret('live');
  const key = await prisma.apiKey.create({
    data: {
      projectId,
      createdById: actor.id,
      name: body.name,
      hashedSecret: hashApiKeySecret(secret),
      lastFour: secret.slice(-4),
      scopes,
      expiresAt: expiresAt(body.expiresInDays),
    },
    select: keySelect,
  });
  return { ...apiKeyDto(key), secret };
};

export const rotateApiKey = async (organizationId: string, projectId: string, id: string, actor: Actor, body: RotateApiKeyBody) => {
  await assertProjectInOrg(organizationId, projectId);
  const scopes = issueScopes(body, actor.role);
  const rotated = await prisma.$transaction(async (tx) => {
    // Rotation re-issues the key AS the caller, so it is limited to the caller's
    // own keys: an admin rotating someone else's key would silently take it over.
    // Admins can still revoke any key.
    const current = await tx.apiKey.findFirst({ where: { id, projectId, createdById: actor.id }, select: { id: true, name: true } });
    if (!current) throw notFound('api key', { id });

    const claimed = await tx.apiKey.updateMany({ where: { id, projectId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (claimed.count !== 1) throw conflict('API key has already been rotated or revoked.');

    const { secret } = newApiKeySecret('live');
    const key = await tx.apiKey.create({
      data: {
        projectId,
        createdById: actor.id,
        rotatedFromId: current.id,
        name: current.name,
        hashedSecret: hashApiKeySecret(secret),
        lastFour: secret.slice(-4),
        scopes,
        expiresAt: expiresAt(body.expiresInDays),
      },
      select: keySelect,
    });
    return { key, secret };
  });
  return { ...apiKeyDto(rotated.key), secret: rotated.secret };
};

export const revokeApiKey = async (organizationId: string, projectId: string, id: string, actor: Actor) => {
  await assertProjectInOrg(organizationId, projectId);
  const current = await prisma.apiKey.findFirst({ where: { id, projectId, ...ownership(actor) }, select: { id: true, revokedAt: true } });
  if (!current) throw notFound('api key', { id });
  const key = await prisma.apiKey.update({
    where: { id },
    data: current.revokedAt ? {} : { revokedAt: new Date() },
    select: keySelect,
  });
  return apiKeyDto(key);
};
