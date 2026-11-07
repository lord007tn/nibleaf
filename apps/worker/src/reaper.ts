import { createJob, getJob, QueueNames } from '@nibleaf/bullmq';
import type { PublishDeploymentJobData } from '@nibleaf/bullmq/jobs/publish';
import { type Prisma, prisma } from '@nibleaf/database';
import { createLogger } from '@nibleaf/logger';
import { notifyDeployment } from './lib/notify';

const log = createLogger({ processor: 'reaper' });

/** A deployment stuck this long in PENDING/BUILDING is considered dead (the
 *  worker likely crashed/restarted mid-build). The publish lock is 10 min. */
const STALE_MINUTES = 15;

/** Flip stranded builds and abandoned automatic retries to terminal failures so the dashboard
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
  const abandoned = await prisma.deployment.findMany({
    where: { status: 'FAILED', completedAt: null, createdAt: { lt: cutoff } },
    select: { id: true, projectId: true, version: true, error: true, project: { select: { name: true } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 50,
  });
  let finalized = 0;
  for (const deployment of abandoned) {
    // Compete with the worker's retry claim and other reapers. A completed
    // failure cannot be claimed by a delayed job that resurfaces later.
    const result = await prisma.deployment.updateMany({
      where: { id: deployment.id, status: 'FAILED', completedAt: null, createdAt: { lt: cutoff } },
      data: { completedAt: new Date() },
    });
    if (!result.count) continue;
    finalized += result.count;
    try {
      await notifyDeployment({
        deploymentId: deployment.id,
        projectId: deployment.projectId,
        projectName: deployment.project.name,
        version: deployment.version,
        outcome: 'failed',
        error: deployment.error ?? undefined,
      });
    } catch (error) {
      log.warn({ deploymentId: deployment.id, error }, 'abandoned retry finalized but failure notification failed');
    }
  }
  // The canonical publish receipt is written only after indexing is enqueued.
  // READY without that receipt is a durable recovery marker, including after
  // every BullMQ attempt is exhausted. Give normal delivery a minute to finish.
  const missing = await findRecoverableDeployments();
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
  return count + finalized;
}

/** Only recover recent, undelivered snapshots that are still the live version. */
export function findRecoverableDeployments(db: Pick<Prisma.TransactionClient, '$queryRaw'> = prisma, now = new Date()) {
  const deliveryCutoff = new Date(now.getTime() - 60_000);
  const recoverySince = new Date(now.getTime() - 24 * 60 * 60_000);
  return db.$queryRaw<Array<{ id: string; projectId: string }>>`
    SELECT d.id, d."projectId" FROM deployment d
    WHERE d.status = 'READY' AND d.snapshot IS NOT NULL
      AND d."completedAt" > ${recoverySince} AND d."completedAt" < ${deliveryCutoff}
      AND NOT EXISTS (SELECT 1 FROM deployment newer WHERE newer."projectId" = d."projectId" AND newer.status = 'READY' AND newer.version > d.version)
      AND NOT EXISTS (SELECT 1 FROM platform_event e WHERE e.id = 'publish-ready:' || d.id)
    ORDER BY d."completedAt", d.id LIMIT 50`;
}

/** Run the reaper once on boot, then on an interval. Returns the timer handle. */
export function startDeploymentReaper(intervalMs = 60_000): NodeJS.Timeout {
  const run = () => reapStaleDeployments().catch((error) => log.error({ error }, 'deployment reaper failed'));
  run();
  return setInterval(run, intervalMs);
}
