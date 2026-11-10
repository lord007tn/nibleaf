import { type Prisma, prisma } from '@nibleaf/database';
import { MemberRole } from '@nibleaf/shared/constants';
import { canAdminister, effectiveSiteRole } from '@nibleaf/shared/rbac';
import { accessibleProjectIds, resolveSiteAccess } from '@/lib/access';

/** Roles that administer a site, and so may see and manage its people. */
const ADMIN_ROLES = [MemberRole.OWNER, MemberRole.ADMIN];
/** Most suggestions an invite box shows at once. */
export const MAX_INVITE_SUGGESTIONS = 8;

const userSelect = { id: true, name: true, email: true, image: true } as const;

/** People per page on the People page, by default and at most. */
export const PEOPLE_PAGE_SIZE = 25;
export const MAX_PEOPLE_PAGE_SIZE = 100;
/** Most recent pending invitations the People page lists; `invitationsTotal` says how many there are. */
export const MAX_PEOPLE_INVITATIONS = 50;

export interface ListPeopleOptions {
  /** Part of a name or email; matched in SQL, ignoring case. */
  q?: string;
  /** The `nextCursor` of the previous page (a user id). */
  cursor?: string;
  limit?: number;
}

/** Only sites on which the actor has effective Admin access contribute people. */
const administeredSites = async (userId: string) => {
  const ids = await accessibleProjectIds(userId);
  const projects = await prisma.project.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, organizationId: true } });
  const roles = await Promise.all(projects.map(async (project) => ({ ...project, role: (await resolveSiteAccess(userId, project.id)).role })));
  return roles.filter((project) => canAdminister(project.role));
};

const visibleMembership = (projectIds: string[], organizationIds: string[]): Prisma.MemberWhereInput => ({
  organizationId: { in: organizationIds },
  OR: [{ orgRole: { in: ADMIN_ROLES } }, { orgRole: 'member', projectGrants: { some: { projectId: { in: projectIds } } } }],
});

export const listPeople = async (userId: string, options: ListPeopleOptions = {}) => {
  const q = options.q?.trim() ?? '';
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? PEOPLE_PAGE_SIZE), 1), MAX_PEOPLE_PAGE_SIZE);
  const sites = await administeredSites(userId);
  const projectIds = sites.map((site) => site.id);
  const organizationIds = [...new Set(sites.map((site) => site.organizationId))];
  if (!sites.length) return { sites: [], people: [], total: 0, nextCursor: null, invitations: [], invitationsTotal: 0 };
  const membershipWhere = visibleMembership(projectIds, organizationIds);
  const peopleWhere: Prisma.UserWhereInput = {
    members: { some: membershipWhere },
    ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] } : {}),
  };
  const invitationWhere: Prisma.InvitationWhereInput = {
    status: 'pending',
    expiresAt: { gt: new Date() },
    grants: { some: { projectId: { in: projectIds } } },
    ...(q ? { email: { contains: q, mode: 'insensitive' } } : {}),
  };
  const [users, total, invitations, invitationsTotal] = await Promise.all([
    prisma.user.findMany({
      where: peopleWhere,
      select: {
        ...userSelect,
        members: {
          where: membershipWhere,
          select: {
            id: true,
            orgRole: true,
            organizationId: true,
            projectGrants: { where: { projectId: { in: projectIds } }, select: { projectId: true, role: true } },
          },
        },
      },
      orderBy: [{ name: 'asc' }, { email: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    }),
    prisma.user.count({ where: peopleWhere }),
    options.cursor
      ? Promise.resolve([])
      : prisma.invitation.findMany({
          where: invitationWhere,
          select: {
            id: true,
            email: true,
            expiresAt: true,
            grants: { where: { projectId: { in: projectIds } }, select: { projectId: true, role: true } },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: MAX_PEOPLE_INVITATIONS,
        }),
    options.cursor ? Promise.resolve(0) : prisma.invitation.count({ where: invitationWhere }),
  ]);
  const page = users.slice(0, limit);
  return {
    sites: sites.map((site) => ({ projectId: site.id, name: site.name, myRole: site.role })).sort((a, b) => a.name.localeCompare(b.name)),
    people: page.map(({ members, ...user }) => ({
      user,
      memberships: members.flatMap((member) =>
        sites.flatMap((site) => {
          if (member.organizationId !== site.organizationId) return [];
          const role = effectiveSiteRole(member.orgRole, member.projectGrants.find((grant) => grant.projectId === site.id)?.role ?? null);
          return role ? [{ projectId: site.id, memberId: member.id, role }] : [];
        }),
      ),
    })),
    total,
    nextCursor: users.length > limit ? (page.at(-1)?.id ?? null) : null,
    invitations: invitations.flatMap(({ grants, ...invitation }) => grants.map((grant) => ({ ...invitation, ...grant }))),
    invitationsTotal,
  };
};

export const suggestPeopleToInvite = async (actorUserId: string, organizationId: string, query: string, projectId?: string) => {
  const q = query.trim();
  if (!q) return [];
  const administered = await administeredSites(actorUserId);
  const targets = administered.filter((site) => site.organizationId === organizationId && (!projectId || site.id === projectId));
  const [target] = targets;
  if (targets.length !== 1 || !target) return [];
  const membershipWhere = visibleMembership(
    administered.map((site) => site.id),
    administered.map((site) => site.organizationId),
  );
  return prisma.user.findMany({
    where: {
      id: { not: actorUserId },
      banned: false,
      suspendedAt: null,
      AND: [
        {
          OR: [
            {
              members: { some: membershipWhere },
              OR: [
                { email: { startsWith: q, mode: 'insensitive' } },
                { name: { startsWith: q, mode: 'insensitive' } },
                { name: { contains: ` ${q}`, mode: 'insensitive' } },
              ],
            },
            { email: { equals: q, mode: 'insensitive' }, members: { some: { organizationId } } },
          ],
        },
        {
          NOT: {
            members: {
              some: { organizationId, OR: [{ orgRole: { in: ADMIN_ROLES } }, { projectGrants: { some: { projectId: target.id } } }] },
            },
          },
        },
      ],
    },
    select: userSelect,
    orderBy: [{ name: 'asc' }, { email: 'asc' }],
    take: MAX_INVITE_SUGGESTIONS,
  });
};
