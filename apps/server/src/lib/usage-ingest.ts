import { createJob, QueueNames } from '@nibleaf/bullmq';
import { analyticsIngestJobId } from '@nibleaf/bullmq/jobs/analytics';
import { type AnalyticsEventEnvelope, keys as clickHouseKeys, clickHouseWritesEnabled, usageEventsFromAnalytics } from '@nibleaf/clickhouse';
import { markAnalyticsStoragePending, markUsageStoragePending, markUsageStorageQueued } from '@nibleaf/database';

const TRACK_ENQUEUE_TIMEOUT_MS = 1500;

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`enqueue timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

/** Persist the content-free billing outbox before attempting Redis. Definite
 * failures and timeout/unknown outcomes remain recoverable by the scheduled
 * analytics dispatcher using the same tenant-scoped job id. */
export const enqueueAnalyticsEvent = async (envelope: AnalyticsEventEnvelope, timeoutMs = TRACK_ENQUEUE_TIMEOUT_MS) => {
  const jobId = analyticsIngestJobId(envelope);
  const usageEvents = clickHouseWritesEnabled(clickHouseKeys().ANALYTICS_MODE) ? usageEventsFromAnalytics(envelope) : [];
  if (clickHouseWritesEnabled(clickHouseKeys().ANALYTICS_MODE)) {
    const analyticsMarker = await markAnalyticsStoragePending(envelope.tenantId);
    if (!analyticsMarker.accepted) return { jobId, usageCheckpointed: false };
  }
  if (usageEvents.length > 0) {
    await markUsageStoragePending({ id: jobId, organizationId: envelope.tenantId, projectId: envelope.projectId, events: usageEvents });
  }
  await withTimeout(
    createJob(
      QueueNames.ANALYTICS,
      { name: 'track-event', data: { kind: 'track-event', envelope } },
      { jobId, attempts: 8, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: 10_000 },
    ),
    timeoutMs,
  );
  if (usageEvents.length > 0) await markUsageStorageQueued(jobId, envelope.tenantId);
  return { jobId, usageCheckpointed: usageEvents.length > 0 };
};
