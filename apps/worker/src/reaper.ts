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
    data: { status: 'FAILED', error: `Build did not finish within ${staleMinutes} min (the worker may have restarted).` },
  });
  if (count > 0) {
    log.warn({ count }, 'reaped stale deployments');
  }
  return count;
}

/** Run the reaper once on boot, then on an interval. Returns the timer handle. */
export function startDeploymentReaper(intervalMs = 60_000): NodeJS.Timeout {
  const run = () => reapStaleDeployments().catch((error) => log.error({ error }, 'deployment reaper failed'));
  run();
  return setInterval(run, intervalMs);
}
