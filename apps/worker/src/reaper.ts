import { createJob, getJob, QueueNames } from '@nibleaf/bullmq';
import type { PublishDeploymentJobData } from '@nibleaf/bullmq/jobs/publish';
import { prisma } from '@nibleaf/database';
import { createLogger } from '@nibleaf/logger';

const log = createLogger({ processor: 'reaper' });

/** A deployment stuck this long in PENDING/BUILDING is considered dead (the
 *  worker likely crashed/restarted mid-build). The publish lock is 10 min. */
const STALE_MINUTES = 15;

/** Flip deployments stranded in PENDING/BUILDING to FAILED so the dashboard
 *  doesn't show a perpetual in-progress publish after a worker crash. */
export async function reapStaleDeployments(staleMinutes = STALE_MINUTES): Promise<number> {
  const cutoff = new Date(Date.now() - staleMinutes * 60_000);
  const { count } = await prisma.deployment.updateMany({
    where: { status: { in: ['PENDING', 'BUILDING'] }, createdAt: { lt: cutoff } },
    data: { status: 'FAILED', completedAt: new Date(), error: `Build did not finish within ${staleMinutes} min (the worker may have restarted).` },
  });
  if (count > 0) {
    log.warn({ count }, 'reaped stale deployments');
  }
  // The canonical publish receipt is written only after indexing is enqueued.
  // READY without that receipt is a durable recovery marker, including after
  // every BullMQ attempt is exhausted. Give normal delivery a minute to finish.
  const deliveryCutoff = new Date(Date.now() - 60_000);
  const recoverySince = new Date(Date.now() - 24 * 60 * 60_000);
  const missing = await prisma.$queryRaw<Array<{ id: string; projectId: string }>>`
    SELECT d.id, d."projectId" FROM deployment d
    WHERE d.status = 'READY' AND d.snapshot IS NOT NULL
      AND d."completedAt" > ${recoverySince} AND d."completedAt" < ${deliveryCutoff}
      AND NOT EXISTS (SELECT 1 FROM deployment newer WHERE newer."projectId" = d."projectId" AND newer.status = 'READY' AND newer.version > d.version)
      AND NOT EXISTS (SELECT 1 FROM platform_event e WHERE e.id = 'publish-ready:' || d.id)
    ORDER BY d."completedAt", d.id LIMIT 50`;
  for (const deployment of missing) {
    try {
      const original = await getJob(QueueNames.PUBLISH, `publish-${deployment.id}`);
      const data: PublishDeploymentJobData = original?.data ?? {
        deploymentId: deployment.id,
        projectId: deployment.projectId,
        auto: true,
      };
      // A fresh bounded time bucket also recovers exhausted recovery jobs. A
      // stable ID within each bucket deduplicates concurrent reaper processes.
      await createJob(
        QueueNames.PUBLISH,
        { name: 'publish-deployment', data },
        {
          jobId: `publish-recovery-${deployment.id}-${Math.floor(Date.now() / 60_000)}`,
        },
      );
    } catch (error) {
      log.warn({ deploymentId: deployment.id, error }, 'publish delivery recovery will retry');
    }
  }
  return count;
}

/** Run the reaper once on boot, then on an interval. Returns the timer handle. */
export function startDeploymentReaper(intervalMs = 60_000): NodeJS.Timeout {
  const run = () => reapStaleDeployments().catch((error) => log.error({ error }, 'deployment reaper failed'));
  run();
  return setInterval(run, intervalMs);
}
