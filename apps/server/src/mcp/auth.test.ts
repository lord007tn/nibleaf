import { hashApiKeySecret } from '@nibleaf/shared/crypto';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HonoEnv } from '@/lib/hono/context';
import { authenticateMcpRequest } from './auth';

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), update: vi.fn(), memberFindUnique: vi.fn(), env: { MCP_ENABLED: true } }));

vi.mock('@nibleaf/database', () => ({
  prisma: { apiKey: { findUnique: mocks.findUnique, update: mocks.update }, member: { findUnique: mocks.memberFindUnique } },
}));
vi.mock('@/env', () => ({ env: mocks.env }));

const secret = `plm_live_${'a'.repeat(32)}`;
const key = (overrides: Record<string, unknown> = {}) => ({
  id: 'key-1',
  name: 'MCP',
  hashedSecret: hashApiKeySecret(secret),
  scopes: ['mcp:connect', 'projects:read'],
  expiresAt: new Date('2030-01-01T00:00:00.000Z'),
  revokedAt: null,
  createdById: 'user-1',
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
  // Default: the creator is still a plain member in good standing.
  mocks.memberFindUnique.mockResolvedValue({ role: 'member', user: { suspendedAt: null } });
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

const writerScopes = ['mcp:connect', 'projects:read', 'pages:read', 'pages:write', 'deployments:publish'];
type AuthBody = { apiKey: { scopes: string[] }; actor: { userId: string; role: string } | null };

describe('MCP key actor binding', () => {
  it('acts as the creator with their current organization role and suspension state', async () => {
    mocks.findUnique.mockResolvedValue(key({ createdById: 'user-1', scopes: writerScopes }));
    mocks.memberFindUnique.mockResolvedValue({ role: 'member', user: { suspendedAt: null } });
    const response = await requestAuth(`Bearer ${secret}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as AuthBody;
    expect(body.actor).toEqual({ userId: 'user-1', role: 'member' });
    expect(body.apiKey.scopes).toEqual(writerScopes);
    expect(mocks.memberFindUnique).toHaveBeenCalledWith({
      where: { organizationId_userId: { organizationId: 'org-1', userId: 'user-1' } },
      select: { role: true, user: { select: { suspendedAt: true } } },
    });
  });

  it('re-reads the creator on every request', async () => {
    mocks.findUnique.mockResolvedValue(key({ createdById: 'user-1', scopes: writerScopes }));
    mocks.memberFindUnique.mockResolvedValueOnce({ role: 'admin', user: { suspendedAt: null } }).mockResolvedValueOnce(null);
    expect(((await (await requestAuth(`Bearer ${secret}`)).json()) as AuthBody).actor?.role).toBe('admin');
    expect((await requestAuth(`Bearer ${secret}`)).status).toBe(401);
    expect(mocks.memberFindUnique).toHaveBeenCalledTimes(2);
  });

  it('rejects the key once its creator left the organization or was suspended, without saying why', async () => {
    mocks.findUnique.mockResolvedValue(key({ createdById: 'user-1', scopes: writerScopes }));
    mocks.memberFindUnique.mockResolvedValueOnce(null);
    const removed = await requestAuth(`Bearer ${secret}`);
    mocks.memberFindUnique.mockResolvedValueOnce({ role: 'owner', user: { suspendedAt: new Date('2026-11-01T00:00:00.000Z') } });
    const suspended = await requestAuth(`Bearer ${secret}`);
    for (const response of [removed, suspended]) {
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: { code: 'auth:invalid_api_key', message: 'The API key is invalid, expired, or revoked.' } });
    }
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('revokes a key whose creator was deleted instead of keeping its reads', async () => {
    // Deleting the user nulls createdById (onDelete: SetNull). The orphaned key
    // must not regain access that its former owner lost.
    mocks.findUnique.mockResolvedValue(key({ createdById: null, scopes: writerScopes }));
    const response = await requestAuth(`Bearer ${secret}`);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: 'auth:invalid_api_key', message: 'The API key is invalid, expired, or revoked.' } });
    expect(mocks.memberFindUnique).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('intersects key scopes with what the creator role allows', async () => {
    mocks.findUnique.mockResolvedValue(key({ createdById: 'user-1', scopes: writerScopes }));
    mocks.memberFindUnique.mockResolvedValue({ role: 'guest', user: { suspendedAt: null } });
    // An unknown role grants no scope at all, so not even mcp:connect survives.
    expect((await requestAuth(`Bearer ${secret}`)).status).toBe(403);
  });
});
