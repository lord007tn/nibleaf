import { MemberRole } from './constants';
import { roleAtLeast } from './rbac';

export const MCP_SCOPES = [
  'mcp:connect',
  'projects:read',
  'pages:read',
  'languages:read',
  'versions:read',
  'analytics:read',
  'search:read',
  'usage:read',
  'entitlements:read',
  'addons:read',
  'themes:read',
  'exports:read',
  'deployments:read',
  'integrations:read',
  /** Raw visitor search terms. They exist only when the project opted into
   *  storing public search terms; aggregate counts stay under analytics:read. */
  'analytics:search_terms',
  /** Create, edit, move, translate, and hide/unhide pages in the working copy.
   *  Nothing written with this scope is live until someone publishes. */
  'pages:write',
  /** Publish the project's pending changes after an explicit preview + confirm. */
  'deployments:publish',
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

/** The minimum dashboard role whose session can already do what each scope
 *  allows. A key may only carry scopes its creator's role grants, and the MCP
 *  server re-checks the creator's CURRENT role on every request, so a key can
 *  never do more than its owner could do in the dashboard right now.
 *  Every scope today maps to a route guarded by `requireProjectMember()` or
 *  `requireProjectRole(MEMBER)`; keep this table in sync with those guards. */
export const MCP_SCOPE_MIN_ROLE: Record<McpScope, MemberRole> = {
  'mcp:connect': MemberRole.MEMBER,
  'projects:read': MemberRole.MEMBER,
  'pages:read': MemberRole.MEMBER,
  'languages:read': MemberRole.MEMBER,
  'versions:read': MemberRole.MEMBER,
  'analytics:read': MemberRole.MEMBER,
  'search:read': MemberRole.MEMBER,
  'usage:read': MemberRole.MEMBER,
  'entitlements:read': MemberRole.MEMBER,
  'addons:read': MemberRole.MEMBER,
  'themes:read': MemberRole.MEMBER,
  'exports:read': MemberRole.MEMBER,
  'deployments:read': MemberRole.MEMBER,
  'integrations:read': MemberRole.MEMBER,
  'analytics:search_terms': MemberRole.MEMBER,
  'pages:write': MemberRole.MEMBER,
  'deployments:publish': MemberRole.MEMBER,
};

/** Scopes that let a key change project state. Keys carrying any of them must
 *  have a live creator (actor) and the creator's role is re-checked per call. */
export const MCP_WRITE_SCOPES = ['pages:write', 'deployments:publish'] as const satisfies ReadonlyArray<McpScope>;

export const isMcpWriteScope = (scope: string): boolean => (MCP_WRITE_SCOPES as ReadonlyArray<string>).includes(scope);

/** Scopes a member with `role` may hold (on a key they create, or effectively
 *  at request time). Unknown roles get nothing. */
export const mcpScopesForRole = (role: string): McpScope[] => MCP_SCOPES.filter((scope) => roleAtLeast(role, MCP_SCOPE_MIN_ROLE[scope]));

export const MCP_KEY_PRESETS = ['read_only', 'support_writer', 'full_admin'] as const;
export type McpKeyPreset = (typeof MCP_KEY_PRESETS)[number];

const READ_ONLY_SCOPES = [
  'mcp:connect',
  'projects:read',
  'pages:read',
  'languages:read',
  'versions:read',
  'analytics:read',
  'search:read',
  'deployments:read',
] as const satisfies ReadonlyArray<McpScope>;

/** Dashboard presets for non-technical staff. `full_admin` is every scope, so
 *  it is only offered to roles that hold every scope (see mcpScopesForRole). */
export const MCP_PRESET_SCOPES: Record<McpKeyPreset, ReadonlyArray<McpScope>> = {
  read_only: READ_ONLY_SCOPES,
  support_writer: [...READ_ONLY_SCOPES, 'analytics:search_terms', 'pages:write', 'deployments:publish'],
  full_admin: MCP_SCOPES,
};

/** The minimum role offered each preset in the dashboard. This is UX gating
 *  only: the security boundary is MCP_SCOPE_MIN_ROLE plus the live per-request
 *  role check, never the preset name. */
export const MCP_PRESET_MIN_ROLE: Record<McpKeyPreset, MemberRole> = {
  read_only: MemberRole.MEMBER,
  support_writer: MemberRole.MEMBER,
  full_admin: MemberRole.ADMIN,
};

// ─── OAuth connections ───────────────────────────────────────────────────────

/** Authorization-server scopes MCP clients may also request: identity (OIDC)
 *  and `offline_access`, which is what earns a refresh token. They grant no
 *  MCP capability on their own. */
export const MCP_OAUTH_IDENTITY_SCOPES = ['openid', 'profile', 'email', 'offline_access'] as const;

/** Every scope the authorization server accepts in an OAuth request. */
export const MCP_OAUTH_SCOPES = [...MCP_SCOPES, ...MCP_OAUTH_IDENTITY_SCOPES] as const;

/** Scopes advertised in the MCP endpoint's 401 challenge, so a client that
 *  follows it asks for the full MCP set plus a refresh token. The person still
 *  narrows the connection to one preset when they approve it. */
export const MCP_OAUTH_CHALLENGE_SCOPES = [...MCP_SCOPES, 'offline_access'] as const;

/** Dashboard pages of the OAuth flow (relative to the app origin). */
export const MCP_OAUTH_PAGES = {
  'sign-in': '/sign-in',
  project: '/oauth/project',
  consent: '/oauth/consent',
} as const;

export type McpOAuthStep = keyof typeof MCP_OAUTH_PAGES;

/** Better Auth sends people to `<handoff>/<step>?<signed query>`. The API
 *  hands off to the page with that query wrapped in ONE opaque parameter: the
 *  router would otherwise rewrite the repeated `ba_param` values and break the
 *  signature. */
export const MCP_OAUTH_HANDOFF_PATH = '/api/app/mcp-oauth/handoff';
export const MCP_OAUTH_REQUEST_PARAM = 'oauth_request';

/** Access-token claims that bind a token to its connection and project. */
export const MCP_OAUTH_GRANT_CLAIM = 'nibleaf_grant';
export const MCP_OAUTH_PROJECT_CLAIM = 'nibleaf_project';

/** Protected-resource and authorization-server URLs for one public origin
 *  (BETTER_AUTH_URL, which is the dashboard origin). */
export const mcpOAuthUrls = (publicUrl: string) => {
  const origin = new URL(publicUrl).origin;
  return {
    origin,
    issuer: `${origin}/api/auth`,
    resource: `${origin}/api/mcp`,
    resourceMetadata: `${origin}/.well-known/oauth-protected-resource/api/mcp`,
    authorizationServerMetadata: `${origin}/.well-known/oauth-authorization-server/api/auth`,
  };
};

/** The scopes a connection made with `preset` carries for a member with
 *  `role`, or null when the role may not pick that preset. Same rules as
 *  personal keys: the preset's minimum role, then the role's scope ceiling. */
export const mcpPresetScopesForRole = (preset: McpKeyPreset, role: string): McpScope[] | null => {
  if (!roleAtLeast(role, MCP_PRESET_MIN_ROLE[preset])) return null;
  const allowed = new Set(mcpScopesForRole(role));
  const scopes = MCP_PRESET_SCOPES[preset].filter((scope) => allowed.has(scope));
  return scopes.includes('mcp:connect') ? scopes : null;
};
