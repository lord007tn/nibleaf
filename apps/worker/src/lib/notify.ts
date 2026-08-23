import { createJob, QueueNames } from '@nibleaf/bullmq';
import { prisma } from '@nibleaf/database';
import { renderDeploymentEmail } from '@nibleaf/email';

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

/** Fan a deployment outcome out as one in-app notification (the dashboard bell)
 *  per org member. Mirrors createNotificationsForOrgMembers in apps/server —
 *  the worker can't import server actions, and the insert is a single createMany. */
async function createDeploymentNotifications(
  organizationId: string,
  opts: { projectId: string; projectName: string; version: number; outcome: 'ready' | 'failed'; error?: string },
): Promise<void> {
  const members = await prisma.member.findMany({ where: { organizationId }, select: { userId: true } });
  if (members.length === 0) {
    return;
  }
  const payload =
    opts.outcome === 'ready'
      ? {
          type: 'deploy_ready',
          title: `${opts.projectName} published`,
          body: `Version v${opts.version} is live.`,
        }
      : {
          type: 'deploy_failed',
          title: `${opts.projectName} publish failed`,
          body: `Version v${opts.version} did not publish.${opts.error ? ` ${opts.error.slice(0, 300)}` : ''}`,
        };
  await prisma.notification.createMany({
    data: members.map((member) => ({
      userId: member.userId,
      projectId: opts.projectId,
      ...payload,
      href: `/app/projects/${opts.projectId}`,
    })),
  });
}

/** Email a project's org admins/owners about a deployment outcome, when the relevant
 *  notification toggle is enabled. Also drops an in-app notification (the dashboard
 *  bell) for every org member. Best-effort — never throws into the publish flow. */
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
    await createDeploymentNotifications(project.organizationId, opts).catch(() => undefined);
    const members = await prisma.member.findMany({
      where: { organizationId: project.organizationId, role: { in: ['owner', 'admin'] } },
      select: { user: { select: { email: true } } },
    });
    const recipients = members.map((m) => m.user.email).filter(Boolean);
    if (recipients.length === 0) {
      return;
    }
    const email = await renderDeploymentEmail({
      error: opts.error,
      outcome: opts.outcome,
      projectName: opts.projectName,
      siteUrl: opts.siteUrl,
      version: opts.version,
    });
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
