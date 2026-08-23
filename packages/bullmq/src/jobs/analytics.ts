export type AnalyticsJobName = 'rollup-analytics' | 'track-event';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type RollupAnalyticsJobData = Record<string, never>;

import type { AnalyticsEventEnvelope } from '@nibleaf/clickhouse';

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

/** Discriminated union of every job the ANALYTICS queue carries. Rollup jobs
 *  have no payload, so discriminate on the presence of `kind`. */
export type AnalyticsJobData = RollupAnalyticsJobData | TrackAnalyticsEventJobData | LegacyTrackAnalyticsEventJobData;
