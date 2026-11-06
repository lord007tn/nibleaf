import type { JobsOptions } from 'bullmq';

/** A day of fixed retries (rather than eight exponential retries ending after
 * ~2 minutes). Failed facts are retained for the scheduled replay dispatcher. */
export const analyticsEventJobOptions = {
  attempts: 2880,
  backoff: { type: 'fixed', delay: 30_000 },
  removeOnFail: false,
  removeOnComplete: { age: 86_400, count: 100_000 },
} satisfies JobsOptions;

/** Only optional telemetry is shed. Page views, searches, clicks, feedback and
 * usage receipts remain admitted at every backlog size. */
export const shouldShedAnalyticsEvent = (eventName: string, backlog: number): boolean => {
  if (eventName === 'crawler_request') return backlog >= 10_000;
  if (eventName === 'web_vitals') return backlog >= 50_000;
  if (eventName === 'page_engaged') return backlog >= 100_000;
  return false;
};
