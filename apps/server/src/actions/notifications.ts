import { createJob, QueueNames } from '@nibleaf/bullmq';
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

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);

/** A branded HTML email shell matching the invite email, with an optional CTA button. */
export function emailLayout(opts: { heading: string; body: string; cta?: { label: string; href: string }; footnote?: string }): string {
  const cta = opts.cta
    ? `<p style="margin:0 0 20px"><a href="${opts.cta.href}" style="display:inline-block;background:#5546e8;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">${escapeHtml(opts.cta.label)}</a></p>`
    : '';
  const footnote = opts.footnote ? `<p style="margin:0;color:#94a3b8;font-size:12px">${escapeHtml(opts.footnote)}</p>` : '';
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;color:#0f172a">
  <h2 style="font-size:18px;margin:0 0 12px">${escapeHtml(opts.heading)}</h2>
  <p style="margin:0 0 16px;color:#475569;line-height:1.6">${opts.body}</p>
  ${cta}${footnote}
</div>`;
}

interface OrgNotification {
  subject: string;
  html: string;
  text?: string;
}

/**
 * Email an organization's members when a workspace notification is enabled.
 * Best-effort: a missing toggle (default ON) sends; an explicit `false` skips;
 * delivery failures are swallowed so they never break the triggering action.
 * `audience` defaults to admins/owners (most workspace events are admin-facing).
 */
export async function notifyOrg(
  organizationId: string,
  notificationId: string,
  email: OrgNotification,
  opts: { audience?: 'admins' | 'all'; excludeUserIds?: string[] } = {},
): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { metadata: true } });
  if (!org || !notificationEnabled(org.metadata, notificationId)) {
    return;
  }
  const members = await prisma.member.findMany({
    where: { organizationId, ...(opts.audience === 'all' ? {} : { role: { in: ['owner', 'admin'] } }) },
    select: { user: { select: { id: true, email: true } } },
  });
  const exclude = new Set(opts.excludeUserIds ?? []);
  const recipients = members.map((m) => m.user).filter((u) => u.email && !exclude.has(u.id));
  await Promise.all(
    recipients.map((u) =>
      createJob(QueueNames.EMAIL, {
        name: 'send-email',
        data: { to: u.email, subject: email.subject, html: email.html, ...(email.text ? { text: email.text } : {}) },
      }).catch(() => undefined),
    ),
  );
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
export const NOTIFICATIONS_PAGE_SIZE = 50;

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

export const getUnreadNotificationCount = (userId: string) => prisma.notification.count({ where: { userId, readAt: null } });

/** Mark the given notifications (or the whole inbox with `all: true`) read.
 *  Scoped to the session user — ids belonging to someone else are ignored. */
export async function markNotificationsRead(userId: string, body: MarkNotificationsReadBody): Promise<{ updated: number }> {
  const where = body.all === true ? { userId, readAt: null } : { userId, readAt: null, id: { in: body.ids ?? [] } };
  const result = await prisma.notification.updateMany({ where, data: { readAt: new Date() } });
  return { updated: result.count };
}
