import { type Prisma, prisma } from '@nibleaf/database';
import { hashJoinLinkToken } from '@nibleaf/shared/crypto';
import { emailInDomain, isJoinLinkToken, JOIN_LINK_COOKIE, joinLinkStatus } from '@nibleaf/shared/join-links';
import { canAssignRole, effectiveSiteRole } from '@nibleaf/shared/rbac';

type Db = typeof prisma | Prisma.TransactionClient;

export type AdmissionGrant = { projectId: string; role: string };

/** Shared issuer policy for email invitations, link previews and revocation. */
export async function issuerAuthorizes(
  db: Db,
  organizationId: string,
  userId: string | null,
  orgRole: string,
  grants: AdmissionGrant[],
): Promise<boolean> {
  if (!userId || !['admin', 'member'].includes(orgRole)) return false;
  const issuer = await db.member.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { orgRole: true, projectGrants: { select: { projectId: true, role: true } }, user: { select: { banned: true, suspendedAt: true } } },
  });
  if (!issuer || issuer.user.banned || issuer.user.suspendedAt) return false;
  const orgAdmin = issuer.orgRole === 'owner' || issuer.orgRole === 'admin';
  if (orgRole === 'admin' && !orgAdmin) return false;
  // A site administrator cannot invite a grantless organization member.
  if (!orgAdmin && grants.length === 0) return false;
  return grants.every((grant) => {
    if (!['admin', 'member', 'viewer'].includes(grant.role)) return false;
    const role = effectiveSiteRole(issuer.orgRole, issuer.projectGrants.find((g) => g.projectId === grant.projectId)?.role ?? null);
    return role !== null && canAssignRole(role, grant.role);
  });
}

export async function joinLinkCreatorAuthorizes(
  db: Db,
  link: { id: string; organizationId: string; createdById: string | null; role: string },
): Promise<boolean> {
  const grants = await db.joinLinkGrant.findMany({
    where: { joinLinkId: link.id, organizationId: link.organizationId },
    select: { projectId: true, role: true },
  });
  return grants.length > 0 && issuerAuthorizes(db, link.organizationId, link.createdById, 'member', grants);
}

/** Called under the org lock after any membership/grant change. Revocation is final. */
export async function revokeJoinLinksBeyondRole(db: Db, organizationId: string | null, userId: string, role: string | null): Promise<number> {
  const whereOrg = organizationId ? { organizationId } : {};
  const links = await db.joinLink.findMany({ where: { createdById: userId, revokedAt: null, ...whereOrg }, include: { grants: true } });
  const deletingAccount = organizationId === null && role === null;
  const ids: string[] = [];
  for (const link of links)
    if (deletingAccount || !link.grants.length || !(await issuerAuthorizes(db, link.organizationId, userId, 'member', link.grants)))
      ids.push(link.id);
  const revoked = ids.length
    ? await db.joinLink.updateMany({ where: { id: { in: ids }, revokedAt: null }, data: { revokedAt: new Date() } })
    : { count: 0 };
  const invitations = await db.invitation.findMany({
    where: { inviterId: userId, status: 'pending', kind: 'member', ...whereOrg },
    include: { grants: true },
  });
  const cancelled: string[] = [];
  for (const invite of invitations)
    if (deletingAccount || !(await issuerAuthorizes(db, invite.organizationId, userId, invite.orgRole, invite.grants))) cancelled.push(invite.id);
  if (cancelled.length) await db.invitation.updateMany({ where: { id: { in: cancelled }, status: 'pending' }, data: { status: 'canceled' } });
  return revoked.count;
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
