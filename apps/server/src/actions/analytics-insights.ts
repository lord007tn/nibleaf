import {
  queryAiVisibilityInsights,
  queryFeedbackInsights,
  queryOverviewInsights,
  queryPageDetailInsights,
  queryPagesInsights,
  queryPerformanceInsights,
  querySearchInsights,
  resolveInsightsMeta,
  type SearchTermsVisibility,
  withInsightsCache,
} from '@nibleaf/clickhouse';
import { prisma } from '@nibleaf/database';
import type { AnalyticsInsightsQuery, ProjectConfig } from '@nibleaf/validators';
import { assertProjectInOrg } from './projects';

const scope = async (organizationId: string, projectId: string, query: AnalyticsInsightsQuery) => {
  const project = await assertProjectInOrg(organizationId, projectId);
  const config = project.config as ProjectConfig | null;
  const visibility: SearchTermsVisibility =
    project.accessMode !== 'PUBLIC' || config?.visibility === 'private'
      ? 'private_site'
      : config?.analytics?.storePublicSearchTerms === true
        ? 'visible'
        : 'disabled_by_setting';
  // Titles belong to the latest immutable published snapshot in Postgres, never
  // an author's unpublished draft or a client-supplied title.
  const published = await prisma.deployment.findFirst({
    where: { projectId: project.id, status: 'READY' },
    orderBy: { version: 'desc' },
    select: { snapshot: true },
  });
  const snapshot = published?.snapshot as { pages?: Array<{ path?: string; title?: string }> } | null;
  const titles = new Map<string, string>();
  for (const page of snapshot?.pages ?? [])
    if (typeof page.path === 'string' && typeof page.title === 'string') titles.set(page.path.replace(/^\//u, ''), page.title);
  return { tenantId: project.organizationId, projectId: project.id, meta: resolveInsightsMeta(query), visibility, titles };
};

export const getOverviewInsights = async (organizationId: string, projectId: string, query: AnalyticsInsightsQuery) =>
  withInsightsCache(await scope(organizationId, projectId, query), JSON.stringify(['Overview', query]), queryOverviewInsights);
export const getPagesInsights = async (organizationId: string, projectId: string, query: AnalyticsInsightsQuery) =>
  withInsightsCache(await scope(organizationId, projectId, query), JSON.stringify(['Pages', query]), queryPagesInsights);
export const getPageDetailInsights = async (organizationId: string, projectId: string, query: AnalyticsInsightsQuery & { path: string }) =>
  withInsightsCache(await scope(organizationId, projectId, query), JSON.stringify(['PageDetail', query]), (input) =>
    queryPageDetailInsights(input, query.path),
  );
export const getSearchInsights = async (organizationId: string, projectId: string, query: AnalyticsInsightsQuery) =>
  withInsightsCache(await scope(organizationId, projectId, query), JSON.stringify(['Search', query]), querySearchInsights);
export const getFeedbackInsights = async (organizationId: string, projectId: string, query: AnalyticsInsightsQuery) =>
  withInsightsCache(await scope(organizationId, projectId, query), JSON.stringify(['Feedback', query]), queryFeedbackInsights);
export const getAiVisibilityInsights = async (organizationId: string, projectId: string, query: AnalyticsInsightsQuery) =>
  withInsightsCache(await scope(organizationId, projectId, query), JSON.stringify(['AiVisibility', query]), queryAiVisibilityInsights);
export const getPerformanceInsights = async (organizationId: string, projectId: string, query: AnalyticsInsightsQuery) =>
  withInsightsCache(await scope(organizationId, projectId, query), JSON.stringify(['Performance', query]), queryPerformanceInsights);
