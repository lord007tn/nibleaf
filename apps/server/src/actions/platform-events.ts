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

/** Record the FIRST content edit a user makes in a project (create or update). */
export function logFirstContentEdit(userId: string, projectId: string): void {
  void (async () => {
    // Preserve receipts written before deterministic IDs were introduced.
    const existing = await prisma.platformEvent.findFirst({ where: { type: 'page_edited', userId, projectId }, select: { id: true } });
    if (existing) return;
    await prisma.platformEvent.createMany({
      data: { id: `page-edited:${userId}:${projectId}`, type: 'page_edited', userId, projectId },
      skipDuplicates: true,
    });
  })().catch(() => undefined);
}

const FIRST_PUBLISH_SOURCES = ['docker_compose_guide', 'mintlify_introduction', 'rtl_readiness_grader'] as const;
type FirstPublishSource = (typeof FIRST_PUBLISH_SOURCES)[number];
type FirstPublishStage = 'editor_entered' | 'project_entered' | 'publish_ready';

export async function recordFirstPublishStage(input: {
  stage: FirstPublishStage;
  properties: { entry_point: 'organic_content' | 'free_tool'; intent: 'first_publish'; source: FirstPublishSource };
}): Promise<void> {
  await prisma.platformEvent.create({
    data: {
      type: input.stage,
      userId: null,
      projectId: null,
      metadata: input.properties,
    },
  });
}

interface FirstPublishSourceJourney {
  source: FirstPublishSource;
  landingViews: number;
  ctaClicks: number;
  projectEntered: number;
  editorEntered: number;
  ready: number;
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
  /** Consent-gated, source-level event receipts. They never store users or projects. */
  sourceJourneys: FirstPublishSourceJourney[];
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
  const [signups, edited, published, ready, signupEvents, readyEvents, sourceEvents] = await Promise.all([
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
    prisma.platformEvent.findMany({
      where: {
        type: { in: ['first_publish_landing_viewed', 'first_publish_cta_clicked', 'project_entered', 'editor_entered', 'publish_ready'] },
        createdAt: { gte: since },
      },
      select: { type: true, metadata: true },
    }),
  ]);

  const sourceJourneys = FIRST_PUBLISH_SOURCES.map((source) => {
    const attributed = sourceEvents.filter((event) => {
      const metadata = event.metadata as Record<string, unknown> | null;
      return metadata?.source === source;
    });
    return {
      source,
      landingViews: attributed.filter((event) => event.type === 'first_publish_landing_viewed').length,
      ctaClicks: attributed.filter((event) => event.type === 'first_publish_cta_clicked').length,
      projectEntered: attributed.filter((event) => event.type === 'project_entered').length,
      editorEntered: attributed.filter((event) => event.type === 'editor_entered').length,
      ready: attributed.filter((event) => event.type === 'publish_ready').length,
    };
  });

  return {
    days,
    signups,
    edited: edited.length,
    published: published.length,
    ready: ready.length,
    ...activationTiming(signupEvents, readyEvents),
    sourceJourneys,
  };
}
