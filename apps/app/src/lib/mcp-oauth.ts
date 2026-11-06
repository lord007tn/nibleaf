import { MCP_OAUTH_REQUEST_PARAM, type McpScope } from '@nibleaf/shared/mcp';

/** Whether a page URL carries an MCP OAuth authorization request (the API's
 *  hand-off wraps Better Auth's signed query in one opaque parameter). */
export const isOAuthAuthorizationSearch = (search: string) => Boolean(new URLSearchParams(search).get(MCP_OAUTH_REQUEST_PARAM));

const decodeBase64Url = (value: string) => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
};

/** The signed authorization query of the current page, exactly as Better
 *  Auth signed it, for `oauth_query` in sign-in, continue and consent calls. */
export const currentOAuthQuery = () => {
  if (typeof window === 'undefined') return null;
  const wrapped = new URLSearchParams(window.location.search).get(MCP_OAUTH_REQUEST_PARAM);
  if (!wrapped) return null;
  try {
    const query = decodeBase64Url(wrapped);
    return new URLSearchParams(query).has('sig') ? query : null;
  } catch {
    return null;
  }
};

/** Link to another step of the same authorization request. */
export const oauthStepHref = (path: '/sign-in' | '/oauth/project', search: string) =>
  `${path}?${MCP_OAUTH_REQUEST_PARAM}=${new URLSearchParams(search).get(MCP_OAUTH_REQUEST_PARAM) ?? ''}`;

type ConsentLine =
  | 'oauth.consent.can.read'
  | 'oauth.consent.can.deployments'
  | 'oauth.consent.can.analytics'
  | 'oauth.consent.can.searchTerms'
  | 'oauth.consent.can.drafts'
  | 'oauth.consent.can.publish'
  | 'oauth.consent.can.settings'
  | 'oauth.consent.cannot.change'
  | 'oauth.consent.cannot.admin'
  | 'oauth.consent.cannot.other';

const READ_SCOPES: McpScope[] = ['projects:read', 'pages:read', 'languages:read', 'versions:read'];
const SETTINGS_SCOPES: McpScope[] = ['usage:read', 'entitlements:read', 'addons:read', 'themes:read', 'exports:read', 'integrations:read'];

/** Plain-language summary of what a connection with `scopes` may and may not
 *  do, for the consent page. */
export const consentLines = (scopes: readonly string[]) => {
  const has = (scope: McpScope) => scopes.includes(scope);
  const can: ConsentLine[] = [];
  if (READ_SCOPES.some(has)) can.push('oauth.consent.can.read');
  if (has('deployments:read')) can.push('oauth.consent.can.deployments');
  if (has('analytics:read') || has('search:read')) can.push('oauth.consent.can.analytics');
  if (has('analytics:search_terms')) can.push('oauth.consent.can.searchTerms');
  if (has('pages:write')) can.push('oauth.consent.can.drafts');
  if (has('deployments:publish')) can.push('oauth.consent.can.publish');
  if (SETTINGS_SCOPES.some(has)) can.push('oauth.consent.can.settings');
  const writes = has('pages:write') || has('deployments:publish');
  const cannot: ConsentLine[] = [writes ? 'oauth.consent.cannot.admin' : 'oauth.consent.cannot.change', 'oauth.consent.cannot.other'];
  return { can, cannot };
};
