import { prisma } from '@nibleaf/database';
import { notFound } from '@/errors';
import { accessibleProjectIds, resolveOrgAccess, resolveSiteAccess } from '@/lib/access';
import { describeSwitcherProjects } from './projects';

/** Personal email notifications kept on the user (design §5.4.4). Each one is
 *  on unless the person turned it off. */
export const PERSONAL_NOTIFICATION_KEYS = [
  'workspace_weekly',
  'workspace_plan',
  'project_new',
  'project_deploy',
  'project_deploy_failed',
  'member_joined',
  'security_login',
] as const;
export type PersonalNotificationKey = (typeof PERSONAL_NOTIFICATION_KEYS)[number];

const RECENT_WEBSITES_KEPT = 10;
const RECENT_WEBSITES_SHOWN = 3;
const isOrgAdmin = (orgRole: string) => orgRole === 'owner' || orgRole === 'admin';

type Membership = { organizationId: string; orgRole: string; createdAt: Date; id: string };

/** The landing organization (design §5.4.3): the last one opened while still a
 *  member, else the one they own, else the oldest membership. Never trusted:
 *  it only chooses among memberships read now. */
export const landingMembership = <T extends Membership>(memberships: readonly T[], lastOrganizationId: string | null | undefined): T | null => {
  const oldestFirst = [...memberships].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  return (
    oldestFirst.find((member) => member.organizationId === lastOrganizationId) ??
    oldestFirst.find((member) => member.orgRole === 'owner') ??
    oldestFirst[0] ??
    null
  );
};

/**
 * Everything the org switcher opens with, in one request (design §5.4.1):
 * the caller's organizations with their role and how many websites they can
 * open there, up to three recently opened websites, and the landing org.
 * Only what the caller can open now is returned.
 */
export const getSwitcher = async (userId: string) => {
  const [memberships, preference, accessibleIds] = await Promise.all([
    prisma.member.findMany({
      where: { userId },
      select: {
        id: true,
        organizationId: true,
        orgRole: true,
        createdAt: true,
        organization: { select: { id: true, slug: true, name: true, logo: true } },
      },
    }),
    prisma.userPreference.findUnique({ where: { userId }, select: { lastOrganizationId: true, recentProjectIds: true } }),
    accessibleProjectIds(userId),
  ]);
  const accessible = new Set(accessibleIds);
  const projectOrgs = accessibleIds.length
    ? await prisma.project.findMany({ where: { id: { in: accessibleIds } }, select: { id: true, organizationId: true } })
    : [];
  const orgOfProject = new Map(projectOrgs.map((project) => [project.id, project.organizationId]));
  const recentIds = (preference?.recentProjectIds ?? []).filter((id) => accessible.has(id));

  const rank = new Map<string, number>();
  const lastOrganizationId = preference?.lastOrganizationId;
  if (lastOrganizationId) rank.set(lastOrganizationId, 0);
  for (const id of recentIds) {
    const orgId = orgOfProject.get(id);
    if (orgId && !rank.has(orgId)) rank.set(orgId, rank.size);
  }
  const ordered = [...memberships].sort(
    (a, b) =>
      (rank.get(a.organizationId) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.organizationId) ?? Number.MAX_SAFE_INTEGER) ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id),
  );

  const shownRecent = recentIds.slice(0, RECENT_WEBSITES_SHOWN);
  const recentRows = new Map((await describeSwitcherProjects(shownRecent)).map((row) => [row.id, row]));
  const orgById = new Map(memberships.map((member) => [member.organizationId, member.organization]));
  const landing = landingMembership(memberships, lastOrganizationId);

  return {
    organizations: ordered.map((member) => ({
      id: member.organization.id,
      slug: member.organization.slug,
      name: member.organization.name,
      logo: member.organization.logo,
      orgRole: member.orgRole as 'owner' | 'admin' | 'member',
      canCreateWebsite: isOrgAdmin(member.orgRole),
      websiteCount: projectOrgs.filter((project) => project.organizationId === member.organizationId).length,
    })),
    recent: shownRecent.flatMap((id) => {
      const row = recentRows.get(id);
      const org = row ? orgById.get(row.organizationId) : undefined;
      if (!(row && org)) return [];
      const { organizationId: _organizationId, ...website } = row;
      return [{ ...website, organization: { id: org.id, slug: org.slug, name: org.name } }];
    }),
    landing: landing ? { id: landing.organization.id, slug: landing.organization.slug } : null,
  };
};

/**
 * Remember where the caller is (design §5.4.3): an organization page records
 * that org; a website records its org and moves the website to the front of
 * the recent list. Both are authorized now (404 otherwise), never later.
 */
export const recordLastOrganization = async (userId: string, target: { organizationId?: string; projectId?: string }) => {
  if (target.projectId) {
    const { organizationId } = await resolveSiteAccess(userId, target.projectId);
    const preference = await prisma.userPreference.findUnique({ where: { userId }, select: { recentProjectIds: true } });
    const recentProjectIds = [target.projectId, ...(preference?.recentProjectIds ?? []).filter((id) => id !== target.projectId)].slice(
      0,
      RECENT_WEBSITES_KEPT,
    );
    await prisma.userPreference.upsert({
      where: { userId },
      create: { userId, lastOrganizationId: organizationId, recentProjectIds },
      update: { lastOrganizationId: organizationId, recentProjectIds },
    });
  } else if (target.organizationId) {
    const { organizationId } = await resolveOrgAccess(userId, target.organizationId);
    await prisma.userPreference.upsert({
      where: { userId },
      create: { userId, lastOrganizationId: organizationId },
      update: { lastOrganizationId: organizationId },
    });
  }
  return { ok: true as const };
};

/** Pending invitations addressed to the caller's verified email (the welcome
 *  screen's Accept list). An unverified address sees none. */
export const listMyInvitations = async (userId: string) => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, emailVerified: true } });
  if (!user) throw notFound('user');
  if (!user.emailVerified) return [];
  const invitations = await prisma.invitation.findMany({
    where: {
      email: { equals: user.email, mode: 'insensitive' },
      status: 'pending',
      kind: 'member',
      expiresAt: { gt: new Date() },
      organization: { deletionStartedAt: null },
    },
    select: {
      id: true,
      orgRole: true,
      expiresAt: true,
      organization: { select: { name: true, logo: true } },
      inviter: { select: { name: true } },
      grants: { select: { role: true, project: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return invitations.map((invitation) => ({
    id: invitation.id,
    organization: invitation.organization,
    inviter: invitation.inviter ? { name: invitation.inviter.name } : null,
    orgRole: invitation.orgRole,
    grants: invitation.grants.map((grant) => ({ projectName: grant.project.name, role: grant.role })),
    expiresAt: invitation.expiresAt,
  }));
};

const readNotifications = (value: unknown): Record<PersonalNotificationKey, boolean> => {
  const stored = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return Object.fromEntries(PERSONAL_NOTIFICATION_KEYS.map((key) => [key, stored[key] !== false])) as Record<PersonalNotificationKey, boolean>;
};

export const getPreferences = async (userId: string) => {
  const preference = await prisma.userPreference.findUnique({ where: { userId }, select: { notifications: true } });
  return { notifications: readNotifications(preference?.notifications) };
};

/** Merge the given toggles into the caller's personal notification settings. */
export const updatePreferences = async (userId: string, body: { notifications: Partial<Record<PersonalNotificationKey, boolean>> }) => {
  const current = await getPreferences(userId);
  const notifications = { ...current.notifications, ...body.notifications };
  await prisma.userPreference.upsert({ where: { userId }, create: { userId, notifications }, update: { notifications } });
  return { notifications };
};
