import { prisma } from '@nibleaf/database';
import { generateJoinLinkToken, hashJoinLinkToken } from '@nibleaf/shared/crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { arrivingThroughJoinLink, readCookie } from './join-links';

vi.mock('@nibleaf/database', () => ({ prisma: { joinLink: { findUnique: vi.fn() } } }));

const token = generateJoinLinkToken();
const headers = (cookie: string) => new Headers({ cookie });
const active = { revokedAt: null, expiresAt: null, maxUses: null, useCount: 0, allowedDomain: null };

describe('readCookie', () => {
  it('reads one cookie among several', () => {
    expect(readCookie(headers(`a=1; nibleaf_join=${token}; b=2`), 'nibleaf_join')).toBe(token);
    expect(readCookie(headers('a=1'), 'nibleaf_join')).toBeNull();
    expect(readCookie(undefined, 'nibleaf_join')).toBeNull();
  });
});

describe('arrivingThroughJoinLink — when sign-up skips the starter workspace', () => {
  beforeEach(() => vi.mocked(prisma.joinLink.findUnique).mockReset());

  it('skips for an active link, looked up by the token hash', async () => {
    vi.mocked(prisma.joinLink.findUnique).mockResolvedValue(active as never);
    await expect(arrivingThroughJoinLink('ada@acme.com', headers(`nibleaf_join=${token}`))).resolves.toBe(true);
    expect(prisma.joinLink.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tokenHash: hashJoinLinkToken(token) } }));
  });

  it.each([
    ['no cookie', '', active],
    ['a malformed token', 'nibleaf_join=not-a-token', active],
    ['an unknown token', `nibleaf_join=${token}`, null],
    ['a revoked link', `nibleaf_join=${token}`, { ...active, revokedAt: new Date() }],
    ['an expired link', `nibleaf_join=${token}`, { ...active, expiresAt: new Date(Date.now() - 1000) }],
    ['a used-up link', `nibleaf_join=${token}`, { ...active, maxUses: 1, useCount: 1 }],
    ['another domain', `nibleaf_join=${token}`, { ...active, allowedDomain: 'acme.com' }],
  ])('keeps the starter workspace for %s', async (_label, cookie, link) => {
    vi.mocked(prisma.joinLink.findUnique).mockResolvedValue(link as never);
    await expect(arrivingThroughJoinLink('ada@other.io', headers(cookie))).resolves.toBe(false);
  });
});
