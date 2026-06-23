import { prisma } from '@plume/database';
import type { AnalyticsRange, TrackEventBody } from '@plume/validators';
import { assertProjectInOrg } from './projects';

const RANGE_DAYS: Record<AnalyticsRange, number> = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 };

const rangeStart = (range: AnalyticsRange): Date => new Date(Date.now() - RANGE_DAYS[range] * 24 * 60 * 60 * 1000);

const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

export const getAnalyticsOverview = async (organizationId: string, projectId: string, range: AnalyticsRange) => {
  await assertProjectInOrg(organizationId, projectId);
  const since = rangeStart(range);

  const [totalViews, sessionGroups, topPages, topSearches, referrerGroups, events] = await Promise.all([
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
    range,
    totalViews,
    uniqueVisitors: sessionGroups.length,
    timeseries: Array.from(buckets, ([date, views]) => ({ date, views })),
    topPages: topPages.map((p) => ({ path: p.path ?? '', views: p._count._all })),
    topSearches: topSearches.map((s) => ({ query: s.query ?? '', count: s._count._all })),
    referrers: referrerGroups.map((r) => ({ referrer: r.referrer ?? '', views: r._count._all })),
  };
};

/** Aggregate analytics across every project in an organization. */
export const getWorkspaceAnalytics = async (organizationId: string, range: AnalyticsRange) => {
  const since = rangeStart(range);
  const projects = await prisma.project.findMany({ where: { organizationId }, select: { id: true, name: true, color: true } });
  const projectIds = projects.map((p) => p.id);
  const nameById = new Map(projects.map((p) => [p.id, p.name]));
  const colorById = new Map(projects.map((p) => [p.id, p.color]));

  if (projectIds.length === 0) {
    return {
      range,
      totalViews: 0,
      uniqueVisitors: 0,
      timeseries: Array.from(buildEmptyBuckets(range), ([date, views]) => ({ date, views })),
      byProject: [] as Array<{ projectId: string; name: string; color: string; views: number }>,
      topPages: [] as Array<{ path: string; project: string; views: number }>,
      referrers: [] as Array<{ referrer: string; views: number }>,
      devices: [] as Array<{ device: string; count: number }>,
      searches: { total: 0, topTerms: [] as Array<{ query: string; count: number }> },
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
    range,
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
  };
};

/** Build a zeroed per-day bucket map covering the range, oldest → newest. */
const buildEmptyBuckets = (range: AnalyticsRange): Map<string, number> => {
  const buckets = new Map<string, number>();
  for (let i = RANGE_DAYS[range] - 1; i >= 0; i -= 1) {
    buckets.set(dayKey(new Date(Date.now() - i * 24 * 60 * 60 * 1000)), 0);
  }
  return buckets;
};

/** Record a public analytics event (pageview or search) for a project. */
export const trackEvent = (projectId: string, body: TrackEventBody, country?: string) =>
  prisma.analyticsEvent.create({
    data: {
      projectId,
      type: body.type,
      path: body.path ?? null,
      referrer: body.referrer ?? null,
      query: body.query ?? null,
      sessionId: body.sessionId ?? null,
      country: country ?? null,
    },
  });
