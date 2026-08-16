import { type CryptoKey, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { claimAt, claimStrings, isPrivateNetworkAddress, jwtReplayHash, verifyReaderJwt } from './reader-jwt';

const issuer = 'https://portal.example.com';
const audience = 'nibleaf-private-docs';
let privateKey: CryptoKey;
let jwks!: { keys: Array<Record<string, unknown>> };

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = pair.privateKey;
  jwks = { keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'current', alg: 'RS256', use: 'sig' }] };
});

const sign = async (overrides: { issuer?: string; audience?: string; expiresIn?: string; issuedAt?: number; jti?: string } = {}) => {
  const builder = new SignJWT({ email: 'reader@example.com', groups: ['customers'], profile: { tier: 'pro' } })
    .setProtectedHeader({ alg: 'RS256', kid: 'current' })
    .setIssuer(overrides.issuer ?? issuer)
    .setAudience(overrides.audience ?? audience)
    .setSubject('customer-123')
    .setJti(overrides.jti ?? crypto.randomUUID())
    .setExpirationTime(overrides.expiresIn ?? '2m');
  if (overrides.issuedAt !== undefined) builder.setIssuedAt(overrides.issuedAt);
  else builder.setIssuedAt();
  return builder.sign(privateKey);
};

const configuration = { issuer, audience, jwksUrl: null, publicJwks: jwks, maxTokenAgeSeconds: 300, clockToleranceSecs: 5 };

describe('verifyReaderJwt', () => {
  it('accepts a correctly signed, short-lived issuer/audience assertion', async () => {
    const payload = await verifyReaderJwt(await sign(), { ...configuration, publicJwks: jwks });
    expect(payload.sub).toBe('customer-123');
    expect(payload.groups).toEqual(['customers']);
  });

  it.each([
    ['issuer', { issuer: 'https://attacker.example' }],
    ['audience', { audience: 'some-other-service' }],
    ['expiry', { expiresIn: '-10s' }],
    ['maximum token age', { issuedAt: Math.floor(Date.now() / 1000) - 600 }],
  ])('rejects an invalid %s', async (_name, overrides) => {
    await expect(verifyReaderJwt(await sign(overrides), { ...configuration, publicJwks: jwks })).rejects.toBeDefined();
  });

  it('rejects a token signed by an unknown rotated key', async () => {
    const other = await generateKeyPair('RS256');
    const token = await new SignJWT({ groups: ['customers'] })
      .setProtectedHeader({ alg: 'RS256', kid: 'unknown' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject('reader')
      .setJti('rotated-key-token')
      .setIssuedAt()
      .setExpirationTime('2m')
      .sign(other.privateKey);
    await expect(verifyReaderJwt(token, { ...configuration, publicJwks: jwks })).rejects.toBeDefined();
  });
});

describe('claim mapping and replay keys', () => {
  it('reads nested claims and normalizes only string group values', () => {
    const payload = { profile: { tier: 'pro' }, groups: ['customers', 7, null] };
    expect(claimAt(payload, 'profile.tier')).toBe('pro');
    expect(claimStrings(payload.groups)).toEqual(['customers']);
  });

  it('binds replay hashes to both issuer and jti', () => {
    const hash = jwtReplayHash(issuer, 'one-use');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(jwtReplayHash(issuer, 'one-use')).toBe(hash);
    expect(jwtReplayHash('https://other.example', 'one-use')).not.toBe(hash);
    expect(jwtReplayHash(issuer, 'different')).not.toBe(hash);
  });
});

describe('remote JWKS network safety', () => {
  it.each(['127.0.0.1', '10.1.2.3', '169.254.169.254', '172.16.0.1', '192.168.1.1', '::1', 'fd00::1', 'fe80::1'])('blocks %s', (address) => {
    expect(isPrivateNetworkAddress(address)).toBe(true);
  });

  it.each(['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111'])('allows public address %s', (address) => {
    expect(isPrivateNetworkAddress(address)).toBe(false);
  });
});
