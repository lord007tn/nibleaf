export type AnalyticsJobName = 'rollup-analytics' | 'track-event';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type RollupAnalyticsJobData = Record<string, never>;

/** A single public analytics event (pageview / search / feedback), enqueued by
 *  the API hot path and inserted by the worker so request latency never pays
 *  for a DB write. `createdAt` preserves the original event time across the
 *  queue delay. */
export interface TrackAnalyticsEventJobData {
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
  /** ISO timestamp of when the event actually happened. */
  createdAt: string;
}

/** Discriminated union of every job the ANALYTICS queue carries. Rollup jobs
 *  have no payload, so discriminate on the presence of `kind`. */
export type AnalyticsJobData = RollupAnalyticsJobData | TrackAnalyticsEventJobData;
