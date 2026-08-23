import type {
  AnalyticsJobData,
  AnalyticsJobName,
  LegacyTrackAnalyticsEventJobData,
  TrackAnalyticsEventJobData,
} from '@nibleaf/bullmq/jobs/analytics';
import {
  type AnalyticsEventEnvelope,
  keys as clickHouseKeys,
  clickHouseWritesEnabled,
  insertAnalyticsEvents,
  relationalWritesEnabled,
} from '@nibleaf/clickhouse';
import { prisma } from '@nibleaf/database';
import { createLogger } from '@nibleaf/logger';
import type { Job } from 'bullmq';
import { legacyAnalyticsJobToEnvelope } from '../analytics/legacy-job';

const log = createLogger({ processor: 'analytics' });

const RETENTION_DAYS = 180;

/** Insert one deferred public analytics event, preserving its original time. */
async function insertTrackedEvent(event: AnalyticsEventEnvelope): Promise<{ inserted: number }> {
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
  if (clickHouseWritesEnabled(config.ANALYTICS_MODE)) await insertAnalyticsEvents([event]);
  return { inserted: 1 };
}

/** Daily housekeeping: prune analytics events past the retention window. */
async function pruneOldEvents(): Promise<{ pruned: number }> {
  if (!relationalWritesEnabled(clickHouseKeys().ANALYTICS_MODE)) return { pruned: 0 };
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = await prisma.analyticsEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
  log.info({ pruned: result.count, cutoff }, 'analytics rollup complete');
  return { pruned: result.count };
}

/** Rollup jobs carry an empty payload, so `kind` is the discriminator (TS can't
 *  narrow `Record<string, never>` with `in`, hence the explicit guard). */
type TrackEventJobData = TrackAnalyticsEventJobData | LegacyTrackAnalyticsEventJobData;

const isTrackEvent = (data: AnalyticsJobData): data is TrackEventJobData => (data as { kind?: string }).kind === 'track-event';

const hasEnvelope = (data: AnalyticsJobData): data is TrackAnalyticsEventJobData =>
  isTrackEvent(data) && typeof (data as { envelope?: unknown }).envelope === 'object' && (data as { envelope?: unknown }).envelope !== null;

const isLegacyTrackEvent = (data: AnalyticsJobData): data is LegacyTrackAnalyticsEventJobData =>
  isTrackEvent(data) && typeof (data as { projectId?: unknown }).projectId === 'string';

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
export async function handleAnalyticsJobs(job: Job<AnalyticsJobData, unknown, AnalyticsJobName>): Promise<{ inserted: number } | { pruned: number }> {
  if (isTrackEvent(job.data)) {
    if (hasEnvelope(job.data)) return insertTrackedEvent(job.data.envelope);
    if (isLegacyTrackEvent(job.data)) {
      const event = await upgradeLegacyEvent(job.data, String(job.id ?? `${job.data.projectId}:${job.data.createdAt}`));
      if (event) return insertTrackedEvent(event);
    } else {
      log.warn({ jobId: job.id }, 'malformed analytics tracking job ignored');
    }
    return { inserted: 0 };
  }
  return pruneOldEvents();
}
