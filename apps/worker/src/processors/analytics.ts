import type { RollupAnalyticsJobData } from '@plume/bullmq/jobs/analytics';
import { prisma } from '@plume/database';
import { createLogger } from '@plume/logger';
import type { Job } from 'bullmq';

const log = createLogger({ processor: 'analytics' });

const RETENTION_DAYS = 180;

/** Daily housekeeping: prune analytics events past the retention window. */
export async function handleAnalyticsJobs(_job: Job<RollupAnalyticsJobData>): Promise<{ pruned: number }> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = await prisma.analyticsEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
  log.info({ pruned: result.count, cutoff }, 'analytics rollup complete');
  return { pruned: result.count };
}
