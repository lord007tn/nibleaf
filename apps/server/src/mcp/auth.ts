import { timingSafeEqual } from 'node:crypto';
import type { AuthInfo } from '@modelcontextprotocol/server';
import { createMcpDpopReplayStore, isMcpAccessTokenError, MCP_DPOP_SIGNING_ALGORITHMS } from '@nibleaf/auth/mcp-oauth';
import { auth, mcpOAuth, verifyMcpAccessToken } from '@nibleaf/auth/server';
import { prisma } from '@nibleaf/database';
import { createLogger } from '@nibleaf/logger';
import type { MemberRole } from '@nibleaf/shared/constants';
import { hashApiKeySecret } from '@nibleaf/shared/crypto';
import { isMcpWriteScope, MCP_OAUTH_CHALLENGE_SCOPES, MCP_SCOPES, type McpScope, mcpScopesForRole } from '@nibleaf/shared/mcp';
import type { Context } from 'hono';
import { env } from '@/env';
import type { HonoEnv } from '@/lib/hono/context';
import type { McpPrincipal } from './types';

const log = createLogger({ module: 'mcp-auth' });
const apiKeyBearerPattern = /^Bearer\s+(plm_(?:live|test)_[0-9A-Za-z]{32})$/;
/** An OAuth access token shaped like a compact JWS (RFC 6750 b64token
 *  characters), sent as a bearer token or as a DPoP-bound one (RFC 9449). */
const oauthTokenPattern = /^(Bearer|DPoP)\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;
const issuableScopes = new Set<string>(MCP_SCOPES);

type TokenScheme = 'Bearer' | 'DPoP';
type Challenge = { error?: 'invalid_token' | 'insufficient_scope' | 'invalid_dpop_proof'; description?: string; scope?: readonly string[] };
/** How the OAuth token was presented, and whether its failure was the DPoP
 *  sender constraint (so the client is told to use DPoP). */
type DpopContext = { scheme: TokenScheme; hint: boolean };

/** DPoP proof `jti`s are reserved in the database, so a captured proof cannot
 *  be replayed against another API instance either. */
const dpopReplayStore = createMcpDpopReplayStore(() => auth.$context);

const quoted = (value: string) => `"${value.replace(/["\\]/g, '')}"`;

/**
 * RFC 6750 Bearer or RFC 9449 §7.1 DPoP challenge. With OAuth on, the Bearer
 * challenge carries the RFC 9728 `resource_metadata` pointer, which is how MCP
 * clients discover where to sign in; the first (credential-less) challenge also
 * suggests the scopes to ask for. The DPoP challenge names the accepted proof
 * algorithms (`algs`). No DPoP nonce is required, so never `use_dpop_nonce`.
 */
const mcpChallenge = (scheme: TokenScheme, challenge: Challenge = {}) =>
  [
    `${scheme} realm="Nibleaf MCP"`,
    challenge.error ? `error=${quoted(challenge.error)}` : null,
    challenge.description ? `error_description=${quoted(challenge.description)}` : null,
    mcpOAuth && challenge.scope?.length ? `scope=${quoted(challenge.scope.join(' '))}` : null,
    mcpOAuth && scheme === 'Bearer' ? `resource_metadata=${quoted(mcpOAuth.resourceMetadata)}` : null,
    scheme === 'DPoP' ? `algs=${quoted(MCP_DPOP_SIGNING_ALGORITHMS.join(' '))}` : null,
  ]
    .filter(Boolean)
    .join(', ');

/**
 * The Bearer challenge always comes first, since MCP clients read
 * `resource_metadata` from it. For a request made with the DPoP scheme the
 * error moves to a DPoP challenge; a DPoP failure on a Bearer request (a
 * DPoP-bound token sent as Bearer) adds a bare DPoP challenge.
 */
const challengeHeaders = (challenge: Challenge, dpop?: DpopContext): string[] => {
  if (!(mcpOAuth && dpop)) return [mcpChallenge('Bearer', challenge)];
  if (dpop.scheme === 'DPoP') return [mcpChallenge('Bearer'), mcpChallenge('DPoP', challenge)];
  return dpop.hint ? [mcpChallenge('Bearer', challenge), mcpChallenge('DPoP')] : [mcpChallenge('Bearer', challenge)];
};

const authError = (
  status: 401 | 403,
  code: 'auth:invalid_api_key' | 'auth:invalid_token' | 'auth:insufficient_scope',
  message: string,
  challenge: Challenge | null,
  dpop?: DpopContext,
) => {
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' });
  if (challenge) for (const value of challengeHeaders(challenge, dpop)) headers.append('www-authenticate', value);
  return new Response(JSON.stringify({ error: { code, message } }), { status, headers });
};

const constantTimeHashMatch = (candidate: string, stored: string) => {
  const left = Buffer.from(candidate, 'hex');
  const right = Buffer.from(stored, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
};

/**
 * The person a credential acts as, with their CURRENT role in the project's
 * organization, read on every request (never cached on the credential). Someone
 * who has left the organization or been suspended loses access outright, the
 * same lockout `isAuthenticated` applies to their dashboard session. A key with
 * no creator is revoked too: the dashboard has always recorded the creator, so
 * a null `createdById` means the user was deleted (`onDelete: SetNull`), and an
 * orphaned key must not outlive its owner's access.
 */
const resolveActor = async (userId: string | null, organizationId: string): Promise<McpPrincipal['actor'] | 'revoked'> => {
  if (!userId) return 'revoked';
  const member = await prisma.member.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { role: true, user: { select: { suspendedAt: true } } },
  });
  if (!member || member.user.suspendedAt) return 'revoked';
  return { userId, role: member.role as MemberRole };
};

/** Issuable scopes on the credential that its actor's current role still grants. */
const effectiveScopes = (credentialScopes: readonly string[], actor: McpPrincipal['actor']): McpScope[] => {
  const allowed = new Set<string>(actor ? mcpScopesForRole(actor.role) : MCP_SCOPES.filter((scope) => !isMcpWriteScope(scope)));
  return credentialScopes.filter((scope): scope is McpScope => issuableScopes.has(scope) && allowed.has(scope));
};

const bindContext = (ctx: Context<HonoEnv>, principal: McpPrincipal) => {
  ctx.set('apiKey', {
    id: principal.credential.id,
    kind: principal.credential.kind,
    projectId: principal.project.id,
    scopes: principal.credential.scopes,
  });
  ctx.set('project', principal.project);
  ctx.set('organizationId', principal.project.organizationId);
  ctx.set('membership', null);
  ctx.set('user', null);
  ctx.set('session', null);
};

const invalidApiKey = () => authError(401, 'auth:invalid_api_key', 'The API key is invalid, expired, or revoked.', { error: 'invalid_token' });

const authenticateApiKey = async (ctx: Context<HonoEnv>, secret: string): Promise<McpPrincipal | Response> => {
  const digest = hashApiKeySecret(secret);
  const key = await prisma.apiKey.findUnique({
    where: { hashedSecret: digest },
    select: {
      id: true,
      name: true,
      hashedSecret: true,
      scopes: true,
      expiresAt: true,
      revokedAt: true,
      createdById: true,
      project: { select: { id: true, name: true, organizationId: true } },
    },
  });
  const hashMatches = constantTimeHashMatch(digest, key?.hashedSecret ?? '0'.repeat(64));
  if (!(key && hashMatches) || key.revokedAt || !key.expiresAt || key.expiresAt <= new Date()) return invalidApiKey();

  const actor = await resolveActor(key.createdById, key.project.organizationId);
  if (actor === 'revoked') return invalidApiKey();

  const scopes = effectiveScopes(key.scopes, actor);
  if (!scopes.includes('mcp:connect')) {
    return authError(403, 'auth:insufficient_scope', 'The API key does not grant MCP connection access.', null);
  }

  const principal: McpPrincipal = {
    credential: { kind: 'api_key', id: key.id, name: key.name, scopes, expiresAt: key.expiresAt },
    project: key.project,
    actor,
  };
  bindContext(ctx, principal);
  void prisma.apiKey
    .update({ where: { id: key.id }, data: { lastUsedAt: new Date() }, select: { id: true } })
    .catch((error) =>
      log.warn({ apiKeyId: key.id, errorName: error instanceof Error ? error.name : 'UnknownError' }, 'could not update MCP API key usage timestamp'),
    );
  return principal;
};

const invalidToken = (description: string, dpop: DpopContext, error: 'invalid_token' | 'invalid_dpop_proof' = 'invalid_token') =>
  authError(401, 'auth:invalid_token', description, { error, description }, dpop);

/**
 * An OAuth access token acts as the person who connected the app, on the ONE
 * project of its connection (McpOAuthGrant). The token proves who and which
 * connection; the grant row, the membership and the role are re-read here on
 * every request, so revoking the connection, removing or suspending the
 * person, or lowering their role takes effect immediately. Effective scopes
 * are the grant's preset ∩ the token's scopes ∩ the role's current ceiling.
 */
const authenticateOAuthToken = async (ctx: Context<HonoEnv>, scheme: TokenScheme, token: string): Promise<McpPrincipal | Response> => {
  const dpop: DpopContext = { scheme, hint: false };
  if (!verifyMcpAccessToken) return invalidToken('The access token is invalid or expired.', dpop);
  let verified: Awaited<ReturnType<typeof verifyMcpAccessToken>>;
  try {
    verified = await verifyMcpAccessToken(
      { authorization: `${scheme} ${token}`, dpopProof: ctx.req.header('dpop'), method: ctx.req.method },
      dpopReplayStore,
    );
  } catch (error) {
    if (!isMcpAccessTokenError(error)) throw error;
    // Token problems stay vague; a DPoP failure says what the client must fix.
    return invalidToken(error.dpop ? error.message : 'The access token is invalid or expired.', { scheme, hint: error.dpop }, error.code);
  }
  const grant = await prisma.mcpOAuthGrant.findUnique({
    where: { id: verified.grantId },
    select: {
      id: true,
      userId: true,
      clientId: true,
      clientName: true,
      scopes: true,
      revokedAt: true,
      project: { select: { id: true, name: true, organizationId: true } },
      client: { select: { name: true } },
    },
  });
  if (
    !grant ||
    grant.revokedAt ||
    grant.userId !== verified.userId ||
    grant.clientId !== verified.clientId ||
    grant.project.id !== verified.projectId
  ) {
    return invalidToken('This connection was revoked. Connect the app to Nibleaf again.', dpop);
  }

  const actor = await resolveActor(grant.userId, grant.project.organizationId);
  if (actor === 'revoked') return invalidToken('This connection was revoked. Connect the app to Nibleaf again.', dpop);

  const tokenScopes = new Set(verified.scopes);
  if (!tokenScopes.has('mcp:connect')) {
    return authError(
      403,
      'auth:insufficient_scope',
      'The access token does not grant MCP connection access.',
      { error: 'insufficient_scope', description: 'The access token is missing the mcp:connect scope.', scope: ['mcp:connect'] },
      dpop,
    );
  }
  const scopes = effectiveScopes(
    grant.scopes.filter((scope) => tokenScopes.has(scope)),
    actor,
  );
  if (!scopes.includes('mcp:connect')) {
    // Re-authorizing cannot fix a role that no longer allows MCP: no challenge.
    return authError(403, 'auth:insufficient_scope', 'Your current project role does not allow MCP access.', null);
  }

  const principal: McpPrincipal = {
    credential: {
      kind: 'oauth',
      id: grant.id,
      name: grant.client.name?.trim() || grant.clientName,
      clientId: verified.clientId,
      scopes,
      expiresAt: verified.expiresAt,
    },
    project: grant.project,
    actor,
  };
  bindContext(ctx, principal);
  void prisma.mcpOAuthGrant
    .update({ where: { id: grant.id }, data: { lastUsedAt: new Date() }, select: { id: true } })
    .catch((error) =>
      log.warn({ grantId: grant.id, errorName: error instanceof Error ? error.name : 'UnknownError' }, 'could not update MCP OAuth usage timestamp'),
    );
  return principal;
};

export const authenticateMcpRequest = async (ctx: Context<HonoEnv>): Promise<McpPrincipal | Response> => {
  if (!env.MCP_ENABLED) {
    return new Response(JSON.stringify({ error: { code: 'mcp:disabled', message: 'MCP is disabled for this Nibleaf instance.' } }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
    });
  }
  const authorization = ctx.req.header('authorization') ?? '';
  const apiKey = apiKeyBearerPattern.exec(authorization)?.[1];
  if (apiKey) return authenticateApiKey(ctx, apiKey);
  const oauthToken = mcpOAuth ? oauthTokenPattern.exec(authorization) : null;
  if (oauthToken?.[1] && oauthToken[2]) return authenticateOAuthToken(ctx, oauthToken[1] as TokenScheme, oauthToken[2]);
  return authorization
    ? authError(401, 'auth:invalid_api_key', 'A valid bearer API key or access token is required.', { error: 'invalid_token' })
    : authError(401, 'auth:invalid_api_key', 'Sign in with OAuth or send a personal API key as a bearer token.', {
        scope: MCP_OAUTH_CHALLENGE_SCOPES,
      });
};

export const mcpAuthInfo = (principal: McpPrincipal): AuthInfo => ({
  token: '[redacted]',
  clientId: principal.credential.clientId ?? principal.credential.id,
  scopes: principal.credential.scopes,
  expiresAt: Math.floor(principal.credential.expiresAt.getTime() / 1000),
});
