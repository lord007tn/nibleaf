import {
  type AiVisibilityInsights,
  keys as clickHouseKeys,
  clickHouseReadsEnabled,
  emptyAiVisibilityInsights,
  emptyFeedbackInsights,
  emptyOverviewInsights,
  emptyPageDetailInsights,
  emptyPagesInsights,
  emptyPerformanceInsights,
  emptySearchInsights,
  type FeedbackInsights,
  type InsightsMeta,
  type OverviewInsights,
  type PageDetailInsights,
  type PagesInsights,
  type PerformanceInsights,
  type SearchInsights,
  type SearchTermsVisibility,
} from '@nibleaf/clickhouse';
import type { AnalyticsInsightsQuery, ProjectConfig } from '@nibleaf/validators';
import { assertProjectInOrg } from './projects';

/** Distinct visits that must share a normalized search term before its text is shown. */
export const SEARCH_TERM_VISIBILITY_THRESHOLD = 2;

const PRESET_MS: Record<Exclude<AnalyticsInsightsQuery['range'], 'custom'>, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

/** CONTRACT STUB — replaced by the timezone-correct resolver in the backend track.
 * Presets end now; custom ranges are inclusive local days. */
const resolveMeta = (query: AnalyticsInsightsQuery, availability: InsightsMeta['availability']): InsightsMeta => {
  const now = Date.now();
  const to = query.range === 'custom' && query.to ? Date.parse(query.to) + 86_400_000 : now;
  const from = query.range === 'custom' && query.from ? Date.parse(query.from) : now - PRESET_MS[query.range === 'custom' ? '30d' : query.range];
  const span = to - from;
  return {
    availability,
    timezone: query.timezone,
    current: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
    previous: query.compare === 'previous' ? { from: new Date(from - span).toISOString(), to: new Date(from).toISOString() } : null,
    granularity: query.range === '24h' ? 'hour' : 'day',
    generatedAt: new Date(now).toISOString(),
  };
};

const termsVisibility = (project: { accessMode: string; config: unknown }): SearchTermsVisibility => {
  const config = project.config as ProjectConfig | null;
  if (project.accessMode !== 'PUBLIC' || config?.visibility === 'private') return 'private_site';
  return config?.analytics?.storePublicSearchTerms === true ? 'visible' : 'disabled_by_setting';
};

const scope = async (organizationId: string, projectId: string, query: AnalyticsInsightsQuery) => {
  const project = await assertProjectInOrg(organizationId, projectId);
  const enabled = clickHouseReadsEnabled(clickHouseKeys().ANALYTICS_MODE);
  return { project, meta: resolveMeta(query, enabled ? 'unavailable' : 'not_configured'), visibility: termsVisibility(project) };
};

export const getOverviewInsights = async (organizationId: string, projectId: string, query: AnalyticsInsightsQuery): Promise<OverviewInsights> => {
  const { meta, visibility } = await scope(organizationId, projectId, query);
  return emptyOverviewInsights(meta, visibility);
};

export const getPagesInsights = async (organizationId: string, projectId: string, query: AnalyticsInsightsQuery): Promise<PagesInsights> => {
  const { meta } = await scope(organizationId, projectId, query);
  return emptyPagesInsights(meta);
};

export const getPageDetailInsights = async (
  organizationId: string,
  projectId: string,
  query: AnalyticsInsightsQuery & { path: string },
): Promise<PageDetailInsights> => {
  const { meta, visibility } = await scope(organizationId, projectId, query);
  return emptyPageDetailInsights(meta, query.path, visibility);
};

export const getSearchInsights = async (organizationId: string, projectId: string, query: AnalyticsInsightsQuery): Promise<SearchInsights> => {
  const { meta, visibility } = await scope(organizationId, projectId, query);
  return emptySearchInsights(meta, visibility, SEARCH_TERM_VISIBILITY_THRESHOLD);
};

export const getFeedbackInsights = async (organizationId: string, projectId: string, query: AnalyticsInsightsQuery): Promise<FeedbackInsights> => {
  const { meta } = await scope(organizationId, projectId, query);
  return emptyFeedbackInsights(meta);
};

export const getAiVisibilityInsights = async (
  organizationId: string,
  projectId: string,
  query: AnalyticsInsightsQuery,
): Promise<AiVisibilityInsights> => {
  const { meta } = await scope(organizationId, projectId, query);
  return emptyAiVisibilityInsights(meta);
};

export const getPerformanceInsights = async (
  organizationId: string,
  projectId: string,
  query: AnalyticsInsightsQuery,
): Promise<PerformanceInsights> => {
  const { meta } = await scope(organizationId, projectId, query);
  return emptyPerformanceInsights(meta);
};
