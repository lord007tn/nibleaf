import { describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const updateMany = (model: string) => vi.fn(async (args: unknown) => ({ model, args }));
  return {
    findMany: vi.fn(),
    grantUpdateMany: updateMany('grant'),
    refreshUpdateMany: updateMany('refresh'),
    accessUpdateMany: updateMany('access'),
    transaction: vi.fn(async (operations: unknown[]) => Promise.all(operations)),
  };
});

vi.mock('@nibleaf/database', () => ({
  prisma: {
    mcpOAuthGrant: { findMany: db.findMany, updateMany: db.grantUpdateMany },
    oauthRefreshToken: { updateMany: db.refreshUpdateMany },
    oauthAccessToken: { updateMany: db.accessUpdateMany },
    $transaction: db.transaction,
  },
}));

import { activateMcpGrant, MCP_OAUTH_DISABLED_PATHS, resolveMcpOAuthConfig, signedOAuthQuerySubset } from './mcp-oauth';

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
