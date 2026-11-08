import { describe, expect, it } from 'vitest';
import { generateJoinLinkToken, hashJoinLinkToken } from './crypto';
import { emailInDomain, isJoinLinkToken, joinLinkStatus, normalizeEmailDomain } from './join-links';

describe('join link tokens', () => {
  it('carry 256 random bits and match the public token shape', () => {
    const tokens = new Set(Array.from({ length: 200 }, generateJoinLinkToken));
    expect(tokens.size).toBe(200);
    for (const token of tokens) {
      expect(isJoinLinkToken(token)).toBe(true);
      expect(Buffer.from(token.slice(4), 'base64url')).toHaveLength(32);
    }
  });

  it('are stored as a SHA-256 that never contains the token', () => {
    const token = generateJoinLinkToken();
    const hash = hashJoinLinkToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token.slice(4));
    expect(hashJoinLinkToken(token)).toBe(hash);
  });

  it.each(['', 'nlj_short', `xyz_${'a'.repeat(43)}`, `nlj_${'a'.repeat(42)}!`, 42, null])('rejects %j', (value) => {
    expect(isJoinLinkToken(value)).toBe(false);
  });
});

describe('email domain rule', () => {
  it('normalizes what an admin types', () => {
    expect(normalizeEmailDomain(' @Acme.COM ')).toBe('acme.com');
    expect(normalizeEmailDomain('docs.acme.co.uk')).toBe('docs.acme.co.uk');
    expect(normalizeEmailDomain('not a domain')).toBeNull();
    expect(normalizeEmailDomain('acme')).toBeNull();
  });

  it('matches the exact domain only', () => {
    expect(emailInDomain('ada@acme.com', 'acme.com')).toBe(true);
    expect(emailInDomain('Ada@ACME.com', 'acme.com')).toBe(true);
    expect(emailInDomain('ada@evil.acme.com', 'acme.com')).toBe(false);
    expect(emailInDomain('ada@acme.com.evil.io', 'acme.com')).toBe(false);
    expect(emailInDomain('acme.com@evil.io', 'acme.com')).toBe(false);
    expect(emailInDomain('anyone@else.io', null)).toBe(true);
  });
});

describe('joinLinkStatus', () => {
  const now = new Date('2026-11-08T12:00:00Z');
  const base = { revokedAt: null, expiresAt: null, maxUses: null, useCount: 0 };
  it.each([
    [base, 'active'],
    [{ ...base, revokedAt: now }, 'revoked'],
    [{ ...base, expiresAt: '2026-11-08T12:00:00Z' }, 'expired'],
    [{ ...base, expiresAt: '2026-11-09T12:00:00Z' }, 'active'],
    [{ ...base, maxUses: 3, useCount: 3 }, 'used_up'],
    [{ ...base, maxUses: 3, useCount: 2 }, 'active'],
  ] as const)('%j is %s', (link, status) => {
    expect(joinLinkStatus(link, now)).toBe(status);
  });
});
