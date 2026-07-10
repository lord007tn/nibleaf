import type { AnalyticsJobData, AnalyticsJobName, TrackAnalyticsEventJobData } from '@nibleaf/bullmq/jobs/analytics';
import { prisma } from '@nibleaf/database';
import { createLogger } from '@nibleaf/logger';
import type { Job } from 'bullmq';

const log = createLogger({ processor: 'analytics' });

const RETENTION_DAYS = 180;

/** Insert one deferred public analytics event, preserving its original time. */
async function insertTrackedEvent(data: TrackAnalyticsEventJobData): Promise<{ inserted: number }> {
  const createdAt = new Date(data.createdAt);
  await prisma.analyticsEvent.create({
    data: {
      projectId: data.projectId,
      type: data.type,
      path: data.path,
      referrer: data.referrer,
      query: data.query,
      sessionId: data.sessionId,
      country: data.country,
      device: data.device,
      language: data.language,
      // Guard against a malformed timestamp — fall back to the DB default (now).
      ...(Number.isNaN(createdAt.getTime()) ? {} : { createdAt }),
    },
  });
  return { inserted: 1 };
}

/** Daily housekeeping: prune analytics events past the retention window. */
async function pruneOldEvents(): Promise<{ pruned: number }> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = await prisma.analyticsEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
  log.info({ pruned: result.count, cutoff }, 'analytics rollup complete');
  return { pruned: result.count };
}

/** Rollup jobs carry an empty payload, so `kind` is the discriminator (TS can't
 *  narrow `Record<string, never>` with `in`, hence the explicit guard). */
const isTrackEvent = (data: AnalyticsJobData): data is TrackAnalyticsEventJobData => (data as { kind?: string }).kind === 'track-event';

/** ANALYTICS queue processor: high-volume event inserts (off the API hot path)
 *  plus the daily retention prune. */
export async function handleAnalyticsJobs(job: Job<AnalyticsJobData, unknown, AnalyticsJobName>): Promise<{ inserted: number } | { pruned: number }> {
  if (isTrackEvent(job.data)) {
    return insertTrackedEvent(job.data);
  }
  return pruneOldEvents();
}
