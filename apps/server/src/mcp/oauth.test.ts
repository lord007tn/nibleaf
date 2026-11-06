import { createHash, randomUUID } from 'node:crypto';
import { MCP_PRESET_SCOPES } from '@nibleaf/shared/mcp';
import { Hono } from 'hono';
import { calculateJwkThumbprint, exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose';
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
  verificationDeleteMany: vi.fn(),
  verify: null as null | ((...args: unknown[]) => Promise<unknown>),
  /** Better Auth's verification reservations: first writer wins. */
  reserved: new Set<string>(),
  reservationsDown: false,
}));

vi.mock('@nibleaf/database', () => ({
  prisma: {
    mcpOAuthGrant: { findUnique: mocks.grantFindUnique, update: mocks.grantUpdate },
    member: { findUnique: mocks.memberFindUnique },
    apiKey: { findUnique: mocks.apiKeyFindUnique, update: vi.fn() },
    verification: { deleteMany: mocks.verificationDeleteMany },
  },
}));
vi.mock('@/env', () => ({ env: { MCP_ENABLED: true } }));
vi.mock('@nibleaf/auth/server', () => ({
  mcpOAuth: config,
  verifyMcpAccessToken: (...args: unknown[]) => (mocks.verify as (...args: unknown[]) => Promise<unknown>)(...args),
  auth: {
    $context: Promise.resolve({
      internalAdapter: {
        reserveVerificationValue: async ({ identifier }: { identifier: string }) => {
          if (mocks.reservationsDown) throw new Error('database unavailable');
          if (mocks.reserved.has(identifier)) return false;
          mocks.reserved.add(identifier);
          return true;
        },
      },
    }),
  },
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
const request = async (authorization?: string, options: { dpop?: string; url?: string; method?: 'POST' | 'GET' } = {}) => {
  const app = new Hono<HonoEnv>().on(['POST', 'GET'], '/api/mcp', async (ctx) => {
    ctx.set('requestId', 'request-1');
    const result = await authenticateMcpRequest(ctx);
    contexts.push(new Map([['apiKey', ctx.get('apiKey')]]));
    return result instanceof Response ? result : ctx.json(result);
  });
  const headers: Record<string, string> = {};
  if (authorization) headers.authorization = authorization;
  if (options.dpop) headers.dpop = options.dpop;
  return app.request(options.url ?? `${ORIGIN}/api/mcp`, { method: options.method ?? 'POST', headers });
};

/** The MCP client's DPoP key pair and its RFC 7638 thumbprint (`cnf.jkt`). */
type ClientKey = { privateKey: SigningKey; jwk: JWK; jkt: string };
const clientKey = async (): Promise<ClientKey> => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  const jwk = await exportJWK(pair.publicKey);
  return { privateKey: pair.privateKey, jwk, jkt: await calculateJwkThumbprint(jwk, 'sha256') };
};

/** An RFC 9449 proof for one request: what a DPoP-capable MCP client sends. */
const proof = async (
  key: ClientKey,
  accessToken: string,
  overrides: { htm?: string; htu?: string; ath?: string; iat?: number; jti?: string; signWith?: ClientKey } = {},
) =>
  new SignJWT({
    htm: overrides.htm ?? 'POST',
    htu: overrides.htu ?? config.resource,
    ath: overrides.ath ?? createHash('sha256').update(accessToken).digest('base64url'),
    jti: overrides.jti ?? randomUUID(),
  })
    .setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk: key.jwk })
    .setIssuedAt(overrides.iat ?? Math.floor(Date.now() / 1000))
    .sign((overrides.signWith ?? key).privateKey);

beforeAll(async () => {
  const pair = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
  privateKey = pair.privateKey;
  otherKey = (await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true })).privateKey;
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: 'key-1', alg: 'EdDSA' };
  const { createMcpAccessTokenVerifier } = await vi.importActual<typeof import('@nibleaf/auth/mcp-oauth')>('@nibleaf/auth/mcp-oauth');
  mocks.verify = createMcpAccessTokenVerifier(config, async () => ({ keys: [jwk as Record<string, unknown>] })) as (
    ...args: unknown[]
  ) => Promise<unknown>;
});

beforeEach(() => {
  vi.clearAllMocks();
  contexts.length = 0;
  mocks.reserved.clear();
  mocks.reservationsDown = false;
  mocks.verificationDeleteMany.mockResolvedValue({ count: 0 });
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
    ['bound by another confirmation method (mTLS)', { cnf: { 'x5t#S256': 'certificate-thumbprint' } }],
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

describe('MCP OAuth DPoP-bound access tokens (RFC 9449)', () => {
  /** An API instance behind the dashboard proxy sees its own URL, not the public one. */
  const INTERNAL_URL = 'http://nibleaf-api:3001/api/mcp';
  let key: ClientKey;
  let bound: string;

  beforeEach(async () => {
    key = await clientKey();
    bound = await token({ cnf: { jkt: key.jkt } });
  });

  /** Every OAuth challenge keeps the Bearer one, with discovery, first. */
  const challengeOf = (response: Response) => {
    const challenge = response.headers.get('www-authenticate') ?? '';
    expect(challenge.startsWith('Bearer ')).toBe(true);
    expect(challenge).toContain(`resource_metadata="${config.resourceMetadata}"`);
    return challenge;
  };

  it('still accepts a plain bearer token without a DPoP proof', async () => {
    const response = await request(`Bearer ${await token()}`);
    expect(response.status).toBe(200);
    expect(mocks.reserved.size).toBe(0);
  });

  it('accepts a DPoP-bound token with a valid proof and reserves its jti', async () => {
    const response = await request(`DPoP ${bound}`, { dpop: await proof(key, bound) });
    expect(response.status).toBe(200);
    const principal = (await response.json()) as Principal;
    expect(principal.credential).toMatchObject({ kind: 'oauth', id: 'grant-1', clientId: 'client-claude' });
    expect(mocks.grantFindUnique).toHaveBeenCalledOnce();
    expect([...mocks.reserved][0]).toMatch(/^dpop-proof:/);
  });

  it('checks htu against the public resource URL, not the internal URL the proxy forwards to', async () => {
    const throughProxy = await request(`DPoP ${bound}`, { url: INTERNAL_URL, dpop: await proof(key, bound) });
    expect(throughProxy.status).toBe(200);

    const signedForInternal = await request(`DPoP ${bound}`, { url: INTERNAL_URL, dpop: await proof(key, bound, { htu: INTERNAL_URL }) });
    expect(signedForInternal.status).toBe(401);
    expect(challengeOf(signedForInternal)).toContain('DPoP realm="Nibleaf MCP", error="invalid_dpop_proof"');
  });

  it('checks htm against the request method', async () => {
    expect((await request(`DPoP ${bound}`, { method: 'GET', dpop: await proof(key, bound, { htm: 'GET' }) })).status).toBe(200);
    expect((await request(`DPoP ${bound}`, { method: 'GET', dpop: await proof(key, bound) })).status).toBe(401);
  });

  it('rejects a DPoP-bound token sent as a plain bearer token, and tells the client to use DPoP', async () => {
    const response = await request(`Bearer ${bound}`, { dpop: await proof(key, bound) });
    expect(response.status).toBe(401);
    const challenge = challengeOf(response);
    expect(challenge).toContain('Bearer realm="Nibleaf MCP", error="invalid_token"');
    expect(challenge).toMatch(/DPoP realm="Nibleaf MCP", algs="[^"]*ES256[^"]*"/);
    expect(mocks.grantFindUnique).not.toHaveBeenCalled();
  });

  it('rejects a DPoP-bound token without a proof', async () => {
    const response = await request(`DPoP ${bound}`);
    expect(response.status).toBe(401);
    expect(challengeOf(response)).toContain('error="invalid_dpop_proof"');
  });

  it('rejects the DPoP scheme for a token that is not DPoP-bound', async () => {
    const plain = await token();
    const response = await request(`DPoP ${plain}`, { dpop: await proof(key, plain) });
    expect(response.status).toBe(401);
    const challenge = challengeOf(response);
    expect(challenge).toContain('DPoP realm="Nibleaf MCP", error="invalid_token"');
    expect(challenge).not.toMatch(/Bearer [^,]*, error=/);
  });

  it.each([
    ['ath of another token', async () => proof(key, bound, { ath: createHash('sha256').update('another-token').digest('base64url') })],
    ['a key that does not match cnf.jkt', async () => proof(await clientKey(), bound)],
    ['a signature by another key', async () => proof(key, bound, { signWith: await clientKey() })],
    ['an iat outside the accepted window', async () => proof(key, bound, { iat: Math.floor(Date.now() / 1000) - 3600 })],
  ])('rejects a proof with %s', async (_label, makeProof) => {
    const response = await request(`DPoP ${bound}`, { dpop: await makeProof() });
    expect(response.status).toBe(401);
    expect(challengeOf(response)).toContain('error="invalid_dpop_proof"');
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('auth:invalid_token');
    expect(mocks.grantFindUnique).not.toHaveBeenCalled();
  });

  it('rejects a replayed proof, on any instance', async () => {
    const once = await proof(key, bound);
    expect((await request(`DPoP ${bound}`, { dpop: once })).status).toBe(200);
    const replay = await request(`DPoP ${bound}`, { url: INTERNAL_URL, dpop: once });
    expect(replay.status).toBe(401);
    expect(challengeOf(replay)).toContain('error="invalid_dpop_proof"');
    expect(mocks.grantFindUnique).toHaveBeenCalledOnce();
  });

  it('fails as a server error, not an accepted or invalid credential, when replay storage is down', async () => {
    mocks.reservationsDown = true;
    const response = await request(`DPoP ${bound}`, { dpop: await proof(key, bound) });
    expect(response.status).toBe(500);
    expect(mocks.grantFindUnique).not.toHaveBeenCalled();
  });

  it('keeps every connection check for DPoP-bound tokens', async () => {
    mocks.grantFindUnique.mockResolvedValue(grant({ revokedAt: new Date() }));
    const response = await request(`DPoP ${bound}`, { dpop: await proof(key, bound) });
    expect(response.status).toBe(401);
    expect(challengeOf(response)).toContain('DPoP realm="Nibleaf MCP", error="invalid_token"');
  });
});
