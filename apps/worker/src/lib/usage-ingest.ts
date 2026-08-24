import { createJob, QueueNames } from '@nibleaf/bullmq';
import { analyticsIngestJobId, ingestUsageJobDataSchema, usageIngestJobId } from '@nibleaf/bullmq/jobs/analytics';
import type { AnalyticsEventEnvelope } from '@nibleaf/clickhouse';
import { usageEventsFromAnalytics } from '@nibleaf/clickhouse';
import { markAnalyticsStoragePending, markUsageStoragePending, markUsageStorageQueued } from '@nibleaf/database';
import { type UsageEvent, usageEventBatchSchema } from '@nibleaf/usage';

const durableUsageJobOptions = {
  attempts: 8,
  backoff: { type: 'exponential' as const, delay: 1000 },
  removeOnComplete: 10_000,
};

export class DurableUsageEnqueueError extends Error {
  constructor(
    readonly outboxPersisted: boolean,
    cause: unknown,
  ) {
    super('Durable analytics queue enqueue failed.', { cause });
    this.name = 'DurableUsageEnqueueError';
  }
}

export const enqueueUsageEvents = async (events: UsageEvent[]) => {
  const parsed = usageEventBatchSchema.parse(events);
  const first = parsed[0];
  if (!first) throw new Error('Usage ingestion requires at least one event.');
  const jobId = usageIngestJobId(parsed);
  const data = ingestUsageJobDataSchema.parse({ kind: 'ingest-usage', checkpointId: jobId });
  await markUsageStoragePending({ id: jobId, organizationId: first.tenantId, projectId: first.projectId, events: parsed });
  try {
    await createJob(QueueNames.ANALYTICS, { name: 'ingest-usage', data }, { ...durableUsageJobOptions, jobId });
    await markUsageStorageQueued(jobId, first.tenantId);
  } catch (error) {
    throw new DurableUsageEnqueueError(true, error);
  }
  return jobId;
};

export const enqueueAnalyticsEvent = async (envelope: AnalyticsEventEnvelope) => {
  const jobId = analyticsIngestJobId(envelope);
  const usageEvents = usageEventsFromAnalytics(envelope);
  const analyticsMarker = await markAnalyticsStoragePending(envelope.tenantId);
  if (!analyticsMarker.accepted) return jobId;
  if (usageEvents.length > 0) {
    await markUsageStoragePending({ id: jobId, organizationId: envelope.tenantId, projectId: envelope.projectId, events: usageEvents });
  }
  try {
    await createJob(QueueNames.ANALYTICS, { name: 'track-event', data: { kind: 'track-event', envelope } }, { ...durableUsageJobOptions, jobId });
    if (usageEvents.length > 0) await markUsageStorageQueued(jobId, envelope.tenantId);
  } catch (error) {
    throw new DurableUsageEnqueueError(true, error);
  }
  return jobId;
};
