import { createJob, getJob, QueueNames } from '@nibleaf/bullmq';
import {
  type AnalyticsJobData,
  type AnalyticsJobName,
  analyticsIngestJobId,
  ingestUsageJobDataSchema,
  type LegacyTrackAnalyticsEventJobData,
  type TrackAnalyticsEventJobData,
} from '@nibleaf/bullmq/jobs/analytics';
import {
  type AnalyticsEventEnvelope,
  keys as clickHouseKeys,
  clickHouseWritesEnabled,
  insertAnalyticsEvents,
  insertUsageEvents,
  listPendingUsagePeriods,
  reconcileUsageHourly,
  relationalWritesEnabled,
  usageEventsFromAnalytics,
} from '@nibleaf/clickhouse';
import {
  markAnalyticsStoragePending,
  markUsageStorageDrained,
  markUsageStoragePending,
  markUsageStorageQueued,
  prisma,
  runWithTenantAnalyticsWriteFence,
} from '@nibleaf/database';
import { createLogger } from '@nibleaf/logger';
import { isLateUsageEvent, type UsageEvent, usageEventBatchSchema, utcBillingPeriod } from '@nibleaf/usage';
import type { Job } from 'bullmq';
import { z } from 'zod';
import { legacyAnalyticsJobToEnvelope } from '../analytics/legacy-job';

const log = createLogger({ processor: 'analytics' });

const RETENTION_DAYS = 180;
const USAGE_CHECKPOINT_RETENTION_DAYS = 1;

/** Insert one deferred public analytics event, preserving its original time. */
const ensureUsageProject = async (tenantId: string, projectId: string) => {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { organizationId: true } });
  if (!project) return false;
  if (project.organizationId !== tenantId) throw new Error('Usage ingestion tenant scope is invalid.');
  return true;
};

const reconcileLateUsage = async (usageEvents: UsageEvent[]) => {
  for (const usageEvent of usageEvents.filter((item) => isLateUsageEvent(item))) {
    const period = utcBillingPeriod(usageEvent.occurredAt);
    await reconcileUsageHourly(usageEvent.tenantId, usageEvent.projectId, period.start, period.endExclusive);
  }
};

async function insertTrackedEvent(event: AnalyticsEventEnvelope, checkpointId: string): Promise<{ inserted: number }> {
  const config = clickHouseKeys();
  if (relationalWritesEnabled(config.ANALYTICS_MODE)) {
    const payload = event.payload;
    const type =
      payload.name === 'page_view'
        ? 'pageview'
        : payload.name === 'feedback_submitted'
          ? 'feedback'
          : payload.name === 'search_query_submitted'
            ? 'search'
            : null;
    if (type) {
      const relationalEvent = {
        id: event.eventId,
        projectId: event.projectId,
        type,
        path: 'path' in payload ? (payload.path ?? null) : null,
        referrer: 'referrer' in payload ? (payload.referrer ?? null) : null,
        query: payload.name === 'feedback_submitted' ? payload.feedback : null,
        sessionId: event.sessionHash,
        country: event.country,
        device: event.device,
        language: 'language' in payload ? (payload.language ?? null) : null,
        createdAt: new Date(event.occurredAt),
      };
      await prisma.analyticsEvent.upsert({ where: { id: event.eventId }, create: relationalEvent, update: {} });
    }
  }
  if (clickHouseWritesEnabled(config.ANALYTICS_MODE)) {
    const analyticsMarker = await markAnalyticsStoragePending(event.tenantId);
    if (!analyticsMarker.accepted) return { inserted: 0 };
    const usageEvents = usageEventsFromAnalytics(event);
    if (usageEvents.length > 0) {
      if (!(await ensureUsageProject(event.tenantId, event.projectId))) return { inserted: 0 };
      await markUsageStoragePending({
        id: checkpointId,
        organizationId: event.tenantId,
        projectId: event.projectId,
        events: usageEvents,
      });
    }
    const analyticsWrite = await runWithTenantAnalyticsWriteFence(event.tenantId, event.projectId, usageEvents.length > 0 ? checkpointId : null, () =>
      insertAnalyticsEvents([event]),
    );
    if (!analyticsWrite.accepted) return { inserted: 0 };
    if (usageEvents.length > 0) await insertUsageBatch(checkpointId);
  }
  return { inserted: 1 };
}

const insertUsageBatch = async (checkpointId: string) => {
  if (!clickHouseWritesEnabled(clickHouseKeys().ANALYTICS_MODE)) throw new Error('ClickHouse usage ingestion is disabled.');
  const checkpoint = await prisma.usageIngestCheckpoint.findUnique({
    where: { id: checkpointId },
    select: { events: true, organizationId: true, projectId: true, writtenAt: true },
  });
  if (!checkpoint || checkpoint.writtenAt) return { inserted: 0 };
  const events = usageEventBatchSchema.parse(checkpoint.events);
  const first = events[0];
  if (!first || first.tenantId !== checkpoint.organizationId || first.projectId !== checkpoint.projectId) {
    throw new Error('Usage ingestion checkpoint scope is invalid.');
  }
  if (!(await ensureUsageProject(first.tenantId, first.projectId))) return { inserted: 0 };
  await insertUsageEvents(events);
  await reconcileLateUsage(events);
  await markUsageStorageDrained(checkpointId, first.tenantId);
  return { inserted: events.length };
};

const dispatchPendingUsage = async () => {
  if (!clickHouseWritesEnabled(clickHouseKeys().ANALYTICS_MODE)) return 0;
  const checkpoints = await prisma.usageIngestCheckpoint.findMany({
    where: { writtenAt: null },
    orderBy: { enqueuedAt: 'asc' },
    take: 100,
    select: { id: true, organizationId: true },
  });
  let dispatched = 0;
  for (const checkpoint of checkpoints) {
    const existing = await getJob(QueueNames.ANALYTICS, checkpoint.id);
    if (!existing) {
      await createJob(
        QueueNames.ANALYTICS,
        { name: 'ingest-usage', data: { kind: 'ingest-usage', checkpointId: checkpoint.id } },
        { jobId: checkpoint.id, attempts: 8, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: 10_000 },
      );
    } else if ((await existing.getState()) === 'failed') {
      await existing.retry();
    }
    await markUsageStorageQueued(checkpoint.id, checkpoint.organizationId);
    dispatched += 1;
  }
  return dispatched;
};

/** Daily housekeeping: prune analytics events past the retention window. */
async function pruneOldEvents(): Promise<{ pruned: number }> {
  const mode = clickHouseKeys().ANALYTICS_MODE;
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const checkpointCutoff = new Date(Date.now() - USAGE_CHECKPOINT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const [events, checkpoints] = await Promise.all([
    relationalWritesEnabled(mode) ? prisma.analyticsEvent.deleteMany({ where: { createdAt: { lt: cutoff } } }) : Promise.resolve({ count: 0 }),
    prisma.usageIngestCheckpoint.deleteMany({ where: { writtenAt: { not: null, lt: checkpointCutoff } } }),
  ]);
  log.info({ pruned: events.count, checkpointReceiptsPruned: checkpoints.count, cutoff, checkpointCutoff }, 'analytics rollup complete');
  return { pruned: events.count };
}

async function reconcilePendingUsage(): Promise<{ reconciled: number }> {
  if (!clickHouseWritesEnabled(clickHouseKeys().ANALYTICS_MODE)) return { reconciled: 0 };
  const dispatched = await dispatchPendingUsage();
  const periods = await listPendingUsagePeriods();
  for (const period of periods) {
    await reconcileUsageHourly(period.tenantId, period.projectId, period.periodStart, period.periodEndExclusive);
  }
  if (dispatched > 0) log.info({ dispatched }, 'durable usage outbox dispatched');
  return { reconciled: periods.length };
}

/** Rollup jobs carry an empty payload, so `kind` is the discriminator (TS can't
 *  narrow `Record<string, never>` with `in`, hence the explicit guard). */
type TrackEventJobData = TrackAnalyticsEventJobData | LegacyTrackAnalyticsEventJobData;

const isTrackEvent = (data: AnalyticsJobData): data is TrackEventJobData => (data as { kind?: string }).kind === 'track-event';

const hasEnvelope = (data: AnalyticsJobData): data is TrackAnalyticsEventJobData =>
  isTrackEvent(data) && z.object({ envelope: z.record(z.string(), z.unknown()) }).safeParse(data).success;

const isLegacyTrackEvent = (data: AnalyticsJobData): data is LegacyTrackAnalyticsEventJobData =>
  isTrackEvent(data) && z.object({ projectId: z.string() }).safeParse(data).success;

async function upgradeLegacyEvent(data: LegacyTrackAnalyticsEventJobData, jobId: string): Promise<AnalyticsEventEnvelope | null> {
  const config = clickHouseKeys();
  if (!config.ANALYTICS_HASH_SALT && config.ANALYTICS_MODE !== 'disabled') {
    log.warn({ jobId, projectId: data.projectId }, 'legacy analytics job dropped because ANALYTICS_HASH_SALT is missing');
    return null;
  }
  const project = await prisma.project.findUnique({
    where: { id: data.projectId },
    select: { accessMode: true, config: true, organizationId: true },
  });
  if (!project) {
    log.info({ jobId, projectId: data.projectId }, 'legacy analytics job ignored because project no longer exists');
    return null;
  }
  const projectConfig = project.config as {
    analytics?: { campaignDimensions?: boolean; storePublicSearchTerms?: boolean };
    visibility?: string;
  } | null;
  return legacyAnalyticsJobToEnvelope(data, {
    tenantId: project.organizationId,
    jobId,
    hashSalt: config.ANALYTICS_HASH_SALT ?? 'disabled-relational-mode',
    privacy: {
      visibility: project.accessMode === 'PUBLIC' && projectConfig?.visibility !== 'private' ? 'public' : 'private',
      allowCampaignDimensions: projectConfig?.analytics?.campaignDimensions === true,
      allowRawPublicSearchQueries: projectConfig?.analytics?.storePublicSearchTerms === true,
    },
  });
}

/** ANALYTICS queue processor: high-volume event inserts (off the API hot path)
 *  plus the daily retention prune. */
export async function handleAnalyticsJobs(
  job: Job<AnalyticsJobData, unknown, AnalyticsJobName>,
): Promise<{ inserted: number } | { pruned: number } | { reconciled: number }> {
  if (job.name === 'ingest-usage') {
    const data = ingestUsageJobDataSchema.safeParse(job.data);
    if (!data.success) throw new Error('Usage ingestion job failed contract validation.');
    if (job.id !== data.data.checkpointId) throw new Error('Usage ingestion job id does not match its checkpoint.');
    return insertUsageBatch(data.data.checkpointId);
  }
  if (isTrackEvent(job.data)) {
    if (hasEnvelope(job.data)) return insertTrackedEvent(job.data.envelope, String(job.id ?? analyticsIngestJobId(job.data.envelope)));
    if (isLegacyTrackEvent(job.data)) {
      const checkpointId = String(job.id ?? `${job.data.projectId}:${job.data.createdAt}`);
      const event = await upgradeLegacyEvent(job.data, checkpointId);
      if (event) return insertTrackedEvent(event, checkpointId);
    } else {
      log.warn({ jobId: job.id }, 'malformed analytics tracking job ignored');
    }
    return { inserted: 0 };
  }
  if (job.name === 'reconcile-usage') return reconcilePendingUsage();
  return pruneOldEvents();
}
