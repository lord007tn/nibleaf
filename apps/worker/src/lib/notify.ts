import { createHash } from 'node:crypto';
import { createJob, QueueNames } from '@nibleaf/bullmq';
import { prisma } from '@nibleaf/database';
import { renderDeploymentEmail, resolveEmailLanguage } from '@nibleaf/email';

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

function deploymentNotificationId(opts: { deploymentId: string; projectId: string; outcome: 'ready' | 'failed' }, recipient: string): string {
  return `deployment-${createHash('sha256')
    .update(JSON.stringify([opts.projectId, opts.deploymentId, opts.outcome, recipient]))
    .digest('hex')}`;
}

/** Fan a deployment outcome out as one in-app notification (the dashboard bell)
 *  per org member. Mirrors createNotificationsForOrgMembers in apps/server —
 *  the worker can't import server actions, and the insert is a single createMany. */
async function createDeploymentNotifications(
  organizationId: string,
  opts: { deploymentId: string; projectId: string; projectName: string; version: number; outcome: 'ready' | 'failed'; error?: string },
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
      id: deploymentNotificationId(opts, member.userId),
      userId: member.userId,
      projectId: opts.projectId,
      ...payload,
      href: `/app/projects/${opts.projectId}`,
    })),
    skipDuplicates: true,
  });
}

/** Email a project's org admins/owners about a deployment outcome, when the relevant
 *  notification toggle is enabled. Also drops an in-app notification (the dashboard
 *  bell) for every org member. Attempt both channels, then throw on partial
 *  failure so a READY retry repairs missing deliveries without revoking READY.
 *  Email deduplication lasts only while the BullMQ job is retained; it is not
 *  permanent exactly-once provider delivery. */
export async function notifyDeployment(opts: {
  deploymentId: string;
  projectId: string;
  projectName: string;
  version: number;
  siteUrl?: string;
  outcome: 'ready' | 'failed';
  error?: string;
  locale?: string;
}): Promise<void> {
  const project = await prisma.project.findUnique({ where: { id: opts.projectId }, select: { organizationId: true } });
  if (!project?.organizationId) {
    return;
  }
  const notificationId = opts.outcome === 'ready' ? 'project_deploy' : 'project_deploy_failed';
  const org = await prisma.organization.findUnique({ where: { id: project.organizationId }, select: { metadata: true } });
  if (!notificationEnabled(org?.metadata, notificationId)) {
    return;
  }
  const deliveries: Promise<unknown>[] = [createDeploymentNotifications(project.organizationId, opts)];
  const emailDelivery = async () => {
    const members = await prisma.member.findMany({
      where: { organizationId: project.organizationId, role: { in: ['owner', 'admin'] } },
      select: { user: { select: { email: true } } },
    });
    const recipients = [...new Set(members.map((m) => m.user.email).filter(Boolean))];
    if (recipients.length === 0) {
      return;
    }
    const email = await renderDeploymentEmail({
      error: opts.error,
      outcome: opts.outcome,
      projectName: opts.projectName,
      siteUrl: opts.siteUrl,
      version: opts.version,
      language: resolveEmailLanguage(opts.locale),
    });
    const queued = await Promise.allSettled(
      recipients.map((to) =>
        createJob(
          QueueNames.EMAIL,
          { name: 'send-email', data: { to, subject: email.subject, html: email.html, text: email.text } },
          { jobId: deploymentNotificationId(opts, to) },
        ),
      ),
    );
    if (queued.some((result) => result.status === 'rejected')) throw new Error('Deployment email enqueue incomplete');
  };
  deliveries.push(emailDelivery());
  const results = await Promise.allSettled(deliveries);
  if (results.some((result) => result.status === 'rejected')) throw new Error('Deployment notification delivery incomplete');
}
