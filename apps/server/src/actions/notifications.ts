import { prisma } from '@nibleaf/database';
import type { MarkNotificationsReadBody } from '@nibleaf/validators';

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
// the project's organization. Titles/bodies are stored as plain English text —
// the popover chrome is localized client-side, the payload is not.

/** What a producer wants every recipient to see. */
export interface NotificationInput {
  type: string;
  title: string;
  body?: string;
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
  excludeUserId?: string,
): Promise<{ created: number }> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { organizationId: true } });
  if (!project) {
    return { created: 0 };
  }
  const members = await prisma.member.findMany({
    where: { organizationId: project.organizationId, ...(excludeUserId ? { userId: { not: excludeUserId } } : {}) },
    select: { userId: true },
  });
  if (members.length === 0) {
    return { created: 0 };
  }
  const result = await prisma.notification.createMany({
    data: members.map((member) => ({
      userId: member.userId,
      projectId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      href: input.href ?? null,
    })),
  });
  return { created: result.count };
}

/** One page of a user's inbox, newest first. `cursor` is the previous page's last id. */
export async function listNotifications(userId: string, cursor?: string) {
  const rows = await prisma.notification.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: NOTIFICATIONS_PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const items = rows.slice(0, NOTIFICATIONS_PAGE_SIZE);
  const nextCursor = rows.length > NOTIFICATIONS_PAGE_SIZE ? (items[items.length - 1]?.id ?? null) : null;
  return { items, nextCursor };
}

export const getUnreadNotificationCount = (userId: string): Promise<number> => prisma.notification.count({ where: { userId, readAt: null } });

/** Mark the given notifications (or the whole inbox with `all: true`) read.
 *  Scoped to the session user — ids belonging to someone else are ignored. */
export async function markNotificationsRead(userId: string, body: MarkNotificationsReadBody): Promise<{ updated: number }> {
  const where = body.all === true ? { userId, readAt: null } : { userId, readAt: null, id: { in: body.ids ?? [] } };
  const result = await prisma.notification.updateMany({ where, data: { readAt: new Date() } });
  return { updated: result.count };
}
