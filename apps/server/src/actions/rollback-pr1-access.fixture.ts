/**
 * PINNED FIXTURE: the team-access resolver of the minimum supported rollback
 * image, PR 1 (`0a18349c`). Vendored verbatim from
 *   git show 0a18349c:apps/server/src/lib/access.ts
 * (`siteRole`, `siteJoins`, `resolveSiteAccess`, `accessibleProjectIds`; the
 * account-state helpers are unrelated and left out). Never edit it to follow
 * current code: `rollback-safety.postgres.test.ts` runs it against PR 3's
 * writes to prove that rolling back to PR 1 grants nothing PR 3 doesn't.
 */
import { Prisma, type Project, prisma } from '@nibleaf/database';
import type { MemberRole } from '@nibleaf/shared/constants';
import { notFound } from '@/errors';

// Keep the role expression and visibility predicate together for all enumerations.
const siteRole = () => Prisma.sql`CASE WHEN m."orgRole" IN ('owner', 'admin') THEN m."orgRole" WHEN m."orgRole" = 'member' THEN g.role END`;
const siteJoins = () => Prisma.sql`JOIN member m ON m."organizationId" = p."organizationId"
  LEFT JOIN project_member g ON g."projectId" = p.id AND g."organizationId" = m."organizationId" AND g."userId" = m."userId"`;

/** Resolve membership and a site grant in one statement. No active-org state. */
export const resolveSiteAccess = async (userId: string, projectId: string) => {
  const [row] = await prisma.$queryRaw<Array<Project & { effectiveRole: MemberRole }>>(Prisma.sql`
    SELECT p.*, ${siteRole()} AS "effectiveRole" FROM project p ${siteJoins()}
    WHERE p.id = ${projectId} AND m."userId" = ${userId} AND ${siteRole()} IN ('owner', 'admin', 'member', 'viewer')
  `);
  if (!row) throw notFound('project', { id: projectId });
  const { effectiveRole: role, ...project } = row;
  return { project, organizationId: project.organizationId, role };
};

export const accessibleProjectIds = async (userId: string, organizationId?: string): Promise<string[]> => {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT p.id FROM project p ${siteJoins()}
    WHERE m."userId" = ${userId} AND ${siteRole()} IN ('owner', 'admin', 'member', 'viewer')
    ${organizationId ? Prisma.sql`AND p."organizationId" = ${organizationId}` : Prisma.empty}
    ORDER BY p."createdAt", p.id
  `);
  return rows.map(({ id }) => id);
};
