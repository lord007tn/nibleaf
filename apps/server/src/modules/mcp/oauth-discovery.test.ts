import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  handler: vi.fn(async (request: Request) => Response.json({ path: new URL(request.url).pathname })),
  config: { issuer: 'https://app.nibleaf.test/api/auth' } as object | null,
}));

vi.mock('@nibleaf/auth/server', () => ({
  auth: { handler: state.handler },
  get mcpOAuth() {
    return state.config;
  },
}));

import { oauthDiscovery } from './oauth-discovery';

const app = new Hono().route('/.well-known', oauthDiscovery);
const get = (path: string, method = 'GET') => app.request(`https://app.nibleaf.test${path}?ignored=1`, { method });

beforeEach(() => {
  state.handler.mockClear();
  state.config = { issuer: 'https://app.nibleaf.test/api/auth' };
});

describe('OAuth discovery at the public origin', () => {
  it.each([
    ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource'],
    ['/.well-known/oauth-protected-resource/api/mcp', '/.well-known/oauth-protected-resource/api/mcp'],
    ['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/api/auth'],
    ['/.well-known/oauth-authorization-server/api/auth', '/.well-known/oauth-authorization-server/api/auth'],
    ['/.well-known/openid-configuration', '/api/auth/.well-known/openid-configuration'],
    ['/.well-known/openid-configuration/api/auth', '/api/auth/.well-known/openid-configuration'],
  ])('serves %s from Better Auth as %s', async (path, canonical) => {
    const response = await get(path);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ path: canonical });
    const forwarded = state.handler.mock.calls[0]?.[0] as Request;
    expect(new URL(forwarded.url).search).toBe('');
    expect(forwarded.method).toBe('GET');
  });

  it('answers HEAD the same way and nothing else', async () => {
    expect((await get('/.well-known/oauth-protected-resource/api/mcp', 'HEAD')).status).toBe(200);
    expect((await get('/.well-known/oauth-protected-resource/api/mcp', 'POST')).status).toBe(404);
    expect((await get('/.well-known/oauth-protected-resource/other')).status).toBe(404);
  });

  it('is absent while MCP OAuth is off', async () => {
    state.config = null;
    expect((await get('/.well-known/oauth-protected-resource/api/mcp')).status).toBe(404);
    expect(state.handler).not.toHaveBeenCalled();
  });
});
