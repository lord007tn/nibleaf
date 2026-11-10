import { Prisma, type Project, prisma } from '@nibleaf/database';
import type { MemberRole } from '@nibleaf/shared/constants';
import type { OrgRole } from '@nibleaf/shared/rbac';
import { AppError, notFound } from '@/errors';

/** Shared by dashboard sessions, personal credentials and private-site sessions. */
export const assertUsableAccount = async (userId: string) => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, banned: true, suspendedAt: true } });
  if (!user || user.banned || user.suspendedAt) throw new AppError({ code: 'auth:invalid_session' });
  return user;
};

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

export const resolveOrgAccess = async (userId: string, organizationId: string) => {
  const member = await prisma.member.findUnique({ where: { organizationId_userId: { organizationId, userId } }, select: { orgRole: true } });
  if (!member) throw notFound('organization', { id: organizationId });
  return { organizationId, orgRole: member.orgRole as OrgRole };
};

/** Private-reader checks return an ordinary denial; database failures still
 * propagate rather than being mistaken for an anonymous visitor. */
export const optionalSiteAccess = async (userId: string, projectId: string) => {
  try {
    await assertUsableAccount(userId);
    return await resolveSiteAccess(userId, projectId);
  } catch (error) {
    if (error instanceof AppError && (error.status === 404 || error.code === 'auth:invalid_session')) return null;
    throw error;
  }
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
