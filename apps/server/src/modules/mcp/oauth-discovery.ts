import { auth, mcpOAuth } from '@nibleaf/auth/server';
import { Hono } from 'hono';
import type { HonoEnv } from '@/lib/hono/context';

/**
 * OAuth discovery for MCP clients, mounted at `/.well-known` on the API and
 * reached through the dashboard origin (its proxy forwards these paths here).
 * Better Auth's plugins answer the canonical documents: RFC 9728 protected
 * resource metadata (bare and `/api/mcp`-suffixed) and RFC 8414 / OpenID
 * metadata for the `/api/auth` issuer. The extra aliases map the root and
 * path-inserted OpenID forms onto them for clients that try those first.
 */
const CANONICAL_PATHS: Record<string, string> = {
  '/.well-known/oauth-protected-resource': '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource/api/mcp': '/.well-known/oauth-protected-resource/api/mcp',
  '/.well-known/oauth-authorization-server': '/.well-known/oauth-authorization-server/api/auth',
  '/.well-known/oauth-authorization-server/api/auth': '/.well-known/oauth-authorization-server/api/auth',
  '/.well-known/openid-configuration': '/api/auth/.well-known/openid-configuration',
  '/.well-known/openid-configuration/api/auth': '/api/auth/.well-known/openid-configuration',
};

const OAUTH_DISCOVERY_PATHS = Object.keys(CANONICAL_PATHS);

export const oauthDiscovery = new Hono<HonoEnv>().on(
  ['GET', 'HEAD'],
  OAUTH_DISCOVERY_PATHS.map((path) => path.slice('/.well-known'.length)),
  async (ctx) => {
    const canonical = CANONICAL_PATHS[ctx.req.path.replace(/\/+$/, '')];
    if (!(mcpOAuth && canonical)) return ctx.notFound();
    const url = new URL(ctx.req.url);
    url.pathname = canonical;
    url.search = '';
    return auth.handler(new Request(url, { method: ctx.req.method, headers: ctx.req.raw.headers }));
  },
);
