import type { Prisma } from '@nibleaf/database';
import { rankOf } from '@nibleaf/shared/rbac';

/**
 * Keep the legacy `Member.role` (what the previous release reads after a
 * rollback) at or below what the new model grants, in the same transaction as
 * the grant change (design §10.1, "Legacy mirror on change").
 *
 * - Org Owner/Admin rows are written explicitly by their callers.
 * - An org `member` keeps the LOWER of its current legacy role and its site
 *   grant: a site grant never raises the legacy role (a rollback can only
 *   under-grant), and a demotion lowers it at once.
 * - An org `member` with no grant left has no access in the new model. The old
 *   release treats any `Member` row as membership (project list, private
 *   reader access, analytics, MCP), so the row itself is deleted.
 *
 * Writes `orgRole` in the same UPDATE so the legacy-writer triggers treat this
 * as an explicit new-model write and leave the grants alone.
 */
export async function syncLegacyMembership(tx: Prisma.TransactionClient, organizationId: string, userId: string) {
  const member = await tx.member.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    include: { projectGrants: { select: { role: true } } },
  });
  if (member?.orgRole !== 'member') return { deleted: false };
  if (!member.projectGrants.length) {
    await tx.member.delete({ where: { id: member.id } });
    return { deleted: true };
  }
  // After a merge (several websites) the old release is unsupported; still never exceed any grant.
  const lowestGrant = member.projectGrants.reduce((low, grant) => (rankOf(grant.role) < rankOf(low) ? grant.role : low), 'admin');
  const next = rankOf(member.role) <= rankOf(lowestGrant) ? member.role : lowestGrant;
  if (next !== member.role) await tx.member.update({ where: { id: member.id }, data: { role: next, orgRole: member.orgRole } });
  return { deleted: false };
}
