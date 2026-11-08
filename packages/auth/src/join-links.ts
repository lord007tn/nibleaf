import { prisma } from '@nibleaf/database';
import { hashJoinLinkToken } from '@nibleaf/shared/crypto';
import { emailInDomain, isJoinLinkToken, JOIN_LINK_COOKIE, joinLinkStatus } from '@nibleaf/shared/join-links';

/** One cookie's value from a request's Cookie header. */
export const readCookie = (headers: Headers | null | undefined, name: string): string | null => {
  const header = headers?.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator > 0 && part.slice(0, separator).trim() === name) {
      try {
        return decodeURIComponent(part.slice(separator + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
};

/**
 * Whether a brand-new account is arriving through a site's join link that will
 * admit it: the /join page left the link's token in a short-lived cookie, the
 * link is active, and the address satisfies its domain rule. Sign-up then skips
 * the starter workspace, exactly as it does for a pending invitation. Anything
 * else (no cookie, a malformed or unknown token, a revoked, expired or used-up
 * link, another domain) keeps the normal starter workspace.
 */
export async function arrivingThroughJoinLink(email: string, headers: Headers | null | undefined): Promise<boolean> {
  const token = readCookie(headers, JOIN_LINK_COOKIE);
  if (!isJoinLinkToken(token)) return false;
  try {
    const link = await prisma.joinLink.findUnique({
      where: { tokenHash: hashJoinLinkToken(token) },
      select: { revokedAt: true, expiresAt: true, maxUses: true, useCount: true, allowedDomain: true },
    });
    return Boolean(link && joinLinkStatus(link) === 'active' && emailInDomain(email, link.allowedDomain));
  } catch {
    return false;
  }
}
