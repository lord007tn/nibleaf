import { MCP_PRESET_SCOPES } from '@nibleaf/shared/mcp';
import { Hono } from 'hono';
import { exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HonoEnv } from '@/lib/hono/context';

const ORIGIN = 'https://app.nibleaf.test';
const config = vi.hoisted(() => ({
  origin: 'https://app.nibleaf.test',
  issuer: 'https://app.nibleaf.test/api/auth',
  resource: 'https://app.nibleaf.test/api/mcp',
  resourceMetadata: 'https://app.nibleaf.test/.well-known/oauth-protected-resource/api/mcp',
  authorizationServerMetadata: 'https://app.nibleaf.test/.well-known/oauth-authorization-server/api/auth',
}));
const mocks = vi.hoisted(() => ({
  grantFindUnique: vi.fn(),
  grantUpdate: vi.fn(),
  memberFindUnique: vi.fn(),
  apiKeyFindUnique: vi.fn(),
  verify: null as null | ((token: string) => Promise<unknown>),
}));

vi.mock('@nibleaf/database', () => ({
  prisma: {
    mcpOAuthGrant: { findUnique: mocks.grantFindUnique, update: mocks.grantUpdate },
    member: { findUnique: mocks.memberFindUnique },
    apiKey: { findUnique: mocks.apiKeyFindUnique, update: vi.fn() },
  },
}));
vi.mock('@/env', () => ({ env: { MCP_ENABLED: true } }));
vi.mock('@nibleaf/auth/server', () => ({
  mcpOAuth: config,
  verifyMcpAccessToken: (token: string) => (mocks.verify as (token: string) => Promise<unknown>)(token),
}));

import { authenticateMcpRequest } from './auth';

type Principal = {
  credential: { kind: string; id: string; name: string; clientId?: string; scopes: string[] };
  project: { id: string; name: string; organizationId: string };
  actor: { userId: string; role: string } | null;
};

type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

const writer = [...MCP_PRESET_SCOPES.support_writer];
let privateKey: SigningKey;
let otherKey: SigningKey;

const token = async (
  overrides: {
    scope?: string;
    aud?: string;
    iss?: string;
    sub?: string;
    exp?: number;
    grant?: string;
    project?: string;
    key?: SigningKey;
    cnf?: object;
    typ?: string;
  } = {},
) => {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    scope: overrides.scope ?? [...writer, 'offline_access'].join(' '),
    azp: 'client-claude',
    client_id: 'client-claude',
    nibleaf_grant: overrides.grant ?? 'grant-1',
    nibleaf_project: overrides.project ?? 'project-1',
    ...(overrides.cnf ? { cnf: overrides.cnf } : {}),
  })
    .setProtectedHeader({ alg: 'EdDSA', kid: 'key-1', typ: overrides.typ ?? 'at+jwt' })
    .setIssuer(overrides.iss ?? config.issuer)
    .setAudience(overrides.aud ?? config.resource)
    .setSubject(overrides.sub ?? 'user-1')
    .setIssuedAt(now - 10)
    .setExpirationTime(overrides.exp ?? now + 3600)
    .sign(overrides.key ?? privateKey);
};

const grant = (overrides: Record<string, unknown> = {}) => ({
  id: 'grant-1',
  userId: 'user-1',
  clientId: 'client-claude',
  clientName: 'Claude',
  scopes: writer,
  revokedAt: null,
  project: { id: 'project-1', name: 'Docs', organizationId: 'org-1' },
  client: { name: 'Claude' },
  ...overrides,
});

const contexts: Array<Map<string, unknown>> = [];
const request = async (authorization?: string) => {
  const app = new Hono<HonoEnv>().post('/api/mcp', async (ctx) => {
    ctx.set('requestId', 'request-1');
    const result = await authenticateMcpRequest(ctx);
    contexts.push(new Map([['apiKey', ctx.get('apiKey')]]));
    return result instanceof Response ? result : ctx.json(result);
  });
  return app.request(`${ORIGIN}/api/mcp`, { method: 'POST', headers: authorization ? { authorization } : {} });
};

beforeAll(async () => {
  const pair = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
  privateKey = pair.privateKey;
  otherKey = (await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true })).privateKey;
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: 'key-1', alg: 'EdDSA' };
  const { createMcpAccessTokenVerifier } = await vi.importActual<typeof import('@nibleaf/auth/mcp-oauth')>('@nibleaf/auth/mcp-oauth');
  mocks.verify = createMcpAccessTokenVerifier(config, async () => ({ keys: [jwk as Record<string, unknown>] }));
});

beforeEach(() => {
  vi.clearAllMocks();
  contexts.length = 0;
  mocks.grantFindUnique.mockResolvedValue(grant());
  mocks.grantUpdate.mockResolvedValue({ id: 'grant-1' });
  mocks.memberFindUnique.mockResolvedValue({ role: 'member', user: { suspendedAt: null } });
});

describe('MCP OAuth access tokens', () => {
  it('maps a valid token to the connection, its project and the person who connected it', async () => {
    const response = await request(`Bearer ${await token()}`);
    expect(response.status).toBe(200);
    const principal = (await response.json()) as Principal;
    expect(principal.credential).toMatchObject({ kind: 'oauth', id: 'grant-1', name: 'Claude', clientId: 'client-claude' });
    expect([...principal.credential.scopes].sort()).toEqual([...writer].sort());
    expect(principal.project).toEqual({ id: 'project-1', name: 'Docs', organizationId: 'org-1' });
    expect(principal.actor).toEqual({ userId: 'user-1', role: 'member' });
    expect(mocks.grantFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'grant-1' } }));
    expect(mocks.memberFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId_userId: { organizationId: 'org-1', userId: 'user-1' } } }),
    );
    expect(contexts[0]?.get('apiKey')).toEqual({ id: 'grant-1', kind: 'oauth', projectId: 'project-1', scopes: expect.arrayContaining(writer) });
    expect(mocks.grantUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'grant-1' }, data: { lastUsedAt: expect.any(Date) } }));
  });

  it.each([
    ['expired', { exp: Math.floor(Date.now() / 1000) - 60 }],
    ['for another audience', { aud: 'https://evil.example/api/mcp' }],
    ['from another issuer', { iss: 'https://evil.example/api/auth' }],
    ['signed with another key', { key: undefined as unknown as SigningKey }],
    ['not an access-token JWT', { typ: 'JWT' }],
    ['sender-constrained (DPoP)', { cnf: { jkt: 'thumbprint' } }],
  ])('rejects a token %s with an RFC 6750 invalid_token challenge', async (_label, overrides) => {
    const signed = await token(_label === 'signed with another key' ? { key: otherKey } : overrides);
    const response = await request(`Bearer ${signed}`);
    expect(response.status).toBe(401);
    const challenge = response.headers.get('www-authenticate') ?? '';
    expect(challenge).toContain('error="invalid_token"');
    expect(challenge).toContain(`resource_metadata="${config.resourceMetadata}"`);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('auth:invalid_token');
    expect(mocks.grantFindUnique).not.toHaveBeenCalled();
  });

  it.each([
    ['revoked', grant({ revokedAt: new Date() })],
    ['missing', null],
    ['made by someone else', grant({ userId: 'user-2' })],
    ['for another client', grant({ clientId: 'client-other' })],
    ['bound to another project', grant({ project: { id: 'project-2', name: 'Other', organizationId: 'org-2' } })],
  ])('rejects a connection that is %s', async (_label, row) => {
    mocks.grantFindUnique.mockResolvedValue(row);
    const response = await request(`Bearer ${await token()}`);
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('error="invalid_token"');
    expect(mocks.grantUpdate).not.toHaveBeenCalled();
  });

  it('rejects the connection once its person left the organization or was suspended', async () => {
    mocks.memberFindUnique.mockResolvedValueOnce(null);
    expect((await request(`Bearer ${await token()}`)).status).toBe(401);
    mocks.memberFindUnique.mockResolvedValueOnce({ role: 'owner', user: { suspendedAt: new Date() } });
    expect((await request(`Bearer ${await token()}`)).status).toBe(401);
    expect(mocks.grantUpdate).not.toHaveBeenCalled();
  });

  it('refuses MCP outright, without a step-up challenge, when the current role grants nothing', async () => {
    mocks.memberFindUnique.mockResolvedValue({ role: 'guest', user: { suspendedAt: null } });
    const response = await request(`Bearer ${await token()}`);
    expect(response.status).toBe(403);
    expect(response.headers.get('www-authenticate')).toBeNull();
  });

  it('grants only what the connection, the token and the current role all allow', async () => {
    // Token narrower than the grant: no publish.
    mocks.grantFindUnique.mockResolvedValue(grant({ scopes: [...MCP_PRESET_SCOPES.full_admin] }));
    const narrow = await request(`Bearer ${await token({ scope: 'mcp:connect pages:read pages:write analytics:search_terms' })}`);
    expect(((await narrow.json()) as Principal).credential.scopes.sort()).toEqual([
      'analytics:search_terms',
      'mcp:connect',
      'pages:read',
      'pages:write',
    ]);
    // Grant narrower than the token: a read-only preset never writes.
    mocks.grantFindUnique.mockResolvedValue(grant({ scopes: [...MCP_PRESET_SCOPES.read_only] }));
    const readOnly = await request(`Bearer ${await token({ scope: [...MCP_PRESET_SCOPES.full_admin].join(' ') })}`);
    const scopes = ((await readOnly.json()) as Principal).credential.scopes;
    expect(scopes).not.toContain('pages:write');
    expect(scopes).not.toContain('deployments:publish');
    expect(scopes.sort()).toEqual([...MCP_PRESET_SCOPES.read_only].sort());
  });

  it('answers a token without mcp:connect with an insufficient_scope challenge', async () => {
    const response = await request(`Bearer ${await token({ scope: 'pages:read offline_access' })}`);
    expect(response.status).toBe(403);
    const challenge = response.headers.get('www-authenticate') ?? '';
    expect(challenge).toContain('error="insufficient_scope"');
    expect(challenge).toContain('scope="mcp:connect"');
    expect(challenge).toContain(`resource_metadata="${config.resourceMetadata}"`);
  });
});

describe('MCP OAuth discovery challenge', () => {
  it('points a request without credentials at the protected-resource metadata', async () => {
    const response = await request();
    expect(response.status).toBe(401);
    const challenge = response.headers.get('www-authenticate') ?? '';
    expect(challenge.startsWith('Bearer ')).toBe(true);
    expect(challenge).toContain(`resource_metadata="${config.resourceMetadata}"`);
    expect(challenge).toMatch(/scope="mcp:connect [^"]*offline_access"/);
    expect(challenge).not.toContain('error=');
  });

  it('marks an unknown bearer value invalid and still advertises OAuth', async () => {
    const response = await request('Bearer not-a-key-or-token');
    expect(response.status).toBe(401);
    const challenge = response.headers.get('www-authenticate') ?? '';
    expect(challenge).toContain('error="invalid_token"');
    expect(challenge).toContain(`resource_metadata="${config.resourceMetadata}"`);
  });

  it('keeps personal API keys on their own path', async () => {
    mocks.apiKeyFindUnique.mockResolvedValue(null);
    const response = await request(`Bearer plm_live_${'a'.repeat(32)}`);
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('auth:invalid_api_key');
    expect(response.headers.get('www-authenticate')).toContain(`resource_metadata="${config.resourceMetadata}"`);
    expect(mocks.apiKeyFindUnique).toHaveBeenCalledOnce();
    expect(mocks.grantFindUnique).not.toHaveBeenCalled();
  });
});
