import type {
  AiVisibilityInsights,
  Compared,
  FeedbackInsights,
  InsightsMeta,
  OverviewInsights,
  PageDetailInsights,
  PagesInsights,
  PerformanceInsights,
  SearchInsights,
  SearchTermsVisibility,
  WebVitalsSummary,
} from './types';

/** Shapes returned when ClickHouse is unavailable or not configured. Every
 * metric is `null` ("unknown"), never zero, so the dashboard can say so. */
const unknown: Compared = { value: null, previous: null };

export const emptyWebVitals = (): WebVitalsSummary => ({
  samples: 0,
  lcpP75Ms: null,
  inpP75Ms: null,
  clsP75: null,
  fcpP75Ms: null,
  ttfbP75Ms: null,
  rating: null,
});

export const emptyOverviewInsights = (meta: InsightsMeta, searchTermsVisibility: SearchTermsVisibility): OverviewInsights => ({
  meta,
  kpis: {
    pageViews: unknown,
    visits: unknown,
    avgEngagedMs: unknown,
    avgScrollDepth: unknown,
    searches: unknown,
    searchSuccessRate: unknown,
    zeroResultRate: unknown,
    helpfulRate: unknown,
    aiAssistantVisits: unknown,
    aiCrawlerRequests: unknown,
  },
  pageViewsSeries: [],
  previousPageViewsSeries: [],
  topPages: [],
  pagesNeedingWork: [],
  failedSearches: [],
  searchTermsVisibility,
  channels: [],
  feedback: { helpful: 0, notHelpful: 0 },
});

export const emptyPagesInsights = (meta: InsightsMeta): PagesInsights => ({ meta, rows: [], truncated: false });

export const emptyPageDetailInsights = (meta: InsightsMeta, path: string, searchTermsVisibility: SearchTermsVisibility): PageDetailInsights => ({
  meta,
  path,
  title: null,
  kpis: { views: unknown, visits: unknown, avgEngagedMs: unknown, avgScrollDepth: unknown, exitRate: unknown, helpfulRate: unknown },
  viewsSeries: [],
  previousViewsSeries: [],
  feedback: { helpful: 0, notHelpful: 0, series: [] },
  channels: [],
  referrers: [],
  searchesLeadingHere: [],
  searchTermsVisibility,
  nextPages: [],
  previousPages: [],
  devices: [],
  languages: [],
  webVitals: emptyWebVitals(),
  aiCrawlers: [],
});

export const emptySearchInsights = (
  meta: InsightsMeta,
  searchTermsVisibility: SearchTermsVisibility,
  termVisibilityThreshold: number,
): SearchInsights => ({
  meta,
  searchTermsVisibility,
  termVisibilityThreshold,
  kpis: {
    searches: unknown,
    searchVisits: unknown,
    zeroResultRate: unknown,
    clickThroughRate: unknown,
    refinementRate: unknown,
    averageClickPosition: unknown,
  },
  searchesSeries: [],
  zeroResultSeries: [],
  topTerms: [],
  failedTerms: [],
  refinements: [],
  hiddenTerms: { terms: 0, searches: 0 },
});

export const emptyFeedbackInsights = (meta: InsightsMeta): FeedbackInsights => ({
  meta,
  kpis: { helpful: unknown, notHelpful: unknown, helpfulRate: unknown, responseRate: unknown },
  series: [],
  pages: [],
});

export const emptyAiVisibilityInsights = (meta: InsightsMeta): AiVisibilityInsights => ({
  meta,
  drafting: { total: null, connections: [] },
  kpis: {
    aiCrawlerRequests: unknown,
    aiAssistantFetches: unknown,
    aiAssistantVisits: unknown,
    crawledPages: unknown,
    searchEngineRequests: unknown,
  },
  crawlerSeries: [],
  bots: [],
  resources: [],
  topCrawledPages: [],
  assistantReferrals: [],
  assistantReferralSeries: [],
  assistantLandingPages: [],
});

export const emptyPerformanceInsights = (meta: InsightsMeta): PerformanceInsights => ({
  meta,
  overall: emptyWebVitals(),
  byDevice: [],
  slowestPages: [],
  lcpP75Series: [],
});
