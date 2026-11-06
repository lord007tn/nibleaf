import { MCP_OAUTH_PENDING_GRANT_TTL_MS, readSignedOAuthQuery } from '@nibleaf/auth/mcp-oauth';
import { Prisma, prisma } from '@nibleaf/database';
import { MCP_KEY_PRESETS, type McpKeyPreset, mcpPresetScopesForRole } from '@nibleaf/shared/mcp';
import { canAdminister } from '@nibleaf/shared/rbac';
import type { CreateMcpOAuthGrantBody } from '@nibleaf/validators';
import { env } from '@/env';
import { AppError, forbidden, notFound } from '@/errors';
import { assertProjectAccess, assertProjectInOrg } from './projects';

type Actor = { id: string; role: string };
type SessionRef = { id: string; userId: string };

const expiredRequest = () =>
  new AppError({
    code: 'http:bad_request',
    message: 'This connection request expired or is invalid. Start connecting from your AI app again.',
  });

/** The signed authorization request and its (enabled) OAuth client. */
const readAuthorizationRequest = async (oauthQuery: string) => {
  const request = await readSignedOAuthQuery(oauthQuery, env.BETTER_AUTH_SECRET);
  if (!request) throw expiredRequest();
  const client = await prisma.oauthClient.findUnique({
    where: { clientId: request.clientId },
    select: { clientId: true, name: true, uri: true, icon: true, clientDiscoveryId: true, disabled: true },
  });
  if (!client || client.disabled) throw expiredRequest();
  return { request, client };
};

/** Where the client sends the person back to: its host, or the app scheme for
 *  a native redirect (`cursor://…`). Shown on consent so a look-alike name
 *  cannot hide the real destination. */
const redirectTarget = (redirectUri: string | null) => {
  if (!redirectUri) return null;
  try {
    const url = new URL(redirectUri);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.host : `${url.protocol}//`;
  } catch {
    return null;
  }
};

const clientDto = (
  client: { clientId: string; name: string | null; uri: string | null; clientDiscoveryId: string | null },
  redirectUri: string | null,
) => ({
  clientId: client.clientId,
  name: client.name?.trim() || null,
  uri: client.uri,
  redirectTarget: redirectTarget(redirectUri),
  /** Identified by a metadata document at an HTTPS URL it controls (CIMD),
   *  rather than a self-asserted dynamic registration. */
  verifiedDomain: client.clientDiscoveryId ? redirectTarget(client.clientId) : null,
});

const assertNotSupportSession = async (sessionId: string) => {
  const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { impersonatedBy: true } });
  if (session?.impersonatedBy) throw forbidden('Support sessions cannot connect AI apps to a project.');
};

const presetsForRole = (role: string) => MCP_KEY_PRESETS.filter((preset) => mcpPresetScopesForRole(preset, role) !== null);

/** What the project and consent pages show for one authorization request. */
export const getMcpOAuthAuthorization = async (user: { id: string }, session: SessionRef, oauthQuery: string) => {
  const { request, client } = await readAuthorizationRequest(oauthQuery);
  const memberships = await prisma.member.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'asc' },
    select: { role: true, organization: { select: { projects: { select: { id: true, name: true }, orderBy: { createdAt: 'asc' } } } } },
  });
  const projects = memberships.flatMap(({ role, organization }) =>
    organization.projects.map((project) => ({ id: project.id, name: project.name, role, presets: presetsForRole(role) })),
  );
  const pending = await prisma.mcpOAuthGrant.findFirst({
    where: {
      sessionId: session.id,
      userId: user.id,
      clientId: client.clientId,
      activatedAt: null,
      revokedAt: null,
      createdAt: { gt: new Date(Date.now() - MCP_OAUTH_PENDING_GRANT_TTL_MS) },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, preset: true, scopes: true, project: { select: { id: true, name: true } } },
  });
  return {
    client: clientDto(client, request.redirectUri),
    requestedScopes: request.scopes,
    projects: projects.filter((project) => project.presets.length > 0),
    selection: pending ? { id: pending.id, preset: pending.preset as McpKeyPreset, scopes: pending.scopes, project: pending.project } : null,
  };
};

/**
 * Record the project and preset the signed-in person chose for this request.
 * Same rules as personal keys: they must belong to the project, and the
 * preset must be one their current role may issue. The row stays pending,
 * bound to this browser session and client, until the first token uses it.
 */
export const createMcpOAuthGrant = async (user: { id: string }, session: SessionRef, body: CreateMcpOAuthGrantBody) => {
  if (session.userId !== user.id) throw forbidden('Sign in again to connect this app.');
  await assertNotSupportSession(session.id);
  const { client } = await readAuthorizationRequest(body.oauthQuery);
  const { project, role } = await assertProjectAccess(user.id, body.projectId);
  const scopes = mcpPresetScopesForRole(body.preset, role);
  if (!scopes) throw forbidden('Your project role cannot grant this permission level.');
  return prisma.$transaction(async (tx) => {
    // One live choice per session and client; abandoned choices age out.
    await tx.mcpOAuthGrant.deleteMany({
      where: {
        userId: user.id,
        activatedAt: null,
        OR: [{ sessionId: session.id, clientId: client.clientId }, { createdAt: { lte: new Date(Date.now() - MCP_OAUTH_PENDING_GRANT_TTL_MS) } }],
      },
    });
    return tx.mcpOAuthGrant.create({
      data: {
        userId: user.id,
        projectId: project.id,
        clientId: client.clientId,
        clientName: (client.name?.trim() || redirectTarget(client.clientId) || 'MCP client').slice(0, 120),
        sessionId: session.id,
        preset: body.preset,
        scopes,
      },
      select: { id: true, projectId: true, preset: true, scopes: true },
    });
  });
};

const ownership = (actor: Actor) => (canAdminister(actor.role) ? {} : { userId: actor.id });

const connectedAppSelect = {
  id: true,
  clientName: true,
  preset: true,
  scopes: true,
  createdAt: true,
  lastUsedAt: true,
  user: { select: { id: true, name: true, email: true } },
  client: { select: { name: true, uri: true } },
} as const;

type ConnectedAppRow = Prisma.McpOAuthGrantGetPayload<{ select: typeof connectedAppSelect }>;

const connectedAppDto = (grant: ConnectedAppRow, actor: Actor) => ({
  id: grant.id,
  name: grant.client.name?.trim() || grant.clientName,
  uri: grant.client.uri,
  preset: grant.preset as McpKeyPreset,
  scopes: grant.scopes,
  createdAt: grant.createdAt,
  lastUsedAt: grant.lastUsedAt,
  connectedBy: grant.user,
  ownedByViewer: grant.user.id === actor.id,
});

/** Live OAuth connections to the project: everyone's for admins, one's own
 *  for members (the personal-key visibility rule). */
export const listConnectedApps = async (organizationId: string, projectId: string, actor: Actor) => {
  await assertProjectInOrg(organizationId, projectId);
  const grants = await prisma.mcpOAuthGrant.findMany({
    where: { projectId, revokedAt: null, activatedAt: { not: null }, ...ownership(actor) },
    orderBy: { createdAt: 'desc' },
    select: connectedAppSelect,
  });
  const events = grants.length
    ? await prisma.$queryRaw<Array<{ oauthGrantId: string; operation: string; outcome: string; at: Date }>>(Prisma.sql`
    SELECT DISTINCT ON ("oauthGrantId") "oauthGrantId", operation, outcome, "createdAt" AS at
    FROM mcp_audit_event WHERE "projectId" = ${projectId} AND "oauthGrantId" IN (${Prisma.join(grants.map((grant) => grant.id))})
    ORDER BY "oauthGrantId", "createdAt" DESC, id DESC
  `)
    : [];
  const activity = new Map(events.map(({ oauthGrantId, ...event }) => [oauthGrantId, event]));
  return grants.map((grant) => ({ ...connectedAppDto(grant, actor), lastActivity: activity.get(grant.id) ?? null }));
};

/** Disconnect an app: the grant is revoked (the MCP server re-reads it on
 *  every call, so access ends at once), its refresh tokens and stored access
 *  tokens are revoked, and its consent is forgotten. */
export const revokeConnectedApp = async (organizationId: string, projectId: string, id: string, actor: Actor) => {
  await assertProjectInOrg(organizationId, projectId);
  const current = await prisma.mcpOAuthGrant.findFirst({
    where: { id, projectId, activatedAt: { not: null }, ...ownership(actor) },
    select: { id: true },
  });
  if (!current) throw notFound('connected app', { id });
  const now = new Date();
  const grant = await prisma.$transaction(async (tx) => {
    await tx.mcpOAuthGrant.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: now, revokedById: actor.id } });
    await tx.oauthRefreshToken.updateMany({ where: { referenceId: id, revoked: null }, data: { revoked: now } });
    await tx.oauthAccessToken.updateMany({ where: { referenceId: id, revoked: null }, data: { revoked: now } });
    await tx.oauthConsent.deleteMany({ where: { referenceId: id } });
    return tx.mcpOAuthGrant.findUniqueOrThrow({ where: { id }, select: connectedAppSelect });
  });
  return connectedAppDto(grant, actor);
};
