import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/server';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HonoEnv } from '@/lib/hono/context';
import { handleMcpRequest } from './transport';

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), rateLimit: vi.fn() }));

vi.mock('@/env', () => ({
  env: {
    API_URL: 'https://api.nibleaf.test',
    APP_URL: 'https://app.nibleaf.test',
    MCP_ALLOWED_HOSTS: ['mcp.nibleaf.test'],
    MCP_RATE_LIMIT_PER_MIN: 120,
  },
}));
vi.mock('./auth', () => ({
  authenticateMcpRequest: mocks.authenticate,
  mcpAuthInfo: () => ({ token: '[redacted]', clientId: 'key-1', scopes: ['mcp:connect'], expiresAt: 2_000_000_000 }),
}));
vi.mock('./rate-limit', () => ({ checkMcpRateLimit: mocks.rateLimit }));
vi.mock('./audit', () => ({ recordMcpAudit: vi.fn().mockResolvedValue({ id: 'audit-1' }) }));

const principal = {
  apiKey: { id: 'key-1', name: 'test', scopes: ['mcp:connect'] as const, expiresAt: new Date('2030-01-01T00:00:00.000Z') },
  project: { id: 'project-1', name: 'Docs', organizationId: 'org-1' },
};

const initializeBody = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } },
});

const request = (headers: Record<string, string>) => {
  const app = new Hono<HonoEnv>().post('/mcp', async (ctx) => {
    ctx.set('requestId', 'request-1');
    return handleMcpRequest(ctx);
  });
  return app.request('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: initializeBody,
  });
};

const malformedHeaderCases: Record<string, string>[] = [
  { host: 'api.nibleaf.test@evil.test' },
  { host: 'api.nibleaf.test/path' },
  { host: 'api.nibleaf.test?next=evil.test' },
  { host: 'api.nibleaf.test', origin: 'https://api.nibleaf.test/path' },
  { host: 'api.nibleaf.test', origin: 'https://user@api.nibleaf.test' },
  { host: 'api.nibleaf.test', 'x-forwarded-host': 'api.nibleaf.test/path' },
  { host: 'api.nibleaf.test', 'x-forwarded-host': 'api.nibleaf.test@evil.test' },
  { host: 'api.nibleaf.test', 'x-forwarded-proto': 'https, http' },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue(principal);
  mocks.rateLimit.mockReturnValue({ allowed: true, limit: 120, remaining: 119, resetAt: Date.now() + 60_000 });
});

describe('MCP HTTP transport boundary', () => {
  it('serves the official protocol handler with transport rate headers', async () => {
    const response = await request({ host: 'api.nibleaf.test', authorization: `Bearer plm_live_${'a'.repeat(32)}` });
    expect(response.status).toBe(200);
    expect(response.headers.get('x-ratelimit-limit')).toBe('120');
    expect(await response.text()).toContain('nibleaf');
  });

  it('rejects invalid hosts, origins, and ambiguous forwarded hosts before authentication', async () => {
    expect((await request({ host: 'evil.test' })).status).toBe(403);
    expect((await request({ host: 'api.nibleaf.test', origin: 'https://evil.test' })).status).toBe(403);
    expect((await request({ host: 'api.nibleaf.test', 'x-forwarded-host': 'api.nibleaf.test, evil.test' })).status).toBe(400);
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });

  it.each(malformedHeaderCases)('strictly rejects malformed transport metadata before SDK validation: %j', async (headers) => {
    expect((await request(headers)).status).toBe(400);
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });

  it('accepts configured host, origin, and unambiguous forwarded metadata', async () => {
    const response = await request({
      host: 'api.nibleaf.test',
      origin: 'https://app.nibleaf.test',
      'x-forwarded-host': 'mcp.nibleaf.test',
      'x-forwarded-proto': 'https',
    });
    expect(response.status).toBe(200);
  });

  it('returns a bounded rate-limit response after authentication', async () => {
    mocks.rateLimit.mockReturnValue({ allowed: false, limit: 120, remaining: 0, resetAt: Date.now() + 30_000 });
    const response = await request({ host: 'api.nibleaf.test' });
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBeTruthy();
    expect(await response.text()).toContain('http:rate_limited');
  });
});
