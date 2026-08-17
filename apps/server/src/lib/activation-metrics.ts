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
