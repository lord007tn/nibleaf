import { cimd } from '@better-auth/cimd';
import { fetchClientMetadataResource } from '@better-auth/cimd/node';
import { mcp } from '@better-auth/mcp';
import { getOAuthProviderState, verifyOAuthQueryParams } from '@better-auth/oauth-provider';
import { prisma } from '@nibleaf/database';
import { MCP_OAUTH_GRANT_CLAIM, MCP_OAUTH_HANDOFF_PATH, MCP_OAUTH_PROJECT_CLAIM, MCP_OAUTH_SCOPES, mcpOAuthUrls } from '@nibleaf/shared/mcp';
import { APIError } from 'better-auth/api';
import { verifyJwsAccessToken } from 'better-auth/oauth2';
import { jwt } from 'better-auth/plugins';

type JsonWebKeySet = { keys: Array<Record<string, unknown>> };
type AccessTokenPayload = Awaited<ReturnType<typeof verifyJwsAccessToken>>;

/** A project choice that no token has used yet expires after this long. */
export const MCP_OAUTH_PENDING_GRANT_TTL_MS = 15 * 60_000;

/** Better Auth endpoints the MCP flow never needs. `/token` is the JWT
 *  plugin's session-token route (session JWTs share the access-token signing
 *  key); the others are session-backed client management, which would let any
 *  signed-in person mint or edit OAuth clients outside dynamic registration. */
export const MCP_OAUTH_DISABLED_PATHS = [
  '/token',
  '/oauth2/create-client',
  '/oauth2/update-client',
  '/oauth2/delete-client',
  '/oauth2/get-client',
  '/oauth2/get-clients',
  '/oauth2/client/rotate-secret',
] as const;

const isLoopbackHost = (hostname: string) =>
  hostname === 'localhost' || hostname === '[::1]' || /^127(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(hostname);

/** The OAuth settings for this instance, or null when OAuth is off: MCP is
 *  disabled, or the public URL is plain HTTP on a non-loopback host (OAuth 2.1
 *  and the MCP plugin require HTTPS there; API keys keep working). */
export const resolveMcpOAuthConfig = (env: { MCP_ENABLED: boolean; BETTER_AUTH_URL: string }) => {
  if (!env.MCP_ENABLED) return null;
  const urls = mcpOAuthUrls(env.BETTER_AUTH_URL);
  const { protocol, hostname } = new URL(urls.origin);
  if (protocol !== 'https:' && !(protocol === 'http:' && isLoopbackHost(hostname))) return null;
  return urls;
};

export type McpOAuthConfig = NonNullable<ReturnType<typeof resolveMcpOAuthConfig>>;

/** The parameters Better Auth signed (it lists them in `ba_param`), or null
 *  when the query carries no signature. Anything else in a URL is ignored. */
export const signedOAuthQuerySubset = (raw: string) => {
  const params = new URLSearchParams(raw.replace(/^\?/, ''));
  const signedNames = new Set(params.getAll('ba_param'));
  if (!params.has('sig') || signedNames.size === 0) return null;
  const signed = new URLSearchParams();
  for (const [name, value] of params) if (name === 'sig' || name === 'ba_param' || signedNames.has(name)) signed.append(name, value);
  return signed.toString();
};

/** Verify the signed authorization query Better Auth hands to the sign-in,
 *  project and consent pages; null when its signature is bad or it expired. */
export const readSignedOAuthQuery = async (raw: string, secret: string) => {
  const query = signedOAuthQuerySubset(raw);
  if (!(query && (await verifyOAuthQueryParams(query, secret)))) return null;
  const signed = new URLSearchParams(query);
  const clientId = signed.get('client_id');
  if (!clientId) return null;
  return {
    query,
    clientId,
    scopes: (signed.get('scope') ?? '').split(' ').filter(Boolean),
    redirectUri: signed.get('redirect_uri'),
  };
};

const clientIdOfCurrentRequest = async () => {
  const state = await getOAuthProviderState();
  return state?.query ? new URLSearchParams(state.query).get('client_id') : null;
};

/** The project choice the signed-in person made for this client in this
 *  browser session and that no token has used yet. */
const findPendingMcpGrant = (params: { sessionId: string; userId: string; clientId: string }, now = Date.now()) =>
  prisma.mcpOAuthGrant.findFirst({
    where: {
      sessionId: params.sessionId,
      userId: params.userId,
      clientId: params.clientId,
      activatedAt: null,
      revokedAt: null,
      createdAt: { gt: new Date(now - MCP_OAUTH_PENDING_GRANT_TTL_MS) },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });

const connectionRevoked = () =>
  new APIError('BAD_REQUEST', { error: 'invalid_grant', error_description: 'This connection was revoked. Connect the app to Nibleaf again.' });

/**
 * The postLogin step binds each authorization to ONE project and preset. After
 * sign-in the person is sent to the project page, which records a pending
 * McpOAuthGrant and resumes the flow; its id becomes the consent reference, so
 * consent, the authorization code and every token carry it.
 */
const postLogin = {
  page: `${MCP_OAUTH_HANDOFF_PATH}/project`,
  // A fresh authorization always asks for the project. On return through
  // /oauth2/continue the pending choice must exist: the flag alone is
  // client-controlled and proves nothing.
  shouldRedirect: async ({ session, user, isContinuation }: { session: { id: string }; user: { id: string }; isContinuation: boolean }) => {
    if (!isContinuation) return true;
    const clientId = await clientIdOfCurrentRequest();
    if (!clientId) return true;
    return !(await findPendingMcpGrant({ sessionId: session.id, userId: user.id, clientId }));
  },
  consentReferenceId: async ({ session, user }: { session: { id: string }; user: { id: string } }) => {
    const clientId = await clientIdOfCurrentRequest();
    const grant = clientId ? await findPendingMcpGrant({ sessionId: session.id, userId: user.id, clientId }) : null;
    if (!grant) {
      throw new APIError('BAD_REQUEST', { error: 'invalid_request', error_description: 'Choose a project for this connection first.' });
    }
    return grant.id;
  },
};

/** Runs for every JWT access token, at the code exchange and on each refresh:
 *  the connection must still exist, belong to the token's user and be live. */
const customAccessTokenClaims = async ({ user, referenceId }: { user?: { id: string } | null; referenceId?: string }) => {
  if (!(referenceId && user)) throw connectionRevoked();
  const grant = await prisma.mcpOAuthGrant.findUnique({
    where: { id: referenceId },
    select: { id: true, userId: true, clientId: true, projectId: true, revokedAt: true, activatedAt: true },
  });
  if (!grant || grant.revokedAt || grant.userId !== user.id) throw connectionRevoked();
  if (!grant.activatedAt) await activateMcpGrant(grant);
  return { [MCP_OAUTH_GRANT_CLAIM]: grant.id, [MCP_OAUTH_PROJECT_CLAIM]: grant.projectId };
};

/**
 * The first token makes a connection live. Connecting the same app to the same
 * project again (for example after its refresh token expired) replaces the
 * person's earlier connection, so Connected apps never lists stale duplicates.
 */
export const activateMcpGrant = async (grant: { id: string; userId: string; clientId: string; projectId: string }, now = new Date()) => {
  const superseded = await prisma.mcpOAuthGrant.findMany({
    where: {
      id: { not: grant.id },
      userId: grant.userId,
      clientId: grant.clientId,
      projectId: grant.projectId,
      revokedAt: null,
      activatedAt: { not: null },
    },
    select: { id: true },
  });
  const ids = superseded.map(({ id }) => id);
  await prisma.$transaction([
    prisma.mcpOAuthGrant.updateMany({ where: { id: grant.id, activatedAt: null }, data: { activatedAt: now } }),
    prisma.mcpOAuthGrant.updateMany({ where: { id: { in: ids }, revokedAt: null }, data: { revokedAt: now } }),
    prisma.oauthRefreshToken.updateMany({ where: { referenceId: { in: ids }, revoked: null }, data: { revoked: now } }),
    prisma.oauthAccessToken.updateMany({ where: { referenceId: { in: ids }, revoked: null }, data: { revoked: now } }),
  ]);
};

/**
 * Better Auth as the OAuth 2.1 authorization server for the MCP endpoint, per
 * https://www.better-auth.com/docs/plugins/mcp: `jwt` signs audience-bound
 * access tokens, `mcp` is the provider plus RFC 9728 metadata, and `cimd`
 * accepts Client ID Metadata Documents. Dynamic registration is open for
 * public clients (claude.ai and ChatGPT register this way); PKCE is required.
 */
export const mcpOAuthPlugins = (config: McpOAuthConfig) => [
  jwt({ disableSettingJwtHeader: true, jwt: { issuer: config.issuer } }),
  mcp({
    loginPage: `${MCP_OAUTH_HANDOFF_PATH}/sign-in`,
    consentPage: `${MCP_OAUTH_HANDOFF_PATH}/consent`,
    resource: config.resource,
    // Prisma stores an absent list as []; an explicit allowlist keeps the
    // resource's scope intersection from collapsing to nothing.
    resources: [{ identifier: config.resource, name: 'Nibleaf MCP', allowedScopes: [...MCP_OAUTH_SCOPES] }],
    resourceSeedMode: 'overwrite',
    scopes: [...MCP_OAUTH_SCOPES],
    clientRegistrationDefaultScopes: [...MCP_OAUTH_SCOPES],
    // No client_credentials: a token must act as a person bound to a project.
    grantTypes: ['authorization_code', 'refresh_token'],
    allowDynamicClientRegistration: true,
    allowUnauthenticatedClientRegistration: true,
    clientRegistrationDefaultApplicationType: 'infer',
    // Strict rotation: no MCP client here is known to lose refresh responses.
    refreshTokenReuseInterval: 0,
    postLogin,
    customAccessTokenClaims,
    // Session-backed client and resource management stays closed; dynamic
    // registration needs `create` when a browser happens to carry a session.
    clientPrivileges: ({ action }) => action === 'create',
    resourcePrivileges: () => false,
    prefix: { refreshToken: 'nlrt_', opaqueAccessToken: 'nlat_', clientSecret: 'nlcs_' },
    // Hosted clients (ChatGPT, claude.ai) register and refresh from shared
    // egress addresses, so the per-IP defaults (5 and 20 a minute) are too low.
    rateLimit: { register: { window: 60, max: 30 }, token: { window: 60, max: 120 } },
  }),
  cimd({ fetchClientMetadataResource, metadataProfile: 'mcp-2026-07-28' }),
];

export interface VerifiedMcpAccessToken {
  userId: string;
  clientId: string;
  grantId: string;
  projectId: string;
  scopes: string[];
  expiresAt: Date;
}

export class McpAccessTokenError extends Error {}

/**
 * Local verification of an MCP access token: signature against this
 * instance's JWKS (loaded in-process, never over the public URL), issuer,
 * audience = the MCP resource, expiry, the `at+jwt` type, and the Nibleaf
 * connection claims. DPoP-bound tokens are refused; the MCP endpoint accepts
 * bearer tokens only.
 */
export const createMcpAccessTokenVerifier = (config: McpOAuthConfig, loadJwks: () => Promise<JsonWebKeySet | undefined>) => {
  const cacheKey = {};
  return async (token: string): Promise<VerifiedMcpAccessToken> => {
    let payload: AccessTokenPayload;
    try {
      payload = await verifyJwsAccessToken(token, {
        jwksFetch: loadJwks,
        jwksCacheKey: cacheKey,
        verifyOptions: { issuer: config.issuer, audience: config.resource, typ: 'at+jwt', requiredClaims: ['sub', 'azp', 'exp'] },
      });
    } catch {
      throw new McpAccessTokenError('The access token is invalid or expired.');
    }
    const grantId = payload[MCP_OAUTH_GRANT_CLAIM];
    const projectId = payload[MCP_OAUTH_PROJECT_CLAIM];
    const scope = payload.scope;
    if (payload.cnf !== undefined) throw new McpAccessTokenError('Sender-constrained tokens are not supported here.');
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.azp !== 'string' ||
      typeof grantId !== 'string' ||
      typeof projectId !== 'string' ||
      typeof scope !== 'string' ||
      typeof payload.exp !== 'number'
    ) {
      throw new McpAccessTokenError('The access token is not a Nibleaf MCP connection token.');
    }
    return {
      userId: payload.sub,
      clientId: payload.azp,
      grantId,
      projectId,
      scopes: scope.split(' ').filter(Boolean),
      expiresAt: new Date(payload.exp * 1000),
    };
  };
};
