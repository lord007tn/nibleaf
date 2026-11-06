import type { AnalyticsInsightsQuery } from '@nibleaf/validators';
import { keepPreviousData, queryOptions, skipToken, useQuery } from '@tanstack/react-query';
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

/*
 * One `queryOptions()` factory per insights endpoint (apps/app/DATA_LOADING.md):
 * the section hooks and the analytics route loaders both build their query
 * from these, so a loader always prefetches the exact entry its section reads.
 * The 30 s default staleTime matches the server's insights cache, so no
 * override here. This module stays light (no i18n or components): route
 * loaders import it.
 */

export const overviewInsightsQueryOptions = (projectId: string, query: AnalyticsInsightsQuery) =>
  queryOptions({ queryKey: analyticsQueryKeys.insights(projectId, 'overview', query), queryFn: () => fetchOverview(projectId, query) });

export const pagesInsightsQueryOptions = (projectId: string, query: AnalyticsInsightsQuery) =>
  queryOptions({ queryKey: analyticsQueryKeys.insights(projectId, 'pages', query), queryFn: () => fetchPages(projectId, query) });

export const pageInsightsQueryOptions = (projectId: string, query: AnalyticsInsightsQuery, path: string) =>
  queryOptions({
    queryKey: analyticsQueryKeys.insights(projectId, 'page', query, path),
    queryFn: path.length > 0 ? () => fetchPage(projectId, query, path) : skipToken,
  });

export const searchInsightsQueryOptions = (projectId: string, query: AnalyticsInsightsQuery) =>
  queryOptions({ queryKey: analyticsQueryKeys.insights(projectId, 'search', query), queryFn: () => fetchSearch(projectId, query) });

export const feedbackInsightsQueryOptions = (projectId: string, query: AnalyticsInsightsQuery) =>
  queryOptions({ queryKey: analyticsQueryKeys.insights(projectId, 'feedback', query), queryFn: () => fetchFeedback(projectId, query) });

export const aiVisibilityInsightsQueryOptions = (projectId: string, query: AnalyticsInsightsQuery) =>
  queryOptions({ queryKey: analyticsQueryKeys.insights(projectId, 'ai', query), queryFn: () => fetchAi(projectId, query) });

export const performanceInsightsQueryOptions = (projectId: string, query: AnalyticsInsightsQuery) =>
  queryOptions({ queryKey: analyticsQueryKeys.insights(projectId, 'performance', query), queryFn: () => fetchPerformance(projectId, query) });

// Filters are a filtered view: keep the previous range on screen while the next one loads.
export const useOverviewInsights = (projectId: string, query: AnalyticsInsightsQuery) =>
  useQuery({ ...overviewInsightsQueryOptions(projectId, query), placeholderData: keepPreviousData });

export const usePagesInsights = (projectId: string, query: AnalyticsInsightsQuery) =>
  useQuery({ ...pagesInsightsQueryOptions(projectId, query), placeholderData: keepPreviousData });

export const usePageInsights = (projectId: string, query: AnalyticsInsightsQuery, path: string) =>
  useQuery({
    ...pageInsightsQueryOptions(projectId, query, path),
    // Keep the previous range on screen only for the same page: another page's numbers would mislead.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey.at(-1) === path ? previous : undefined),
  });

export const useSearchInsights = (projectId: string, query: AnalyticsInsightsQuery) =>
  useQuery({ ...searchInsightsQueryOptions(projectId, query), placeholderData: keepPreviousData });

export const useFeedbackInsights = (projectId: string, query: AnalyticsInsightsQuery) =>
  useQuery({ ...feedbackInsightsQueryOptions(projectId, query), placeholderData: keepPreviousData });

export const useAiVisibilityInsights = (projectId: string, query: AnalyticsInsightsQuery) =>
  useQuery({ ...aiVisibilityInsightsQueryOptions(projectId, query), placeholderData: keepPreviousData });

export const usePerformanceInsights = (projectId: string, query: AnalyticsInsightsQuery) =>
  useQuery({ ...performanceInsightsQueryOptions(projectId, query), placeholderData: keepPreviousData });
