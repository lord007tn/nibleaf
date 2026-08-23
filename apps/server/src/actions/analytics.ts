import { createJob, QueueNames } from '@nibleaf/bullmq';
import {
  type AnalyticsEventEnvelope,
  type AnalyticsEventInput,
  type AnalyticsPayload,
  type AnalyticsPrivacyPolicy,
  buildAnalyticsEvent,
  keys as clickHouseKeys,
  clickHouseReadsEnabled,
  clickHouseWritesEnabled,
  exportProjectAnalytics,
  insertAnalyticsEvents,
  type PublicAnalyticsEvent,
  queryProjectAnalytics,
  queryWorkspaceAnalytics,
  relationalWritesEnabled,
} from '@nibleaf/clickhouse';
import { prisma } from '@nibleaf/database';
import { createLogger } from '@nibleaf/logger';
import type { AnalyticsRange, ProjectConfig } from '@nibleaf/validators';
import { assertProjectInOrg } from './projects';

const log = createLogger({ action: 'analytics' });

const RANGE_DAYS: Record<AnalyticsRange, number> = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 };

const rangeStart = (range: AnalyticsRange): Date => new Date(Date.now() - RANGE_DAYS[range] * 24 * 60 * 60 * 1000);

const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

const getRelationalAnalyticsOverview = async (organizationId: string, projectId: string, range: AnalyticsRange, timezone: string) => {
  await assertProjectInOrg(organizationId, projectId);
  const since = rangeStart(range);

  const [totalViews, sessionGroups, topPages, topSearches, referrerGroups, languageGroups, events] = await Promise.all([
    prisma.analyticsEvent.count({ where: { projectId, type: 'pageview', createdAt: { gte: since } } }),
    prisma.analyticsEvent.groupBy({ by: ['sessionId'], where: { projectId, type: 'pageview', createdAt: { gte: since }, sessionId: { not: null } } }),
    prisma.analyticsEvent.groupBy({
      by: ['path'],
      where: { projectId, type: 'pageview', createdAt: { gte: since }, path: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { path: 'desc' } },
      take: 10,
    }),
    prisma.analyticsEvent.groupBy({
      by: ['query'],
      where: { projectId, type: 'search', createdAt: { gte: since }, query: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { query: 'desc' } },
      take: 10,
    }),
    prisma.analyticsEvent.groupBy({
      by: ['referrer'],
      where: { projectId, type: 'pageview', createdAt: { gte: since }, referrer: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { referrer: 'desc' } },
      take: 8,
    }),
    prisma.analyticsEvent.groupBy({
      by: ['language'],
      where: { projectId, type: 'pageview', createdAt: { gte: since }, language: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { language: 'desc' } },
      take: 12,
    }),
    prisma.analyticsEvent.findMany({ where: { projectId, type: 'pageview', createdAt: { gte: since } }, select: { createdAt: true } }),
  ]);

  // Bucket pageviews per day for the chart.
  const buckets = new Map<string, number>();
  for (let i = RANGE_DAYS[range] - 1; i >= 0; i -= 1) {
    buckets.set(dayKey(new Date(Date.now() - i * 24 * 60 * 60 * 1000)), 0);
  }
  for (const event of events) {
    const key = dayKey(event.createdAt);
    if (buckets.has(key)) {
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }

  return {
    availability: 'complete' as const,
    source: 'relational' as const,
    range,
    timezone,
    totalViews,
    uniqueVisitors: sessionGroups.length,
    timeseries: Array.from(buckets, ([date, views]) => ({ date, views })),
    topPages: topPages.map((p) => ({ path: p.path ?? '', views: p._count._all })),
    topSearches: topSearches.map((s) => ({ query: s.query ?? '', count: s._count._all })),
    referrers: referrerGroups.map((r) => ({ referrer: r.referrer ?? '', views: r._count._all })),
    languages: languageGroups.map((l) => ({ language: l.language ?? 'unknown', views: l._count._all })),
    devices: [] as Array<{ device: string; count: number }>,
    engagement: { engagedViews: null, averageEngagementMs: null },
    searches: {
      total: topSearches.reduce((sum, item) => sum + item._count._all, 0),
      zeroResults: null,
      clickedResults: null,
      averageLatencyMs: null,
      queryTerms: 'legacy' as const,
    },
    ai: {
      answersCompleted: null,
      answersFailed: null,
      promptTokens: null,
      completionTokens: null,
      costMicros: null,
      averageLatencyMs: null,
    },
    noAnswerReasons: [] as Array<{ reason: string; count: number }>,
  };
};

/** Aggregate analytics across every site the user can reach — i.e. across all
 *  the organizations they belong to. Each site owns its own org (1:1), so this
 *  is the correct scope for the multi-site "Your sites" overview; scoping to a
 *  single active org would show zeros for anyone with more than one site. */
const getRelationalWorkspaceAnalytics = async (userId: string, range: AnalyticsRange, timezone: string) => {
  const since = rangeStart(range);
  const memberships = await prisma.member.findMany({ where: { userId }, select: { organizationId: true } });
  const organizationIds = memberships.map((m) => m.organizationId);
  const projects = await prisma.project.findMany({
    where: { organizationId: { in: organizationIds } },
    select: { id: true, name: true, config: true },
  });
  const projectIds = projects.map((p) => p.id);
  const nameById = new Map(projects.map((p) => [p.id, p.name]));
  const colorById = new Map(projects.map((project) => [project.id, (project.config as ProjectConfig | null)?.styling?.primaryColor ?? '#5546e8']));

  if (projectIds.length === 0) {
    return {
      availability: 'complete' as const,
      source: 'relational' as const,
      range,
      timezone,
      totalViews: 0,
      uniqueVisitors: 0,
      timeseries: Array.from(buildEmptyBuckets(range), ([date, views]) => ({ date, views })),
      byProject: [] as Array<{ projectId: string; name: string; color: string; views: number }>,
      topPages: [] as Array<{ path: string; project: string; views: number }>,
      referrers: [] as Array<{ referrer: string; views: number }>,
      devices: [] as Array<{ device: string; count: number }>,
      searches: { total: 0, topTerms: [] as Array<{ query: string; count: number }> },
      ai: {
        answersCompleted: null,
        answersFailed: null,
        promptTokens: null,
        completionTokens: null,
        costMicros: null,
        averageLatencyMs: null,
      },
    };
  }

  const [totalViews, sessionGroups, projectGroups, pageGroups, referrerGroups, deviceGroups, searchTotal, searchGroups, events] = await Promise.all([
    prisma.analyticsEvent.count({ where: { projectId: { in: projectIds }, type: 'pageview', createdAt: { gte: since } } }),
    prisma.analyticsEvent.groupBy({
      by: ['sessionId'],
      where: { projectId: { in: projectIds }, type: 'pageview', createdAt: { gte: since }, sessionId: { not: null } },
    }),
    prisma.analyticsEvent.groupBy({
      by: ['projectId'],
      where: { projectId: { in: projectIds }, type: 'pageview', createdAt: { gte: since } },
      _count: { _all: true },
      orderBy: { _count: { projectId: 'desc' } },
    }),
    prisma.analyticsEvent.groupBy({
      by: ['path', 'projectId'],
      where: { projectId: { in: projectIds }, type: 'pageview', createdAt: { gte: since }, path: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { path: 'desc' } },
      take: 10,
    }),
    prisma.analyticsEvent.groupBy({
      by: ['referrer'],
      where: { projectId: { in: projectIds }, type: 'pageview', createdAt: { gte: since }, referrer: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { referrer: 'desc' } },
      take: 8,
    }),
    prisma.analyticsEvent.groupBy({
      by: ['device'],
      where: { projectId: { in: projectIds }, type: 'pageview', createdAt: { gte: since }, device: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { device: 'desc' } },
    }),
    prisma.analyticsEvent.count({ where: { projectId: { in: projectIds }, type: 'search', createdAt: { gte: since } } }),
    prisma.analyticsEvent.groupBy({
      by: ['query'],
      where: { projectId: { in: projectIds }, type: 'search', createdAt: { gte: since }, query: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { query: 'desc' } },
      take: 10,
    }),
    prisma.analyticsEvent.findMany({
      where: { projectId: { in: projectIds }, type: 'pageview', createdAt: { gte: since } },
      select: { createdAt: true },
    }),
  ]);

  const buckets = buildEmptyBuckets(range);
  for (const event of events) {
    const key = dayKey(event.createdAt);
    if (buckets.has(key)) {
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }

  return {
    availability: 'complete' as const,
    source: 'relational' as const,
    range,
    timezone,
    totalViews,
    uniqueVisitors: sessionGroups.length,
    timeseries: Array.from(buckets, ([date, views]) => ({ date, views })),
    byProject: projectGroups.map((g) => ({
      projectId: g.projectId,
      name: nameById.get(g.projectId) ?? 'Unknown',
      color: colorById.get(g.projectId) ?? '#5546e8',
      views: g._count._all,
    })),
    topPages: pageGroups.map((p) => ({ path: p.path ?? '', project: nameById.get(p.projectId) ?? 'Unknown', views: p._count._all })),
    referrers: referrerGroups.map((r) => ({ referrer: r.referrer ?? '', views: r._count._all })),
    devices: deviceGroups.map((d) => ({ device: d.device ?? 'unknown', count: d._count._all })),
    searches: { total: searchTotal, topTerms: searchGroups.map((s) => ({ query: s.query ?? '', count: s._count._all })) },
    ai: {
      answersCompleted: null,
      answersFailed: null,
      promptTokens: null,
      completionTokens: null,
      costMicros: null,
      averageLatencyMs: null,
    },
  };
};

export const getAnalyticsOverview = async (organizationId: string, projectId: string, range: AnalyticsRange, timezone = 'UTC') => {
  const project = await assertProjectInOrg(organizationId, projectId);
  const config = clickHouseKeys();
  if (!clickHouseReadsEnabled(config.ANALYTICS_MODE)) {
    return getRelationalAnalyticsOverview(organizationId, projectId, range, timezone);
  }
  const clickhouse = await queryProjectAnalytics(project.organizationId, projectId, range, timezone);
  if (config.ANALYTICS_MODE === 'clickhouse') return { ...clickhouse, source: 'clickhouse' as const, topSearches: [] };

  const relational = await getRelationalAnalyticsOverview(organizationId, projectId, range, timezone);
  log.info(
    {
      mode: 'shadow_read',
      projectId,
      clickhouseAvailability: clickhouse.availability,
      totalViewsDelta: clickhouse.totalViews === null ? null : clickhouse.totalViews - relational.totalViews,
      uniqueVisitorsDelta: clickhouse.uniqueVisitors === null ? null : clickhouse.uniqueVisitors - relational.uniqueVisitors,
    },
    'analytics read shadow comparison',
  );
  return relational;
};

export const getWorkspaceAnalytics = async (userId: string, range: AnalyticsRange, timezone = 'UTC') => {
  const config = clickHouseKeys();
  if (!clickHouseReadsEnabled(config.ANALYTICS_MODE)) return getRelationalWorkspaceAnalytics(userId, range, timezone);
  const memberships = await prisma.member.findMany({ where: { userId }, select: { organizationId: true } });
  const organizationIds = memberships.map(({ organizationId }) => organizationId);
  const projects = await prisma.project.findMany({
    where: { organizationId: { in: organizationIds } },
    select: { id: true, name: true, organizationId: true, config: true },
  });
  const clickhouse = await queryWorkspaceAnalytics(
    projects.map((project) => ({ tenantId: project.organizationId, projectId: project.id })),
    range,
    timezone,
  );
  const names = new Map(projects.map((project) => [project.id, project.name]));
  const colors = new Map(projects.map((project) => [project.id, (project.config as ProjectConfig | null)?.styling?.primaryColor ?? '#5546e8']));
  const response = {
    ...clickhouse,
    source: 'clickhouse' as const,
    byProject: clickhouse.byProject.map((row) => ({
      ...row,
      name: names.get(row.projectId) ?? 'Unknown',
      color: colors.get(row.projectId) ?? '#5546e8',
    })),
    topPages: clickhouse.topPages.map((row) => ({ ...row, project: names.get(row.projectId) ?? 'Unknown' })),
    searches: { ...clickhouse.searches, topTerms: [] as Array<{ query: string; count: number }> },
  };
  if (config.ANALYTICS_MODE === 'clickhouse') return response;
  const relational = await getRelationalWorkspaceAnalytics(userId, range, timezone);
  log.info(
    {
      mode: 'shadow_read',
      clickhouseAvailability: clickhouse.availability,
      totalViewsDelta: clickhouse.totalViews === null ? null : clickhouse.totalViews - relational.totalViews,
    },
    'workspace analytics read shadow comparison',
  );
  return relational;
};

export const getProjectAnalyticsExport = async (organizationId: string, projectId: string, before?: string, limit?: number) => {
  const project = await assertProjectInOrg(organizationId, projectId);
  return exportProjectAnalytics(project.organizationId, project.id, { before, limit });
};

/** Build a zeroed per-day bucket map covering the range, oldest → newest. */
const buildEmptyBuckets = (range: AnalyticsRange): Map<string, number> => {
  const buckets = new Map<string, number>();
  for (let i = RANGE_DAYS[range] - 1; i >= 0; i -= 1) {
    buckets.set(dayKey(new Date(Date.now() - i * 24 * 60 * 60 * 1000)), 0);
  }
  return buckets;
};

/** How long the hot path waits for the queue before falling back to a direct
 *  insert. BullMQ buffers commands while redis reconnects (they'd otherwise
 *  hang the request), so a stalled enqueue must be treated as a failure. */
const TRACK_ENQUEUE_TIMEOUT_MS = 1500;

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`enqueue timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

/** Record a public analytics event (pageview, search, or feedback) for a project. The
 *  optional `meta` carries request-derived dimensions (device class, country)
 *  so the analytics breakdowns aren't permanently empty.
 *
 *  The insert happens on the ANALYTICS worker queue so page views never pay a
 *  DB write in the request path; if enqueueing fails (redis down / slow), we
 *  fall back to the direct insert so no event is lost. */
const legacyEvent = (envelope: AnalyticsEventEnvelope) => {
  const payload = envelope.payload;
  const type =
    payload.name === 'page_view'
      ? 'pageview'
      : payload.name === 'feedback_submitted'
        ? 'feedback'
        : payload.name === 'search_query_submitted'
          ? 'search'
          : null;
  if (!type) return null;
  return {
    id: envelope.eventId,
    projectId: envelope.projectId,
    type,
    path: 'path' in payload ? (payload.path ?? null) : null,
    referrer: 'referrer' in payload ? (payload.referrer ?? null) : null,
    // ClickHouse migration modes never dual-write raw search text to PostgreSQL.
    query: payload.name === 'feedback_submitted' ? payload.feedback : null,
    sessionId: envelope.sessionHash,
    country: envelope.country,
    device: envelope.device,
    language: 'language' in payload ? (payload.language ?? null) : null,
    createdAt: new Date(envelope.occurredAt),
  };
};

export interface TrackEventContext {
  tenantId: string;
  projectId: string;
  siteId?: string;
  deploymentId?: string;
  source: 'api' | 'backfill' | 'dashboard' | 'public_site' | 'system' | 'worker';
  privacy: AnalyticsPrivacyPolicy;
  country?: string;
  device?: string;
}

/** Queue one server-enriched event. Tenant/project identity never comes from the
 * public body. Queue and ClickHouse failures are deliberately non-fatal to the
 * docs product; relational fallback is retained until the final cutover. */
const trackEvent = async (context: TrackEventContext, body: AnalyticsEventInput): Promise<void> => {
  const config = clickHouseKeys();
  const parsed = body;
  const hashSalt = config.ANALYTICS_HASH_SALT;
  if (!hashSalt && config.ANALYTICS_MODE !== 'disabled') {
    log.warn({ projectId: context.projectId }, 'analytics event dropped because ANALYTICS_HASH_SALT is missing');
    return;
  }
  const envelope = buildAnalyticsEvent(parsed, {
    tenantId: context.tenantId,
    projectId: context.projectId,
    siteId: context.siteId ?? context.projectId,
    deploymentId: context.deploymentId,
    source: context.source,
    country: context.country,
    device: context.device,
    privacy: context.privacy,
    hashSalt: hashSalt ?? 'disabled-relational-mode',
  });
  try {
    await withTimeout(
      createJob(
        QueueNames.ANALYTICS,
        { name: 'track-event', data: { kind: 'track-event', envelope } },
        { jobId: `analytics-${envelope.eventId}`, attempts: 8, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: 10_000 },
      ),
      TRACK_ENQUEUE_TIMEOUT_MS,
    );
  } catch (error) {
    const fallback = legacyEvent(envelope);
    if (relationalWritesEnabled(config.ANALYTICS_MODE) && fallback) {
      await prisma.analyticsEvent.upsert({ where: { id: fallback.id }, create: fallback, update: {} }).catch(() => undefined);
    }
    if (clickHouseWritesEnabled(config.ANALYTICS_MODE)) {
      await insertAnalyticsEvents([envelope], { attempts: 1 }).catch(() => undefined);
    }
    log.warn({ error, eventId: envelope.eventId, projectId: envelope.projectId }, 'analytics enqueue unavailable; fallback attempted');
  }
};

export const trackProjectEvent = async (
  projectId: string,
  payload: AnalyticsPayload,
  options: {
    source?: TrackEventContext['source'];
    consentState?: PublicAnalyticsEvent['consentState'];
    eventId?: string;
    sessionId?: string;
    country?: string;
    device?: string;
  } = {},
): Promise<void> => {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, organizationId: true, accessMode: true, config: true },
  });
  if (!project) return;
  const projectConfig = project.config as ProjectConfig | null;
  const visibility = project.accessMode === 'PUBLIC' && projectConfig?.visibility !== 'private' ? 'public' : 'private';
  await trackEvent(
    {
      tenantId: project.organizationId,
      projectId: project.id,
      source: options.source ?? 'system',
      country: options.country,
      device: options.device,
      privacy: {
        visibility,
        allowCampaignDimensions: projectConfig?.analytics?.campaignDimensions === true,
        allowRawPublicSearchQueries: projectConfig?.analytics?.storePublicSearchTerms === true,
      },
    },
    {
      ...(options.eventId ? { eventId: options.eventId } : {}),
      consentState: options.consentState ?? 'not_required',
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      payload,
    },
  );
};
