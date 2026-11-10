import { type Prisma, prisma } from '@nibleaf/database';
import { effectiveSiteRole } from '@nibleaf/shared/rbac';
import type { MarkNotificationsReadBody } from '@nibleaf/validators';
import { accessibleProjectIds } from '@/lib/access';

/**
 * Workspace notification preferences live as a JSON blob on `Organization.metadata`
 * (`{ notifications: { [id]: boolean } }`), edited in the per-site Notifications
 * settings. Every notification defaults ON, so only an explicit `false` silences it.
 */
export function notificationEnabled(metadata: string | null | undefined, id: string): boolean {
  if (!metadata) {
    return true;
  }
  try {
    const parsed = JSON.parse(metadata) as { notifications?: Record<string, boolean> };
    return parsed.notifications?.[id] !== false;
  } catch {
    return true;
  }
}

// ─── In-app notification inbox (the bell in the dashboard header) ────────────
// Rows are personal (per user); producers fan one event out to every member of
// the project's organization. New producers supply structured parameters for
// client-side localization; titles/bodies remain for older clients and rows.

/** What a producer wants every recipient to see. */
export interface NotificationInput {
  type: string;
  title: string;
  body?: string;
  params?: Prisma.InputJsonObject;
  /** Dashboard-relative link opened when the notification is clicked. */
  href?: string;
}

/** The inbox page size (newest first). */
const NOTIFICATIONS_PAGE_SIZE = 50;

/**
 * Fan an event out as one in-app notification per member of the project's
 * organization. Best-effort by design at the call sites — producers must never
 * fail the action that triggered them, so wrap calls in `.catch(() => …)`.
 */
export async function createNotificationsForOrgMembers(
  projectId: string,
  input: NotificationInput,
  /** A user to leave out (usually the actor), or that plus the member roles to reach. */
  options?: string | { excludeUserId?: string; roles?: string[] },
): Promise<{ created: number }> {
  const { excludeUserId, roles } = typeof options === 'string' ? { excludeUserId: options, roles: undefined } : (options ?? {});
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { organizationId: true } });
  if (!project) {
    return { created: 0 };
  }
  const members = await prisma.member.findMany({
    where: {
      organizationId: project.organizationId,
      ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
      user: { banned: false, suspendedAt: null },
      OR: [{ orgRole: { in: ['owner', 'admin'] } }, { orgRole: 'member', projectGrants: { some: { projectId } } }],
    },
    select: { userId: true, orgRole: true, projectGrants: { where: { projectId }, select: { role: true } } },
  });
  if (members.length === 0) {
    return { created: 0 };
  }
  const result = await prisma.notification.createMany({
    data: members
      .filter((member) => !roles || roles.includes(effectiveSiteRole(member.orgRole, member.projectGrants[0]?.role ?? null) ?? ''))
      .map((member) => ({
        userId: member.userId,
        projectId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        ...(input.params ? { params: input.params } : {}),
        href: input.href ?? null,
      })),
  });
  return { created: result.count };
}

/** One page of a user's inbox, newest first. `cursor` is the previous page's last id. */
export async function listNotifications(userId: string, cursor?: string) {
  const rows = await prisma.notification.findMany({
    where: await inboxWhere(userId),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: NOTIFICATIONS_PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const items = rows.slice(0, NOTIFICATIONS_PAGE_SIZE);
  const nextCursor = rows.length > NOTIFICATIONS_PAGE_SIZE ? (items[items.length - 1]?.id ?? null) : null;
  return { items, nextCursor };
}

const inboxWhere = async (userId: string): Promise<Prisma.NotificationWhereInput> => {
  const [projectIds, memberships] = await Promise.all([
    accessibleProjectIds(userId),
    prisma.member.findMany({ where: { userId, orgRole: { in: ['owner', 'admin'] } }, select: { organizationId: true } }),
  ]);
  return { userId, OR: [{ projectId: { in: projectIds } }, { projectId: null, organizationId: { in: memberships.map((m) => m.organizationId) } }] };
};

export const getUnreadNotificationCount = async (userId: string): Promise<number> =>
  prisma.notification.count({ where: { ...(await inboxWhere(userId)), readAt: null } });

/** Mark the given notifications (or the whole inbox with `all: true`) read.
 *  Scoped to the session user — ids belonging to someone else are ignored. */
export async function markNotificationsRead(userId: string, body: MarkNotificationsReadBody): Promise<{ updated: number }> {
  const where = { ...(await inboxWhere(userId)), readAt: null, ...(body.all === true ? {} : { id: { in: body.ids ?? [] } }) };
  const result = await prisma.notification.updateMany({ where, data: { readAt: new Date() } });
  return { updated: result.count };
}
