import { createJob, QueueNames } from '@plume/bullmq';
import { prisma } from '@plume/database';

/**
 * Workspace notification preferences live as a JSON blob on `Organization.metadata`
 * (`{ notifications: { [id]: boolean } }`). Every notification defaults ON, so only
 * an explicit `false` silences it. (Mirrors apps/server/src/actions/notifications.ts —
 * the worker can't import server actions, and the logic is tiny + stable.)
 */
function notificationEnabled(metadata: string | null | undefined, id: string): boolean {
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
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);

function emailLayout(opts: { heading: string; body: string; cta?: { label: string; href: string } }): string {
  const cta = opts.cta
    ? `<p style="margin:0 0 4px"><a href="${opts.cta.href}" style="display:inline-block;background:#5546e8;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">${escapeHtml(opts.cta.label)}</a></p>`
    : '';
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;color:#0f172a">
  <h2 style="font-size:18px;margin:0 0 12px">${escapeHtml(opts.heading)}</h2>
  <p style="margin:0 0 16px;color:#475569;line-height:1.6">${opts.body}</p>
  ${cta}
</div>`;
}

/** Email a project's org admins/owners about a deployment outcome, when the relevant
 *  notification toggle is enabled. Best-effort — never throws into the publish flow. */
export async function notifyDeployment(opts: {
  projectId: string;
  projectName: string;
  version: number;
  siteUrl?: string;
  outcome: 'ready' | 'failed';
  error?: string;
}): Promise<void> {
  try {
    const project = await prisma.project.findUnique({ where: { id: opts.projectId }, select: { organizationId: true } });
    if (!project?.organizationId) {
      return;
    }
    const notificationId = opts.outcome === 'ready' ? 'project_deploy' : 'project_deploy_failed';
    const org = await prisma.organization.findUnique({ where: { id: project.organizationId }, select: { metadata: true } });
    if (!notificationEnabled(org?.metadata, notificationId)) {
      return;
    }
    const members = await prisma.member.findMany({
      where: { organizationId: project.organizationId, role: { in: ['owner', 'admin'] } },
      select: { user: { select: { email: true } } },
    });
    const recipients = members.map((m) => m.user.email).filter(Boolean);
    if (recipients.length === 0) {
      return;
    }
    const name = opts.projectName;
    const email =
      opts.outcome === 'ready'
        ? {
            subject: `${name} published — v${opts.version} is live`,
            html: emailLayout({
              heading: `${escapeHtml(name)} is live`,
              body: `Version <strong>v${opts.version}</strong> of <strong>${escapeHtml(name)}</strong> published successfully and is now live.`,
              ...(opts.siteUrl ? { cta: { label: 'View site', href: opts.siteUrl } } : {}),
            }),
            text: `${name} v${opts.version} published successfully.${opts.siteUrl ? `\n${opts.siteUrl}` : ''}`,
          }
        : {
            subject: `${name} publish failed (v${opts.version})`,
            html: emailLayout({
              heading: `${escapeHtml(name)} failed to publish`,
              body: `Publishing version <strong>v${opts.version}</strong> of <strong>${escapeHtml(name)}</strong> failed.${opts.error ? ` <br/><span style="color:#b91c1c">${escapeHtml(opts.error)}</span>` : ''}`,
            }),
            text: `${name} v${opts.version} failed to publish.${opts.error ? `\n${opts.error}` : ''}`,
          };
    await Promise.all(
      recipients.map((to) =>
        createJob(QueueNames.EMAIL, { name: 'send-email', data: { to, subject: email.subject, html: email.html, text: email.text } }).catch(
          () => undefined,
        ),
      ),
    );
  } catch {
    // Notifications must never fail a deployment.
  }
}
