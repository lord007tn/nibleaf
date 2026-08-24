import type { AnalyticsEventEnvelope } from '@nibleaf/clickhouse';
import { canonicalUsageEventBatch, deterministicUsageEventId, type usageEventBatchSchema } from '@nibleaf/usage';
import { z } from 'zod';

export type AnalyticsJobName = 'ingest-usage' | 'reconcile-usage' | 'rollup-analytics' | 'track-event';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type RollupAnalyticsJobData = Record<string, never>;

/** Versioned analytics envelope produced by current API nodes. */
export interface TrackAnalyticsEventJobData {
  kind: 'track-event';
  envelope: AnalyticsEventEnvelope;
}

/** Pre-ClickHouse queue payload retained for rolling deploys and already
 *  queued jobs. The worker upgrades it with server-derived tenant/privacy
 *  context before either store receives it. */
export interface LegacyTrackAnalyticsEventJobData {
  kind: 'track-event';
  projectId: string;
  type: string;
  path: string | null;
  referrer: string | null;
  query: string | null;
  sessionId: string | null;
  country: string | null;
  device: string | null;
  language: string | null;
  createdAt: string;
}

/** Privacy-safe durable usage payload. Billing jobs never contain document
 * content, prompts, answers, vectors, secrets, IP addresses, or user agents. */
export const ingestUsageJobDataSchema = z.object({ kind: z.literal('ingest-usage'), checkpointId: z.string().trim().min(1).max(128) }).strict();

export type IngestUsageJobData = z.infer<typeof ingestUsageJobDataSchema>;

/** Stable across retries and input order, while remaining content-free. */
export const usageIngestJobId = (events: z.infer<typeof usageEventBatchSchema>) => {
  const parsed = canonicalUsageEventBatch(events);
  const first = parsed[0];
  if (!first) throw new Error('Usage ingestion requires at least one event.');
  const scope = JSON.stringify([first.tenantId, first.projectId, ...parsed.map((event) => event.eventId).sort()]);
  return `usage-${deterministicUsageEventId(scope, 'usage-ingest-job-v1')}`;
};

export const analyticsIngestJobId = (event: Pick<AnalyticsEventEnvelope, 'eventId' | 'projectId' | 'tenantId'>) =>
  `analytics-${deterministicUsageEventId(JSON.stringify([event.tenantId, event.projectId, event.eventId]), 'analytics-ingest-job-v1')}`;

/** Discriminated union of every job the ANALYTICS queue carries. Rollup jobs
 *  have no payload, so discriminate on the presence of `kind`. */
export type AnalyticsJobData = IngestUsageJobData | RollupAnalyticsJobData | TrackAnalyticsEventJobData | LegacyTrackAnalyticsEventJobData;
