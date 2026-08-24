import { timingSafeEqual } from 'node:crypto';
import type { AuthInfo } from '@modelcontextprotocol/server';
import { prisma } from '@nibleaf/database';
import { createLogger } from '@nibleaf/logger';
import { hashApiKeySecret } from '@nibleaf/shared/crypto';
import { MCP_SCOPES, type McpScope } from '@nibleaf/shared/mcp';
import type { Context } from 'hono';
import { env } from '@/env';
import type { HonoEnv } from '@/lib/hono/context';
import type { McpPrincipal } from './types';

const log = createLogger({ module: 'mcp-auth' });
const bearerPattern = /^Bearer\s+(plm_(?:live|test)_[0-9A-Za-z]{32})$/;
const issuableScopes = new Set<string>(MCP_SCOPES);

const unauthorized = (code: 'auth:invalid_api_key' | 'auth:insufficient_scope', message: string, status: 401 | 403) =>
  new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'www-authenticate': 'Bearer realm="Nibleaf MCP"',
      'cache-control': 'private, no-store',
    },
  });

const constantTimeHashMatch = (candidate: string, stored: string) => {
  const left = Buffer.from(candidate, 'hex');
  const right = Buffer.from(stored, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
};

export const authenticateMcpRequest = async (ctx: Context<HonoEnv>): Promise<McpPrincipal | Response> => {
  if (!env.MCP_ENABLED) {
    return new Response(JSON.stringify({ error: { code: 'mcp:disabled', message: 'MCP is disabled for this Nibleaf instance.' } }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
    });
  }
  const match = bearerPattern.exec(ctx.req.header('authorization') ?? '');
  if (!match?.[1]) return unauthorized('auth:invalid_api_key', 'A valid bearer API key is required.', 401);

  const digest = hashApiKeySecret(match[1]);
  const key = await prisma.apiKey.findUnique({
    where: { hashedSecret: digest },
    select: {
      id: true,
      name: true,
      hashedSecret: true,
      scopes: true,
      expiresAt: true,
      revokedAt: true,
      project: { select: { id: true, name: true, organizationId: true } },
    },
  });
  const hashMatches = constantTimeHashMatch(digest, key?.hashedSecret ?? '0'.repeat(64));
  if (!(key && hashMatches) || key.revokedAt || !key.expiresAt || key.expiresAt <= new Date()) {
    return unauthorized('auth:invalid_api_key', 'The API key is invalid, expired, or revoked.', 401);
  }

  const scopes = key.scopes.filter((scope): scope is McpScope => issuableScopes.has(scope));
  if (!scopes.includes('mcp:connect')) {
    return unauthorized('auth:insufficient_scope', 'The API key does not grant MCP connection access.', 403);
  }

  const principal: McpPrincipal = {
    apiKey: { id: key.id, name: key.name, scopes, expiresAt: key.expiresAt },
    project: key.project,
  };
  ctx.set('apiKey', { id: key.id, projectId: key.project.id, scopes });
  ctx.set('project', key.project);
  ctx.set('organizationId', key.project.organizationId);
  ctx.set('membership', null);
  ctx.set('user', null);
  ctx.set('session', null);

  void prisma.apiKey
    .update({ where: { id: key.id }, data: { lastUsedAt: new Date() }, select: { id: true } })
    .catch((error) =>
      log.warn({ apiKeyId: key.id, errorName: error instanceof Error ? error.name : 'UnknownError' }, 'could not update MCP API key usage timestamp'),
    );
  return principal;
};

export const mcpAuthInfo = (principal: McpPrincipal): AuthInfo => ({
  token: '[redacted]',
  clientId: principal.apiKey.id,
  scopes: principal.apiKey.scopes,
  expiresAt: Math.floor(principal.apiKey.expiresAt.getTime() / 1000),
});
