import { prisma } from '@nibleaf/database';
import { TtlCache } from '@/lib/lru';
import { assertProjectInOrg } from './projects';

export interface ProjectUsage {
  /** Renderable pages (kind PAGE) on the default branch, across all languages. */
  pages: number;
  languages: number;
  /** Members of the site's own organization (each site is its own workspace). */
  members: number;
  deployments: {
    /** Deployments started this calendar month (UTC). */
    thisMonth: number;
    /** Version number of the latest READY deployment, or null if never published. */
    latestVersion: number | null;
    lastPublishedAt: string | null;
  };
  traffic: {
    /** Public pageviews collected in the last 30 days. */
    pageviews30d: number;
    /** In-docs search queries in the last 30 days. */
    searches30d: number;
  };
  storage: {
    /** Total bytes of uploaded assets (images, files). */
    bytes: number;
    assets: number;
  };
}

/** Usage numbers are cheap counts but the tab can be polled; 60s of staleness
 *  is fine for meters, so serve from a small in-process TTL cache. */
const USAGE_CACHE_TTL_MS = 60_000;
const cache = new TtlCache<string, ProjectUsage>(500, USAGE_CACHE_TTL_MS);

const startOfCurrentMonthUtc = (): Date => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
};

/** Real per-site usage counters for the Usage settings tab: content size,
 *  team size, publish activity, and collected traffic — all count/aggregate
 *  queries so the endpoint stays cheap. */
export const getProjectUsage = async (organizationId: string, projectId: string): Promise<ProjectUsage> => {
  // Membership/ownership is re-checked on every call; only the counting is cached.
  await assertProjectInOrg(organizationId, projectId);

  const cached = cache.get(projectId);
  if (cached) {
    return cached;
  }

  const monthStart = startOfCurrentMonthUtc();
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [pages, languages, members, deploymentsThisMonth, latestDeployment, pageviews30d, searches30d, assetAggregate] = await Promise.all([
    prisma.page.count({ where: { projectId, kind: 'PAGE', branch: { isDefault: true } } }),
    prisma.language.count({ where: { projectId } }),
    prisma.member.count({ where: { organizationId } }),
    prisma.deployment.count({ where: { projectId, createdAt: { gte: monthStart } } }),
    prisma.deployment.findFirst({
      where: { projectId, status: 'READY' },
      orderBy: { version: 'desc' },
      select: { version: true, completedAt: true, createdAt: true },
    }),
    prisma.analyticsEvent.count({ where: { projectId, type: 'pageview', createdAt: { gte: since30d } } }),
    prisma.analyticsEvent.count({ where: { projectId, type: 'search', createdAt: { gte: since30d } } }),
    prisma.asset.aggregate({ where: { projectId }, _sum: { size: true }, _count: { _all: true } }),
  ]);

  const usage: ProjectUsage = {
    pages,
    languages,
    members,
    deployments: {
      thisMonth: deploymentsThisMonth,
      latestVersion: latestDeployment?.version ?? null,
      lastPublishedAt: (latestDeployment?.completedAt ?? latestDeployment?.createdAt)?.toISOString() ?? null,
    },
    traffic: { pageviews30d, searches30d },
    storage: { bytes: assetAggregate._sum.size ?? 0, assets: assetAggregate._count._all },
  };
  cache.set(projectId, usage);
  return usage;
};
