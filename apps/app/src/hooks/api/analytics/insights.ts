import type { AnalyticsInsightsQuery } from '@nibleaf/validators';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { getData } from '../client-helpers';
import { analyticsQueryKeys } from './query-keys';

const insights = () => api.app.projects[':projectId'].analytics.insights;

/** Only send the custom bounds with a custom range, so presets share one cache entry. */
const toQuery = (query: AnalyticsInsightsQuery) => ({
  range: query.range,
  timezone: query.timezone,
  compare: query.compare,
  ...(query.range === 'custom' && query.from && query.to ? { from: query.from, to: query.to } : {}),
});

const fetchOverview = async (projectId: string, query: AnalyticsInsightsQuery) =>
  getData(await insights().overview.$get({ param: { projectId }, query: toQuery(query) }), 'analytics overview');
const fetchPages = async (projectId: string, query: AnalyticsInsightsQuery) =>
  getData(await insights().pages.$get({ param: { projectId }, query: toQuery(query) }), 'page analytics');
const fetchPage = async (projectId: string, query: AnalyticsInsightsQuery, path: string) =>
  getData(await insights().page.$get({ param: { projectId }, query: { ...toQuery(query), path } }), 'page analytics');
const fetchSearch = async (projectId: string, query: AnalyticsInsightsQuery) =>
  getData(await insights().search.$get({ param: { projectId }, query: toQuery(query) }), 'search analytics');
const fetchFeedback = async (projectId: string, query: AnalyticsInsightsQuery) =>
  getData(await insights().feedback.$get({ param: { projectId }, query: toQuery(query) }), 'feedback analytics');
const fetchAi = async (projectId: string, query: AnalyticsInsightsQuery) =>
  getData(await insights().ai.$get({ param: { projectId }, query: toQuery(query) }), 'AI visibility analytics');
const fetchPerformance = async (projectId: string, query: AnalyticsInsightsQuery) =>
  getData(await insights().performance.$get({ param: { projectId }, query: toQuery(query) }), 'performance analytics');

export type OverviewInsights = Awaited<ReturnType<typeof fetchOverview>>;
export type PagesInsights = Awaited<ReturnType<typeof fetchPages>>;
export type PageDetailInsights = Awaited<ReturnType<typeof fetchPage>>;
export type SearchInsights = Awaited<ReturnType<typeof fetchSearch>>;
export type FeedbackInsights = Awaited<ReturnType<typeof fetchFeedback>>;
export type AiVisibilityInsights = Awaited<ReturnType<typeof fetchAi>>;
export type PerformanceInsights = Awaited<ReturnType<typeof fetchPerformance>>;
export type InsightsMeta = OverviewInsights['meta'];
export type InsightsAvailability = InsightsMeta['availability'];
export type SeriesPoint = OverviewInsights['pageViewsSeries'][number];
export type SearchTermRow = SearchInsights['topTerms'][number];
export type SearchTermsVisibility = SearchInsights['searchTermsVisibility'];
export type PageRow = PagesInsights['rows'][number];
export type PageAttentionReason = PageRow['attention'][number];
export type TrafficChannel = OverviewInsights['channels'][number]['channel'];
export type WebVitalsSummary = PerformanceInsights['overall'];
export type CrawlerCategory = AiVisibilityInsights['crawlerSeries'][number]['category'];
export type CrawledResource = AiVisibilityInsights['resources'][number]['resource'];
export type AiAssistantSource = AiVisibilityInsights['assistantReferrals'][number]['source'];

/** Aggregates change at most once a minute; keep the previous range on screen while the next one loads. */
const INSIGHTS_STALE_TIME = 60_000;
const shared = { staleTime: INSIGHTS_STALE_TIME, placeholderData: keepPreviousData } as const;

export const useOverviewInsights = (projectId: string, query: AnalyticsInsightsQuery) =>
  useQuery({ ...shared, queryKey: analyticsQueryKeys.insights(projectId, 'overview', query), queryFn: () => fetchOverview(projectId, query) });

export const usePagesInsights = (projectId: string, query: AnalyticsInsightsQuery) =>
  useQuery({ ...shared, queryKey: analyticsQueryKeys.insights(projectId, 'pages', query), queryFn: () => fetchPages(projectId, query) });

export const usePageInsights = (projectId: string, query: AnalyticsInsightsQuery, path: string) =>
  useQuery({
    ...shared,
    queryKey: analyticsQueryKeys.insights(projectId, 'page', query, path),
    queryFn: () => fetchPage(projectId, query, path),
    // Keep the previous range on screen only for the same page: another page's numbers would mislead.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey.at(-1) === path ? previous : undefined),
    enabled: path.length > 0,
  });

export const useSearchInsights = (projectId: string, query: AnalyticsInsightsQuery) =>
  useQuery({ ...shared, queryKey: analyticsQueryKeys.insights(projectId, 'search', query), queryFn: () => fetchSearch(projectId, query) });

export const useFeedbackInsights = (projectId: string, query: AnalyticsInsightsQuery) =>
  useQuery({ ...shared, queryKey: analyticsQueryKeys.insights(projectId, 'feedback', query), queryFn: () => fetchFeedback(projectId, query) });

export const useAiVisibilityInsights = (projectId: string, query: AnalyticsInsightsQuery) =>
  useQuery({ ...shared, queryKey: analyticsQueryKeys.insights(projectId, 'ai', query), queryFn: () => fetchAi(projectId, query) });

export const usePerformanceInsights = (projectId: string, query: AnalyticsInsightsQuery) =>
  useQuery({
    ...shared,
    queryKey: analyticsQueryKeys.insights(projectId, 'performance', query),
    queryFn: () => fetchPerformance(projectId, query),
  });
