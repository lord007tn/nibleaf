export interface TimedActivationEvent {
  createdAt: Date;
  userId: string | null;
}

export interface ActivationTiming {
  /** Number of sign-ups whose first successful manual publish completed within 24 hours. */
  readyWithin24Hours: number;
  /** Median elapsed hours from sign-up to first successful manual publish, among converters. */
  medianHoursToReady: number | null;
}

/**
 * Match each sign-up to the user's first later successful manual publish.
 * Event rows survive account deletion, so null user IDs are deliberately ignored.
 */
export function activationTiming(signups: TimedActivationEvent[], readyEvents: TimedActivationEvent[]): ActivationTiming {
  const signupByUser = new Map<string, number>();
  for (const event of signups) {
    if (!event.userId) {
      continue;
    }
    const timestamp = event.createdAt.getTime();
    const current = signupByUser.get(event.userId);
    if (current === undefined || timestamp < current) {
      signupByUser.set(event.userId, timestamp);
    }
  }

  const firstReadyByUser = new Map<string, number>();
  for (const event of readyEvents) {
    if (!event.userId) {
      continue;
    }
    const signup = signupByUser.get(event.userId);
    const timestamp = event.createdAt.getTime();
    if (signup === undefined || timestamp < signup) {
      continue;
    }
    const current = firstReadyByUser.get(event.userId);
    if (current === undefined || timestamp < current) {
      firstReadyByUser.set(event.userId, timestamp);
    }
  }

  const durations = [...firstReadyByUser].map(([userId, ready]) => ready - (signupByUser.get(userId) ?? ready)).sort((a, b) => a - b);
  if (durations.length === 0) {
    return { medianHoursToReady: null, readyWithin24Hours: 0 };
  }

  const middle = Math.floor(durations.length / 2);
  const medianMs = durations.length % 2 === 0 ? ((durations[middle - 1] ?? 0) + (durations[middle] ?? 0)) / 2 : (durations[middle] ?? 0);
  const medianHoursToReady = Math.round((medianMs / (60 * 60 * 1000)) * 10) / 10;
  const readyWithin24Hours = durations.filter((duration) => duration <= 24 * 60 * 60 * 1000).length;
  return { medianHoursToReady, readyWithin24Hours };
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** A project counts as retained when its second manual publish lands in this range, both ends inclusive. */
export const RETENTION_MIN_HOURS = 24;
export const RETENTION_MAX_HOURS = 168;
/** Below this cohort size a rate says more about individual projects than about the product. */
const MIN_COHORT_FOR_RATE = 5;

export interface PublishRetentionWindows {
  /** Start of the funnel's reporting window; first manual publishes count from here to `now`. */
  firstPublishSince: Date;
  /** Earliest first publish in the retention cohort. */
  cohortSince: Date;
  /** Latest first publish in the retention cohort: the first moment its full window has elapsed. */
  cohortUntil: Date;
}

/**
 * Cohort rule: the funnel's `days` window shifted back by the 168-hour measuring
 * window, so every project in it had its full chance to return and the readout
 * covers as many days as the funnel does: with 30 days, first publishes from 37
 * to 7 days ago, inclusive.
 */
export function publishRetentionWindows(days: number, now: Date): PublishRetentionWindows {
  const cohortUntil = new Date(now.getTime() - RETENTION_MAX_HOURS * HOUR_MS);
  return {
    firstPublishSince: new Date(now.getTime() - days * DAY_MS),
    cohortSince: new Date(cohortUntil.getTime() - days * DAY_MS),
    cohortUntil,
  };
}

export interface PublishRetentionCounts {
  observationStart: Date | null;
  firstManualPublishes: number;
  cohortSize: number;
  retained: number;
}

/** Aggregate publishing-retention readout. `null` always means Unknown, never zero. */
export interface PublishRetention {
  /** Projects whose earliest manual publish falls in the funnel window. */
  firstManualPublishes: number | null;
  /** Projects in the retention cohort (see `publishRetentionWindows`). */
  cohortSize: number | null;
  /** Cohort projects whose second manual publish came 24 to 168 hours after the first. */
  retained: number | null;
  /** `retained / cohortSize` as a 0-1 fraction; null below the minimum cohort size. */
  rate: number | null;
  /** ISO time of the earliest deployment receipt; nothing before it is counted. */
  observationStart: string | null;
  /** ISO time this readout was computed. */
  computedAt: string;
}

/**
 * Turn raw counts into a readout that never reports missing coverage as zero:
 * with no receipts everything is Unknown, and a cohort window that closed before
 * the first receipt was written stays Unknown rather than an empty cohort.
 */
export function publishRetentionReadout(counts: PublishRetentionCounts, windows: PublishRetentionWindows, computedAt: Date): PublishRetention {
  const { observationStart, firstManualPublishes, cohortSize, retained } = counts;
  const unknown = { firstManualPublishes: null, cohortSize: null, retained: null, rate: null };
  if (!observationStart) {
    return { ...unknown, observationStart: null, computedAt: computedAt.toISOString() };
  }
  const base = { firstManualPublishes, observationStart: observationStart.toISOString(), computedAt: computedAt.toISOString() };
  if (observationStart > windows.cohortUntil) {
    return { ...unknown, ...base };
  }
  return { ...base, cohortSize, retained, rate: cohortSize >= MIN_COHORT_FOR_RATE ? retained / cohortSize : null };
}
