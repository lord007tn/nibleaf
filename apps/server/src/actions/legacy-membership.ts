import type { Prisma } from '@nibleaf/database';
import { MemberRole } from '@nibleaf/shared/constants';
import { rankOf } from '@nibleaf/shared/rbac';

/**
 * Keep the legacy `Member.role` at or below what the new model grants, in the
 * same transaction as the grant change (design §10.1, "Legacy mirror on change").
 *
 * - Org Owner/Admin rows are written explicitly by their callers.
 * - An org `member` keeps the LOWER of its current legacy role and its lowest
 *   site grant: a grant never raises the legacy role, and a demotion lowers it
 *   at once.
 * - An org `member` with no grant is a legitimate state from PR 3 on (design
 *   §5, §6): they belong to the organization and open no website. The row
 *   stays (removing someone from the organization is an explicit action) and
 *   its legacy role drops to the least privilege, `viewer`. The rollback target
 *   of this release is PR 1/PR 2, which read grants (no grant → 404), so the
 *   row grants nothing there either.
 *
 * Writes `orgRole` in the same UPDATE so the legacy-writer triggers treat this
 * as an explicit new-model write and leave the grants alone.
 */
export async function syncLegacyMembership(tx: Prisma.TransactionClient, organizationId: string, userId: string) {
  const member = await tx.member.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    include: { projectGrants: { select: { role: true } } },
  });
  if (member?.orgRole !== 'member') return;
  const lowestGrant = member.projectGrants.length
    ? member.projectGrants.reduce((low, grant) => (rankOf(grant.role) < rankOf(low) ? grant.role : low), MemberRole.ADMIN as string)
    : MemberRole.VIEWER;
  const next = rankOf(member.role) <= rankOf(lowestGrant) ? member.role : lowestGrant;
  if (next !== member.role) await tx.member.update({ where: { id: member.id }, data: { role: next, orgRole: member.orgRole } });
}
