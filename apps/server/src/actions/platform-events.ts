import { type Prisma, prisma } from '@nibleaf/database';
import { activationTiming } from '@/lib/activation-metrics';

/**
 * Platform-level product events (activation funnel), written to `platform_event`.
 * Types in use: `signup_completed` (packages/auth provisionWorkspace),
 * `page_edited` (first content edit per user+project), `publish_clicked`
 * (createDeployment; `metadata.auto` distinguishes the system starter publish),
 * and `publish_ready` / `publish_failed` (worker publish transitions).
 */

export interface PlatformEventInput {
  userId?: string | null;
  projectId?: string | null;
  metadata?: Record<string, unknown>;
}

/** Fire-and-forget platform event. Never throws and never blocks the caller. */
export function logPlatformEvent(type: string, input: PlatformEventInput = {}): void {
  void prisma.platformEvent
    .create({
      data: {
        type,
        userId: input.userId ?? null,
        projectId: input.projectId ?? null,
        ...(input.metadata ? { metadata: input.metadata as Prisma.InputJsonValue } : {}),
      },
    })
    .catch(() => undefined);
}

// The editor autosaves on every pause, so a naive `page_edited` per save would
// explode the table. One event per (user, project) is all the funnel needs; the
// in-process set skips the existence query on repeat saves.
const seenContentEdits = new Set<string>();

/** Record the FIRST content edit a user makes in a project (create or update). */
export function logFirstContentEdit(userId: string, projectId: string): void {
  const key = `${userId}:${projectId}`;
  if (seenContentEdits.has(key)) {
    return;
  }
  seenContentEdits.add(key);
  void (async () => {
    const existing = await prisma.platformEvent.findFirst({
      where: { type: 'page_edited', userId, projectId },
      select: { id: true },
    });
    if (!existing) {
      await prisma.platformEvent.create({ data: { type: 'page_edited', userId, projectId } });
    }
  })().catch(() => undefined);
}

export interface ActivationFunnel {
  days: number;
  /** Accounts that completed sign-up provisioning. */
  signups: number;
  /** Distinct users who made at least one content edit. */
  edited: number;
  /** Distinct users who clicked Publish themselves (system auto-publishes excluded). */
  published: number;
  /** Distinct users with at least one user-initiated publish that went READY. */
  ready: number;
  /** Number of sign-ups whose first user-initiated READY publish completed within 24 hours. */
  readyWithin24Hours: number;
  /** Median sign-up -> first user-initiated READY publish in hours, among converters. */
  medianHoursToReady: number | null;
}

/** Activation funnel counts for the admin overview (last `days` days). All four
 *  queries hit the (type, createdAt) index. `publish_clicked`/`publish_ready`
 *  rows always carry `metadata.auto`, so a positive `equals: false` filter
 *  excludes the per-signup starter publish without SQL null traps. */
export async function getActivationFunnel(days = 30): Promise<ActivationFunnel> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const distinctUsers = (type: string, userPublishOnly: boolean) =>
    prisma.platformEvent.findMany({
      where: {
        type,
        createdAt: { gte: since },
        userId: { not: null },
        ...(userPublishOnly ? { metadata: { path: ['auto'], equals: false } } : {}),
      },
      distinct: ['userId'],
      select: { userId: true },
    });
  const [signups, edited, published, ready, signupEvents, readyEvents] = await Promise.all([
    prisma.platformEvent.count({ where: { type: 'signup_completed', createdAt: { gte: since } } }),
    distinctUsers('page_edited', false),
    distinctUsers('publish_clicked', true),
    distinctUsers('publish_ready', true),
    prisma.platformEvent.findMany({
      where: { type: 'signup_completed', createdAt: { gte: since }, userId: { not: null } },
      select: { userId: true, createdAt: true },
    }),
    prisma.platformEvent.findMany({
      where: { type: 'publish_ready', createdAt: { gte: since }, userId: { not: null }, metadata: { path: ['auto'], equals: false } },
      select: { userId: true, createdAt: true },
    }),
  ]);
  return { days, signups, edited: edited.length, published: published.length, ready: ready.length, ...activationTiming(signupEvents, readyEvents) };
}
