import { describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const updateMany = (model: string) => vi.fn(async (args: unknown) => ({ model, args }));
  return {
    findMany: vi.fn(),
    grantUpdateMany: updateMany('grant'),
    refreshUpdateMany: updateMany('refresh'),
    accessUpdateMany: updateMany('access'),
    transaction: vi.fn(async (operations: unknown[]) => Promise.all(operations)),
    verificationDeleteMany: vi.fn(async () => ({ count: 0 })),
  };
});

vi.mock('@nibleaf/database', () => ({
  prisma: {
    mcpOAuthGrant: { findMany: db.findMany, updateMany: db.grantUpdateMany },
    oauthRefreshToken: { updateMany: db.refreshUpdateMany },
    oauthAccessToken: { updateMany: db.accessUpdateMany },
    verification: { deleteMany: db.verificationDeleteMany },
    $transaction: db.transaction,
  },
}));

import {
  activateMcpGrant,
  createMcpDpopReplayStore,
  isMcpAccessTokenError,
  MCP_OAUTH_DISABLED_PATHS,
  McpAccessTokenError,
  resolveMcpOAuthConfig,
  signedOAuthQuerySubset,
} from './mcp-oauth';

describe('MCP OAuth configuration', () => {
  it('stays off while MCP is disabled', () => {
    expect(resolveMcpOAuthConfig({ MCP_ENABLED: false, BETTER_AUTH_URL: 'https://docs.example.com' })).toBeNull();
  });

  it('derives the issuer, resource and metadata URLs from the public origin', () => {
    expect(resolveMcpOAuthConfig({ MCP_ENABLED: true, BETTER_AUTH_URL: 'https://docs.example.com/' })).toEqual({
      origin: 'https://docs.example.com',
      issuer: 'https://docs.example.com/api/auth',
      resource: 'https://docs.example.com/api/mcp',
      resourceMetadata: 'https://docs.example.com/.well-known/oauth-protected-resource/api/mcp',
      authorizationServerMetadata: 'https://docs.example.com/.well-known/oauth-authorization-server/api/auth',
    });
  });

  it('allows plain HTTP only on loopback, as OAuth 2.1 and the MCP plugin require', () => {
    expect(resolveMcpOAuthConfig({ MCP_ENABLED: true, BETTER_AUTH_URL: 'http://localhost:4310' })?.resource).toBe('http://localhost:4310/api/mcp');
    expect(resolveMcpOAuthConfig({ MCP_ENABLED: true, BETTER_AUTH_URL: 'http://127.0.0.1:4310' })).not.toBeNull();
    expect(resolveMcpOAuthConfig({ MCP_ENABLED: true, BETTER_AUTH_URL: 'http://docs.internal:4310' })).toBeNull();
    expect(resolveMcpOAuthConfig({ MCP_ENABLED: true, BETTER_AUTH_URL: 'http://192.168.1.20' })).toBeNull();
  });

  it('closes the session-JWT route and session-backed client management', () => {
    expect(MCP_OAUTH_DISABLED_PATHS).toEqual(
      expect.arrayContaining(['/token', '/oauth2/create-client', '/oauth2/update-client', '/oauth2/delete-client']),
    );
  });
});

describe('signed authorization queries', () => {
  it('keeps exactly the parameters Better Auth signed, repeated ones included', () => {
    const raw = '?client_id=c1&scope=mcp%3Aconnect+pages%3Aread&ba_param=ba_param&ba_param=client_id&ba_param=scope&sig=abc&utm_source=x';
    const signed = new URLSearchParams(signedOAuthQuerySubset(raw) ?? '');
    expect([...signed.keys()]).toEqual(['client_id', 'scope', 'ba_param', 'ba_param', 'ba_param', 'sig']);
    expect(signed.get('scope')).toBe('mcp:connect pages:read');
  });

  it('rejects queries that carry no signature', () => {
    expect(signedOAuthQuerySubset('client_id=c1&ba_param=client_id')).toBeNull();
    expect(signedOAuthQuerySubset('client_id=c1&sig=abc')).toBeNull();
  });
});

describe('connection activation', () => {
  it('makes the new connection live and replaces the same app on the same project', async () => {
    db.findMany.mockResolvedValue([{ id: 'grant-old' }]);
    const now = new Date('2026-11-06T12:00:00Z');
    await activateMcpGrant({ id: 'grant-new', userId: 'user-1', clientId: 'client-1', projectId: 'project-1' }, now);
    expect(db.findMany).toHaveBeenCalledWith({
      where: {
        id: { not: 'grant-new' },
        userId: 'user-1',
        clientId: 'client-1',
        projectId: 'project-1',
        revokedAt: null,
        activatedAt: { not: null },
      },
      select: { id: true },
    });
    expect(db.grantUpdateMany).toHaveBeenCalledWith({ where: { id: 'grant-new', activatedAt: null }, data: { activatedAt: now } });
    expect(db.grantUpdateMany).toHaveBeenCalledWith({ where: { id: { in: ['grant-old'] }, revokedAt: null }, data: { revokedAt: now } });
    expect(db.refreshUpdateMany).toHaveBeenCalledWith({ where: { referenceId: { in: ['grant-old'] }, revoked: null }, data: { revoked: now } });
    expect(db.accessUpdateMany).toHaveBeenCalledWith({ where: { referenceId: { in: ['grant-old'] }, revoked: null }, data: { revoked: now } });
    expect(db.transaction).toHaveBeenCalledOnce();
  });
});

describe('DPoP proof replay store', () => {
  const reservation = (key: string, now: Date) => ({ key, now, expiresAt: new Date(now.getTime() + 300_000) });

  it('reserves each proof once in Better Auth verification storage, shared by every instance', async () => {
    const reserved = new Set<string>();
    const reserveVerificationValue = vi.fn(async ({ identifier }: { identifier: string; value: string; expiresAt: Date }) => {
      if (reserved.has(identifier)) return false;
      reserved.add(identifier);
      return true;
    });
    const context = { internalAdapter: { reserveVerificationValue } };
    const instanceA = createMcpDpopReplayStore(async () => context);
    const instanceB = createMcpDpopReplayStore(async () => context);
    const now = new Date('2026-11-06T12:00:00Z');

    expect(await instanceA.reserve(reservation('proof-1', now))).toBe(true);
    expect(await instanceB.reserve(reservation('proof-1', now))).toBe(false);
    expect(await instanceB.reserve(reservation('proof-2', now))).toBe(true);
    expect(reserveVerificationValue).toHaveBeenCalledWith({
      identifier: 'dpop-proof:proof-1',
      value: 'proof-1',
      expiresAt: new Date(now.getTime() + 300_000),
    });
  });

  it('sweeps expired proof reservations at most every five minutes per process', async () => {
    db.verificationDeleteMany.mockClear();
    const store = createMcpDpopReplayStore(async () => ({ internalAdapter: { reserveVerificationValue: async () => true } }));
    const start = new Date('2026-11-06T12:00:00Z');
    await store.reserve(reservation('a', start));
    await store.reserve(reservation('b', new Date(start.getTime() + 60_000)));
    expect(db.verificationDeleteMany).toHaveBeenCalledOnce();
    expect(db.verificationDeleteMany).toHaveBeenCalledWith({ where: { identifier: { startsWith: 'dpop-proof:' }, expiresAt: { lt: start } } });
    await store.reserve(reservation('c', new Date(start.getTime() + 300_000)));
    expect(db.verificationDeleteMany).toHaveBeenCalledTimes(2);
  });

  it('propagates a storage outage instead of accepting the proof', async () => {
    const store = createMcpDpopReplayStore(async () => ({
      internalAdapter: {
        reserveVerificationValue: async () => {
          throw new Error('database unavailable');
        },
      },
    }));
    await expect(store.reserve(reservation('a', new Date()))).rejects.toThrow('database unavailable');
  });
});

describe('MCP access token errors', () => {
  it('carry the RFC 9449 code and whether the sender constraint failed', () => {
    const proofError = new McpAccessTokenError('bad proof', { code: 'invalid_dpop_proof' });
    expect(isMcpAccessTokenError(proofError)).toBe(true);
    expect(proofError).toMatchObject({ code: 'invalid_dpop_proof', dpop: true });
    expect(new McpAccessTokenError('expired')).toMatchObject({ code: 'invalid_token', dpop: false });
    expect(new McpAccessTokenError('use DPoP', { dpop: true })).toMatchObject({ code: 'invalid_token', dpop: true });
    expect(isMcpAccessTokenError(new Error('other'))).toBe(false);
  });
});
