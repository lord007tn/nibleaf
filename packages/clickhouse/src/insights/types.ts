/**
 * Response contract for the docs-owner analytics dashboard ("insights").
 *
 * Every endpoint under `/app/projects/:projectId/analytics/insights/*` returns
 * one of these shapes. They are deliberately UI-ready: counts are plain
 * numbers, rates are 0..1 fractions, durations are milliseconds, dates are
 * `YYYY-MM-DD` strings in the requested timezone. `null` always means
 * "unknown" (not collected, unavailable, or not enough data) and must never be
 * rendered as zero.
 *
 * Human traffic only: every reader metric excludes classified bots. Crawler
 * traffic is reported separately under `AiVisibility`.
 */

export type InsightsAvailability =
  /** ClickHouse answered and every metric is complete. */
  | 'complete'
  /** ClickHouse answered but some metrics are missing or approximate. */
  | 'partial'
  /** ClickHouse is configured but did not answer (down, timeout, auth). */
  | 'unavailable'
  /** This instance does not read analytics from ClickHouse (ANALYTICS_MODE). */
  | 'not_configured';

export type InsightsPreset = '24h' | '7d' | '30d' | '90d';

export interface InsightsPeriod {
  /** Inclusive start, ISO-8601 UTC instant. */
  from: string;
  /** Exclusive end, ISO-8601 UTC instant. */
  to: string;
}

export interface InsightsMeta {
  availability: InsightsAvailability;
  timezone: string;
  current: InsightsPeriod;
  /** The equally long period immediately before `current`; null when comparison is off. */
  previous: InsightsPeriod | null;
  /** Granularity of every timeseries in this response. */
  granularity: 'hour' | 'day';
  generatedAt: string;
}

/** A metric and the same metric over the comparison period. */
export interface Compared {
  value: number | null;
  previous: number | null;
}

export interface SeriesPoint {
  /** `YYYY-MM-DD` (day) or `YYYY-MM-DDTHH:00` (hour), in the requested timezone. */
  bucket: string;
  value: number;
}

/** How a human visit arrived. Computed server-side from referrer + utm_source. */
export type TrafficChannel = 'direct' | 'search' | 'ai_assistant' | 'social' | 'referral' | 'internal' | 'campaign';

/** Normalized AI assistant that referred a human visitor (chatgpt.com, perplexity.ai, …). */
export type AiAssistantSource =
  | 'chatgpt'
  | 'perplexity'
  | 'claude'
  | 'gemini'
  | 'copilot'
  | 'deepseek'
  | 'grok'
  | 'meta_ai'
  | 'mistral'
  | 'you'
  | 'phind'
  | 'other_ai';

export type PageAttentionReason =
  /** Readers often press "not helpful". */
  | 'low_helpfulness'
  /** Readers leave the site from this page more than usual. */
  | 'high_exit'
  /** Readers leave quickly / scroll little. */
  | 'low_engagement'
  /** Searches lead here but readers bounce back to search. */
  | 'search_bounce'
  /** Real-user loading performance is poor. */
  | 'slow';

export interface PageAttention {
  path: string;
  title: string | null;
  views: number;
  reasons: PageAttentionReason[];
  helpfulRate: number | null;
  exitRate: number | null;
  avgEngagedMs: number | null;
}

/** Search terms are only returned when the project opted in AND enough distinct
 * visits searched for the same normalized term (k-anonymity threshold). */
export type SearchTermsVisibility =
  | 'visible'
  /** The project has not enabled "store public search terms". */
  | 'disabled_by_setting'
  /** Private / reader-restricted sites never store raw terms. */
  | 'private_site';

export interface SearchTermRow {
  /** Normalized term text, or null when hidden (see `SearchTermsVisibility`). */
  term: string | null;
  /** Stable opaque id (query hash prefix) so hidden rows remain distinguishable. */
  termId: string;
  searches: number;
  visits: number;
  zeroResultSearches: number;
  /** Searches followed by a result click / searches. */
  clickThroughRate: number | null;
  /** Searches immediately re-phrased by the same visit / searches. */
  refinementRate: number | null;
  averageClickPosition: number | null;
  /** Most clicked result path for this term, if any. */
  topResultPath: string | null;
}

export interface OverviewInsights {
  meta: InsightsMeta;
  kpis: {
    pageViews: Compared;
    visits: Compared;
    avgEngagedMs: Compared;
    avgScrollDepth: Compared;
    searches: Compared;
    /** Searches that got a click / searches. */
    searchSuccessRate: Compared;
    zeroResultRate: Compared;
    /** helpful / (helpful + not_helpful). */
    helpfulRate: Compared;
    aiAssistantVisits: Compared;
    aiCrawlerRequests: Compared;
  };
  pageViewsSeries: SeriesPoint[];
  previousPageViewsSeries: SeriesPoint[];
  topPages: Array<{ path: string; title: string | null; views: number; previousViews: number | null }>;
  pagesNeedingWork: PageAttention[];
  failedSearches: SearchTermRow[];
  searchTermsVisibility: SearchTermsVisibility;
  channels: Array<{ channel: TrafficChannel; visits: number; previousVisits: number | null }>;
  feedback: { helpful: number; notHelpful: number };
}

export interface PageRow {
  path: string;
  title: string | null;
  views: number;
  previousViews: number | null;
  visits: number;
  avgEngagedMs: number | null;
  avgScrollDepth: number | null;
  entries: number;
  exits: number;
  exitRate: number | null;
  helpful: number;
  notHelpful: number;
  helpfulRate: number | null;
  /** p75 Largest Contentful Paint in ms, null without samples. */
  lcpP75Ms: number | null;
  aiCrawlerRequests: number;
  attention: PageAttentionReason[];
}

export interface PagesInsights {
  meta: InsightsMeta;
  /** Up to 500 rows ordered by views desc; the client sorts/filters/paginates. */
  rows: PageRow[];
  truncated: boolean;
}

export interface WebVitalsSummary {
  samples: number;
  lcpP75Ms: number | null;
  inpP75Ms: number | null;
  /** Unitless Cumulative Layout Shift p75. */
  clsP75: number | null;
  fcpP75Ms: number | null;
  ttfbP75Ms: number | null;
  /** Share of page loads rated good / needs improvement / poor on LCP+INP+CLS combined (0..1). */
  rating: { good: number; needsImprovement: number; poor: number } | null;
}

export interface PageDetailInsights {
  meta: InsightsMeta;
  path: string;
  title: string | null;
  kpis: {
    views: Compared;
    visits: Compared;
    avgEngagedMs: Compared;
    avgScrollDepth: Compared;
    exitRate: Compared;
    helpfulRate: Compared;
  };
  viewsSeries: SeriesPoint[];
  previousViewsSeries: SeriesPoint[];
  feedback: { helpful: number; notHelpful: number; series: Array<{ bucket: string; helpful: number; notHelpful: number }> };
  channels: Array<{ channel: TrafficChannel; visits: number }>;
  referrers: Array<{ domain: string; visits: number }>;
  /** Search terms whose results led readers to this page. */
  searchesLeadingHere: SearchTermRow[];
  searchTermsVisibility: SearchTermsVisibility;
  /** Where readers went next from this page. */
  nextPages: Array<{ path: string; clicks: number }>;
  /** Pages readers came from (internal navigation). */
  previousPages: Array<{ path: string; clicks: number }>;
  devices: Array<{ device: string; views: number }>;
  languages: Array<{ language: string; views: number }>;
  webVitals: WebVitalsSummary;
  aiCrawlers: Array<{ bot: string; operator: string; requests: number; lastSeenAt: string }>;
}

export interface SearchInsights {
  meta: InsightsMeta;
  searchTermsVisibility: SearchTermsVisibility;
  /** Minimum distinct visits before a term's text is shown. */
  termVisibilityThreshold: number;
  kpis: {
    /** Settled searches (typeahead keystrokes collapsed into the final query). */
    searches: Compared;
    searchVisits: Compared;
    zeroResultRate: Compared;
    clickThroughRate: Compared;
    refinementRate: Compared;
    averageClickPosition: Compared;
  };
  searchesSeries: SeriesPoint[];
  zeroResultSeries: SeriesPoint[];
  topTerms: SearchTermRow[];
  /** Zero-result or never-clicked terms: candidates for new articles. */
  failedTerms: SearchTermRow[];
  /** Most common "searched X, then immediately searched Y" pairs (only when terms are visible). */
  refinements: Array<{ from: string; to: string; visits: number }>;
  /** Terms below the threshold, aggregated so totals still add up. */
  hiddenTerms: { terms: number; searches: number };
}

export interface FeedbackInsights {
  meta: InsightsMeta;
  kpis: { helpful: Compared; notHelpful: Compared; helpfulRate: Compared; responseRate: Compared };
  series: Array<{ bucket: string; helpful: number; notHelpful: number }>;
  pages: Array<{ path: string; title: string | null; views: number; helpful: number; notHelpful: number; helpfulRate: number | null }>;
}

export type CrawlerCategory =
  /** Collects content to train models (GPTBot, ClaudeBot, CCBot, Google-Extended…). */
  | 'ai_training'
  /** Indexes content for AI search/answers (OAI-SearchBot, PerplexityBot, Claude-SearchBot…). */
  | 'ai_search'
  /** Fetches a page live because a person asked an assistant (ChatGPT-User, Claude-User, Perplexity-User…). */
  | 'ai_assistant'
  /** Classic search engines (Googlebot, Bingbot, Applebot…). */
  | 'search_engine'
  | 'seo'
  | 'social'
  | 'monitor'
  | 'other';

export type CrawledResource = 'page' | 'markdown' | 'llms_txt' | 'llms_full_txt' | 'sitemap' | 'robots' | 'openapi' | 'rss' | 'other';

export interface AiVisibilityInsights {
  meta: InsightsMeta;
  kpis: {
    aiCrawlerRequests: Compared;
    aiAssistantFetches: Compared;
    aiAssistantVisits: Compared;
    crawledPages: Compared;
    searchEngineRequests: Compared;
  };
  /** One series per crawler category, same buckets. */
  crawlerSeries: Array<{ category: CrawlerCategory; points: SeriesPoint[] }>;
  bots: Array<{
    bot: string;
    operator: string;
    category: CrawlerCategory;
    requests: number;
    previousRequests: number | null;
    pages: number;
    lastSeenAt: string;
    /** 'claimed' = identified by user agent only; 'verified' = IP/rDNS verified. */
    verification: 'claimed' | 'verified';
  }>;
  resources: Array<{ resource: CrawledResource; requests: number }>;
  topCrawledPages: Array<{ path: string; title: string | null; requests: number; bots: number; lastSeenAt: string }>;
  /** Human visits referred by AI assistants. */
  assistantReferrals: Array<{ source: AiAssistantSource; visits: number; previousVisits: number | null }>;
  assistantReferralSeries: SeriesPoint[];
  assistantLandingPages: Array<{ path: string; title: string | null; visits: number }>;
}

export interface PerformanceInsights {
  meta: InsightsMeta;
  overall: WebVitalsSummary;
  byDevice: Array<{ device: string } & WebVitalsSummary>;
  /** Slowest pages by LCP p75 with at least a minimum number of samples. */
  slowestPages: Array<{ path: string; title: string | null } & WebVitalsSummary>;
  lcpP75Series: SeriesPoint[];
}
