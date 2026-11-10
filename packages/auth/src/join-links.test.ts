import { prisma } from '@nibleaf/database';
import { generateJoinLinkToken, hashJoinLinkToken } from '@nibleaf/shared/crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { arrivingThroughJoinLink, readCookie } from './join-links';

vi.mock('@nibleaf/database', () => ({
  prisma: {
    joinLink: { findUnique: vi.fn() },
    member: { findUnique: vi.fn() },
    joinLinkGrant: { findMany: vi.fn(async () => [{ projectId: 'project', role: 'member' }]) },
  },
}));

const token = generateJoinLinkToken();
const headers = (cookie: string) => new Headers({ cookie });
const active = {
  id: 'link',
  organizationId: 'org-1',
  createdById: 'admin-1',
  role: 'member',
  revokedAt: null,
  expiresAt: null,
  maxUses: null,
  useCount: 0,
  allowedDomain: null,
};
const creator = (role: string, suspendedAt: Date | null = null) => ({
  orgRole: 'member',
  projectGrants: [{ projectId: 'project', role }],
  user: { banned: false, suspendedAt },
});

describe('readCookie', () => {
  it('reads one cookie among several', () => {
    expect(readCookie(headers(`a=1; nibleaf_join=${token}; b=2`), 'nibleaf_join')).toBe(token);
    expect(readCookie(headers('a=1'), 'nibleaf_join')).toBeNull();
    expect(readCookie(undefined, 'nibleaf_join')).toBeNull();
  });
});

describe('arrivingThroughJoinLink — when sign-up skips the starter workspace', () => {
  beforeEach(() => {
    vi.mocked(prisma.joinLink.findUnique).mockReset();
    vi.mocked(prisma.member.findUnique).mockReset();
    vi.mocked(prisma.member.findUnique).mockResolvedValue(creator('admin') as never);
  });

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

  it.each([
    ['the creator left the site', null],
    ['the creator can no longer grant the role', creator('viewer')],
    ['the creator is suspended', creator('admin', new Date())],
  ])('keeps the starter workspace when %s', async (_label, member) => {
    vi.mocked(prisma.joinLink.findUnique).mockResolvedValue(active as never);
    vi.mocked(prisma.member.findUnique).mockResolvedValue(member as never);
    await expect(arrivingThroughJoinLink('ada@acme.com', headers(`nibleaf_join=${token}`))).resolves.toBe(false);
  });

  it('keeps the starter workspace for a link whose creator was deleted', async () => {
    vi.mocked(prisma.joinLink.findUnique).mockResolvedValue({ ...active, createdById: null } as never);
    await expect(arrivingThroughJoinLink('ada@acme.com', headers(`nibleaf_join=${token}`))).resolves.toBe(false);
    expect(prisma.member.findUnique).not.toHaveBeenCalled();
  });
});
