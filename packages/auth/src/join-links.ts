import { type Prisma, prisma } from '@nibleaf/database';
import { hashJoinLinkToken } from '@nibleaf/shared/crypto';
import { emailInDomain, isJoinLinkToken, JOIN_LINK_COOKIE, joinLinkStatus } from '@nibleaf/shared/join-links';
import { canAssignRole, effectiveSiteRole } from '@nibleaf/shared/rbac';

type Db = typeof prisma | Prisma.TransactionClient;

/**
 * A join link only works while the person who created it could still grant
 * its role: they are still on that site's team, not suspended, and their
 * CURRENT role can assign the link's role. A deleted creator (`createdById`
 * null) authorizes nothing. This is checked on every preview and join, so a
 * removed or demoted Admin never leaves a working Admin link behind, however
 * they lost the role.
 */
export async function joinLinkCreatorAuthorizes(
  db: Db,
  link: { id: string; organizationId: string; createdById: string | null; role: string },
): Promise<boolean> {
  if (!link.createdById) return false;
  const creator = await db.member.findUnique({
    where: { organizationId_userId: { organizationId: link.organizationId, userId: link.createdById } },
    select: { orgRole: true, projectGrants: { select: { projectId: true, role: true } }, user: { select: { banned: true, suspendedAt: true } } },
  });
  if (!creator || creator.user.banned || creator.user.suspendedAt) return false;
  const grants = await db.joinLinkGrant.findMany({
    where: { joinLinkId: link.id, organizationId: link.organizationId },
    select: { projectId: true, role: true },
  });
  return (
    grants.length > 0 &&
    grants.every((grant) => {
      const role = effectiveSiteRole(creator.orgRole, creator.projectGrants.find((g) => g.projectId === grant.projectId)?.role ?? null);
      return role !== null && canAssignRole(role, grant.role);
    })
  );
}

/**
 * Disable the active links `userId` created that their new role can no longer
 * grant: all of them when they left the site (`role` null), otherwise those
 * whose role is above it. With `organizationId` null, every site's (account
 * deletion). Returns how many were disabled.
 */
export async function revokeJoinLinksBeyondRole(db: Db, organizationId: string | null, userId: string, role: string | null): Promise<number> {
  const links = await db.joinLink.findMany({
    where: { createdById: userId, revokedAt: null, ...(organizationId ? { organizationId } : {}) },
    select: { id: true, grants: { select: { role: true } } },
  });
  const ids = links
    .filter((link) => role === null || link.grants.length === 0 || link.grants.some((grant) => !canAssignRole(role, grant.role)))
    .map((link) => link.id);
  if (ids.length === 0) return 0;
  const { count } = await db.joinLink.updateMany({ where: { id: { in: ids }, revokedAt: null }, data: { revokedAt: new Date() } });
  return count;
}

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
      select: {
        id: true,
        organizationId: true,
        createdById: true,
        role: true,
        revokedAt: true,
        expiresAt: true,
        maxUses: true,
        useCount: true,
        allowedDomain: true,
      },
    });
    return Boolean(
      link && joinLinkStatus(link) === 'active' && emailInDomain(email, link.allowedDomain) && (await joinLinkCreatorAuthorizes(prisma, link)),
    );
  } catch {
    return false;
  }
}
