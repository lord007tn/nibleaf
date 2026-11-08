import { prisma } from '@nibleaf/database';
import { MemberRole } from '@nibleaf/shared/constants';

/** Roles that administer a site, and so may see and manage its people. */
const ADMIN_ROLES = [MemberRole.OWNER, MemberRole.ADMIN];
/** Most suggestions an invite box shows at once. */
export const MAX_INVITE_SUGGESTIONS = 8;

const userSelect = { id: true, name: true, email: true, image: true } as const;

/**
 * Everyone on the sites the caller administers (Admin or Owner), with each
 * person's role on each of those sites, plus pending invitations. Sites the
 * caller only edits or views, and every other site, are never included: this
 * is the "People" page, and each change on it goes through the per-site
 * member actions and their guards.
 */
export const listPeople = async (userId: string) => {
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
  if (organizationIds.length === 0) return { sites: [], people: [], invitations: [] };

  const [members, invitations] = await Promise.all([
    prisma.member.findMany({
      where: { organizationId: { in: organizationIds } },
      select: { id: true, role: true, organizationId: true, createdAt: true, user: { select: userSelect } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.invitation.findMany({
      where: { organizationId: { in: organizationIds }, status: 'pending', expiresAt: { gt: new Date() } },
      select: { id: true, email: true, role: true, organizationId: true, expiresAt: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const people = new Map<
    string,
    { user: (typeof members)[number]['user']; memberships: Array<{ projectId: string; memberId: string; role: string }> }
  >();
  for (const member of members) {
    const site = siteByOrg.get(member.organizationId);
    if (!site) continue;
    const person = people.get(member.user.id) ?? { user: member.user, memberships: [] };
    person.memberships.push({ projectId: site.projectId, memberId: member.id, role: member.role });
    people.set(member.user.id, person);
  }

  return {
    sites: sites.map(({ organizationId: _organizationId, ...site }) => site),
    people: [...people.values()].sort((a, b) => (a.user.name || a.user.email).localeCompare(b.user.name || b.user.email)),
    invitations: invitations.flatMap(({ organizationId, ...invitation }) => {
      const site = siteByOrg.get(organizationId);
      return site ? [{ ...invitation, projectId: site.projectId }] : [];
    }),
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
