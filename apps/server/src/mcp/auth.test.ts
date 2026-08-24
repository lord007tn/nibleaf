import { hashApiKeySecret } from '@nibleaf/shared/crypto';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HonoEnv } from '@/lib/hono/context';
import { authenticateMcpRequest } from './auth';

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), update: vi.fn(), env: { MCP_ENABLED: true } }));

vi.mock('@nibleaf/database', () => ({ prisma: { apiKey: { findUnique: mocks.findUnique, update: mocks.update } } }));
vi.mock('@/env', () => ({ env: mocks.env }));

const secret = `plm_live_${'a'.repeat(32)}`;
const key = (overrides: Record<string, unknown> = {}) => ({
  id: 'key-1',
  name: 'MCP',
  hashedSecret: hashApiKeySecret(secret),
  scopes: ['mcp:connect', 'projects:read'],
  expiresAt: new Date('2030-01-01T00:00:00.000Z'),
  revokedAt: null,
  project: { id: 'project-1', name: 'Docs', organizationId: 'org-1' },
  ...overrides,
});

const requestAuth = async (authorization?: string) => {
  const app = new Hono<HonoEnv>().get('/', async (ctx) => {
    ctx.set('requestId', 'request-1');
    const result = await authenticateMcpRequest(ctx);
    return result instanceof Response ? result : ctx.json(result);
  });
  return app.request('/', { headers: authorization ? { authorization } : {} });
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.MCP_ENABLED = true;
  mocks.update.mockResolvedValue({ id: 'key-1' });
});

describe('MCP bearer authentication', () => {
  it('fails closed while MCP is disabled', async () => {
    mocks.env.MCP_ENABLED = false;
    const response = await requestAuth(`Bearer ${secret}`);
    expect(response.status).toBe(503);
    expect(await response.text()).toContain('mcp:disabled');
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it('rejects malformed and unknown credentials without exposing key state', async () => {
    expect((await requestAuth()).status).toBe(401);
    for (const authorization of ['Basic abc', 'Bearer', 'Bearer bad', `Bearer ${secret} extra`]) {
      expect((await requestAuth(authorization)).status).toBe(401);
    }
    mocks.findUnique.mockResolvedValue(null);
    const response = await requestAuth(`Bearer ${secret}`);
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain(secret);
  });

  it('rejects revoked, expired, null-expiry, wildcard, and no-connect keys', async () => {
    mocks.findUnique.mockResolvedValueOnce(key({ revokedAt: new Date() }));
    expect((await requestAuth(`Bearer ${secret}`)).status).toBe(401);
    mocks.findUnique.mockResolvedValueOnce(key({ expiresAt: new Date('2020-01-01T00:00:00.000Z') }));
    expect((await requestAuth(`Bearer ${secret}`)).status).toBe(401);
    mocks.findUnique.mockResolvedValueOnce(key({ expiresAt: null }));
    expect((await requestAuth(`Bearer ${secret}`)).status).toBe(401);
    mocks.findUnique.mockResolvedValueOnce(key({ scopes: ['*', 'projects:read'] }));
    expect((await requestAuth(`Bearer ${secret}`)).status).toBe(403);
    mocks.findUnique.mockResolvedValueOnce(key({ scopes: ['projects:read'] }));
    expect((await requestAuth(`Bearer ${secret}`)).status).toBe(403);
  });

  it('binds the trusted context and principal to the key project', async () => {
    mocks.findUnique.mockResolvedValue(key());
    const response = await requestAuth(`Bearer ${secret}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { project: { id: string; organizationId: string }; apiKey: { scopes: string[] } };
    expect(body.project).toEqual({ id: 'project-1', name: 'Docs', organizationId: 'org-1' });
    expect(body.apiKey.scopes).toEqual(['mcp:connect', 'projects:read']);
    expect(mocks.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { hashedSecret: hashApiKeySecret(secret) } }));
  });
});
