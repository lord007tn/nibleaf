import { prisma } from '@nibleaf/database';
import { MemberRole } from '@nibleaf/shared/constants';

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

/**
 * Everyone on the sites the caller administers (Admin or Owner), with each
 * person's role on each of those sites, plus pending invitations. Sites the
 * caller only edits or views, and every other site, are never included: this
 * is the "People" page, and each change on it goes through the per-site
 * member actions and their guards.
 *
 * People come a page at a time, ordered by name, then email, then id (so the
 * order is stable and a cursor never skips or repeats anyone), filtered by `q`
 * in the database. Only the first page carries invitations, bounded to the
 * most recent {@link MAX_PEOPLE_INVITATIONS} that match `q`.
 */
export const listPeople = async (userId: string, options: ListPeopleOptions = {}) => {
  const q = options.q?.trim() ?? '';
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? PEOPLE_PAGE_SIZE), 1), MAX_PEOPLE_PAGE_SIZE);
  const administered = await prisma.member.findMany({
    where: { userId, role: { in: ADMIN_ROLES }, user: { suspendedAt: null } },
    select: { role: true, organizationId: true, organization: { select: { projects: { select: { id: true, name: true }, take: 1 } } } },
  });
  const sites = administered
    .flatMap(({ role, organizationId, organization }) => {
      const project = organization.projects[0];
      return project ? [{ projectId: project.id, name: project.name, organizationId, myRole: role }] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const siteByOrg = new Map(sites.map((site) => [site.organizationId, site]));
  const organizationIds = [...siteByOrg.keys()];
  const empty = { sites: [], people: [], total: 0, nextCursor: null, invitations: [], invitationsTotal: 0 };
  if (organizationIds.length === 0) return empty;

  const peopleWhere = {
    members: { some: { organizationId: { in: organizationIds } } },
    ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' as const } }, { email: { contains: q, mode: 'insensitive' as const } }] } : {}),
  };
  const invitationWhere = {
    organizationId: { in: organizationIds },
    status: 'pending',
    expiresAt: { gt: new Date() },
    ...(q ? { email: { contains: q, mode: 'insensitive' as const } } : {}),
  };
  const firstPage = !options.cursor;
  const [users, total, invitations, invitationsTotal] = await Promise.all([
    prisma.user.findMany({
      where: peopleWhere,
      select: {
        ...userSelect,
        members: { where: { organizationId: { in: organizationIds } }, select: { id: true, role: true, organizationId: true } },
      },
      orderBy: [{ name: 'asc' }, { email: 'asc' }, { id: 'asc' }],
      // One more than the page tells whether there is a next one.
      take: limit + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    }),
    prisma.user.count({ where: peopleWhere }),
    firstPage
      ? prisma.invitation.findMany({
          where: invitationWhere,
          select: { id: true, email: true, role: true, organizationId: true, expiresAt: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: MAX_PEOPLE_INVITATIONS,
        })
      : Promise.resolve([]),
    firstPage ? prisma.invitation.count({ where: invitationWhere }) : Promise.resolve(0),
  ]);

  const page = users.slice(0, limit);
  return {
    sites: sites.map(({ organizationId: _organizationId, ...site }) => site),
    people: page.map(({ members, ...user }) => ({
      user,
      memberships: members.flatMap((member) => {
        const site = siteByOrg.get(member.organizationId);
        return site ? [{ projectId: site.projectId, memberId: member.id, role: member.role }] : [];
      }),
    })),
    total,
    nextCursor: users.length > limit ? (page.at(-1)?.id ?? null) : null,
    invitations: invitations.flatMap(({ organizationId, ...invitation }) => {
      const site = siteByOrg.get(organizationId);
      return site ? [{ ...invitation, projectId: site.projectId }] : [];
    }),
    invitationsTotal,
  };
};

/**
 * People to suggest in a site's invite box: members of the caller's OTHER
 * administered sites whose name (or a word of it) or email starts with
 * `query`. Never people from sites the caller doesn't administer, never people
 * already on this site, at most {@link MAX_INVITE_SUGGESTIONS}.
 */
export const suggestPeopleToInvite = async (actorUserId: string, organizationId: string, query: string) => {
  const q = query.trim();
  if (!q) return [];
  const administered = await prisma.member.findMany({
    where: { userId: actorUserId, role: { in: ADMIN_ROLES }, organizationId: { not: organizationId } },
    select: { organizationId: true },
  });
  if (administered.length === 0) return [];
  return prisma.user.findMany({
    where: {
      id: { not: actorUserId },
      suspendedAt: null,
      members: { some: { organizationId: { in: administered.map((row) => row.organizationId) } } },
      // Not already on this site.
      NOT: { members: { some: { organizationId } } },
      OR: [
        { email: { startsWith: q, mode: 'insensitive' } },
        { name: { startsWith: q, mode: 'insensitive' } },
        { name: { contains: ` ${q}`, mode: 'insensitive' } },
      ],
    },
    select: userSelect,
    orderBy: [{ name: 'asc' }, { email: 'asc' }],
    take: MAX_INVITE_SUGGESTIONS,
  });
};
