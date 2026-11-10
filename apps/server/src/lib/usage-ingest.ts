import { createJob, getQueue, QueueNames } from '@nibleaf/bullmq';
import { analyticsEventJobOptions, analyticsIngestJobId, shouldShedAnalyticsEvent } from '@nibleaf/bullmq/jobs/analytics';
import { type AnalyticsEventEnvelope, keys as clickHouseKeys, clickHouseWritesEnabled, usageEventsFromAnalytics } from '@nibleaf/clickhouse';
import { markAnalyticsStoragePending, markUsageStoragePending, markUsageStorageQueued } from '@nibleaf/database';
import { createLogger } from '@nibleaf/logger';

const log = createLogger({ module: 'analytics-ingest' });
let shedLogAt = 0;
const shedCounts: Record<string, number> = {};
let backlog = { count: 0, expires: 0 };
let backlogRequest: Promise<number> | undefined;
const queueBacklog = async (): Promise<number> => {
  if (backlog.expires > Date.now()) return backlog.count;
  if (backlogRequest) return backlogRequest;
  backlogRequest = getQueue(QueueNames.ANALYTICS)
    .getJobCounts('wait', 'active', 'delayed', 'prioritized', 'failed')
    .then((counts) => {
      backlog = { count: Object.values(counts).reduce((sum, count) => sum + count, 0), expires: Date.now() + 5000 };
      return backlog.count;
    })
    .finally(() => {
      backlogRequest = undefined;
    });
  return backlogRequest;
};

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
  const eventName = envelope.payload?.name ?? '';
  if (['crawler_request', 'web_vitals', 'page_engaged'].includes(eventName)) {
    const count = await withTimeout(queueBacklog(), Math.min(timeoutMs, 100)).catch(() => 0);
    if (shouldShedAnalyticsEvent(eventName, count)) {
      shedCounts[eventName] = (shedCounts[eventName] ?? 0) + 1;
      if (Date.now() - shedLogAt >= 5000) {
        log.warn({ dropped: { ...shedCounts }, backlog: count }, 'optional analytics events shed before queue admission');
        shedLogAt = Date.now();
        for (const name of Object.keys(shedCounts)) delete shedCounts[name];
      }
      return { jobId, usageCheckpointed: false, shed: true };
    }
  }
  const usageEvents = clickHouseWritesEnabled(clickHouseKeys().ANALYTICS_MODE) ? usageEventsFromAnalytics(envelope) : [];
  if (clickHouseWritesEnabled(clickHouseKeys().ANALYTICS_MODE)) {
    const analyticsMarker = await markAnalyticsStoragePending(envelope.tenantId, envelope.projectId);
    if (!analyticsMarker.accepted) return { jobId, usageCheckpointed: false };
  }
  if (usageEvents.length > 0) {
    await markUsageStoragePending({ id: jobId, partitionId: envelope.tenantId, projectId: envelope.projectId, events: usageEvents });
  }
  await withTimeout(
    createJob(QueueNames.ANALYTICS, { name: 'track-event', data: { kind: 'track-event', envelope } }, { ...analyticsEventJobOptions, jobId }),
    timeoutMs,
  );
  if (usageEvents.length > 0) await markUsageStorageQueued(jobId, envelope.tenantId);
  return { jobId, usageCheckpointed: usageEvents.length > 0 };
};
