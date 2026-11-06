import type {
  AiVisibilityInsights,
  FeedbackInsights,
  InsightsAvailability,
  InsightsMeta,
  OverviewInsights,
  PageDetailInsights,
  PagesInsights,
  PerformanceInsights,
  SearchInsights,
  SearchTermRow,
  WebVitalsSummary,
} from '@/hooks/api/analytics';

/** Typed fixtures for the insights dashboard tests, shaped exactly like the API contract. */
export const meta = (availability: InsightsAvailability = 'complete', overrides: Partial<InsightsMeta> = {}): InsightsMeta => ({
  availability,
  timezone: 'Asia/Riyadh',
  current: { from: '2026-10-07T21:00:00.000Z', to: '2026-11-06T21:00:00.000Z' },
  previous: { from: '2026-09-07T21:00:00.000Z', to: '2026-10-07T21:00:00.000Z' },
  granularity: 'day',
  generatedAt: '2026-11-06T09:00:00.000Z',
  lastEventAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  ...overrides,
});

const unknown = { value: null, previous: null };
const series = (values: number[], start = 1) =>
  values.map((value, index) => ({ bucket: `2026-11-${String(start + index).padStart(2, '0')}`, value }));

export const term = (overrides: Partial<SearchTermRow> = {}): SearchTermRow => ({
  term: 'webhooks',
  termId: 'a1b2c3',
  searches: 14,
  visits: 9,
  zeroResultSearches: 14,
  clickThroughRate: 0,
  refinementRate: 0.4,
  averageClickPosition: null,
  topResultPath: null,
  ...overrides,
});

export const overviewFixture = (availability: InsightsAvailability = 'complete'): OverviewInsights => ({
  meta: meta(availability),
  kpis: {
    pageViews: { value: 1240, previous: 1000 },
    visits: { value: 410, previous: 400 },
    avgEngagedMs: { value: 95_000, previous: 80_000 },
    avgScrollDepth: { value: 0.62, previous: 0.6 },
    searches: { value: 300, previous: 250 },
    searchSuccessRate: { value: 0.7, previous: 0.72 },
    zeroResultRate: { value: 0.12, previous: 0.08 },
    helpfulRate: { value: 0.81, previous: null },
    aiAssistantVisits: { value: 37, previous: 20 },
    aiCrawlerRequests: { value: 900, previous: 0 },
  },
  pageViewsSeries: series([40, 52, 61, 38]),
  previousPageViewsSeries: series([30, 33, 35, 31]),
  topPages: [
    { path: 'getting-started', title: 'Getting started', views: 420, previousViews: 300 },
    { path: 'ar/دليل', title: 'الدليل', views: 120, previousViews: null },
  ],
  pagesNeedingWork: [
    {
      path: 'api/auth',
      title: 'Authentication',
      views: 210,
      reasons: ['low_helpfulness', 'search_bounce'],
      helpfulRate: 0.3,
      exitRate: 0.6,
      avgEngagedMs: 20_000,
    },
  ],
  failedSearches: [term()],
  searchTermsVisibility: 'visible',
  channels: [
    { channel: 'search', visits: 200, previousVisits: 180 },
    { channel: 'ai_assistant', visits: 37, previousVisits: 20 },
  ],
  feedback: { helpful: 34, notHelpful: 8 },
});

export const emptyOverview = (availability: InsightsAvailability = 'complete'): OverviewInsights => ({
  ...overviewFixture(availability),
  kpis: Object.fromEntries(
    Object.keys(overviewFixture().kpis).map((key) => [key, availability === 'complete' ? { value: 0, previous: 0 } : unknown]),
  ) as OverviewInsights['kpis'],
  pageViewsSeries: [],
  previousPageViewsSeries: [],
  topPages: [],
  pagesNeedingWork: [],
  failedSearches: [],
  channels: [],
  feedback: { helpful: 0, notHelpful: 0 },
  meta: meta(availability, { lastEventAt: availability === 'complete' ? null : undefined }),
});

const pageRow = (path: string, views: number, overrides: Partial<PagesInsights['rows'][number]> = {}): PagesInsights['rows'][number] => ({
  path,
  title: path.replace('-', ' '),
  views,
  previousViews: Math.round(views * 0.8),
  visits: Math.round(views / 2),
  avgEngagedMs: 60_000,
  avgScrollDepth: 0.5,
  entries: 10,
  exits: 5,
  exitRate: 0.3,
  helpful: 3,
  notHelpful: 1,
  helpfulRate: 0.75,
  lcpP75Ms: 1800,
  aiCrawlerRequests: 2,
  attention: [],
  ...overrides,
});

export const pagesFixture = (count = 3): PagesInsights => ({
  meta: meta(),
  rows: Array.from({ length: count }, (_, index) =>
    pageRow(`page-${index + 1}`, 1000 - index, index === 1 ? { attention: ['slow'], lcpP75Ms: 5200, exitRate: null } : {}),
  ),
  truncated: false,
});

const vitals = (overrides: Partial<WebVitalsSummary> = {}): WebVitalsSummary => ({
  samples: 120,
  lcpP75Ms: 2100,
  inpP75Ms: 320,
  clsP75: 0.3,
  fcpP75Ms: 900,
  ttfbP75Ms: 300,
  rating: { good: 0.6, needsImprovement: 0.3, poor: 0.1 },
  ...overrides,
});

export const pageDetailFixture = (): PageDetailInsights => ({
  meta: meta(),
  path: 'getting-started',
  title: 'Getting started',
  kpis: {
    views: { value: 420, previous: 300 },
    visits: { value: 200, previous: 180 },
    avgEngagedMs: { value: 70_000, previous: 60_000 },
    avgScrollDepth: { value: 0.7, previous: 0.6 },
    exitRate: { value: 0.4, previous: 0.3 },
    helpfulRate: { value: 0.9, previous: 0.8 },
  },
  viewsSeries: series([10, 12, 14]),
  previousViewsSeries: series([8, 9, 9]),
  feedback: { helpful: 9, notHelpful: 1, series: [{ bucket: '2026-11-01', helpful: 9, notHelpful: 1 }] },
  channels: [{ channel: 'direct', visits: 50 }],
  referrers: [{ domain: 'github.com', visits: 12 }],
  searchesLeadingHere: [term({ term: 'install', termId: 'i1', zeroResultSearches: 0 })],
  searchTermsVisibility: 'visible',
  nextPages: [{ path: 'guides/deploy', clicks: 30 }],
  previousPages: [{ path: '', clicks: 15 }],
  devices: [{ device: 'mobile', views: 100 }],
  languages: [{ language: 'ar', views: 80 }],
  webVitals: vitals(),
  aiCrawlers: [{ bot: 'GPTBot', operator: 'OpenAI', requests: 5, lastSeenAt: '2026-11-05T10:00:00.000Z' }],
});

export const searchFixture = (visibility: SearchInsights['searchTermsVisibility'] = 'visible'): SearchInsights => ({
  meta: meta(),
  searchTermsVisibility: visibility,
  termVisibilityThreshold: 2,
  kpis: {
    searches: { value: 300, previous: 250 },
    searchVisits: { value: 120, previous: 100 },
    zeroResultRate: { value: 0.12, previous: 0.08 },
    clickThroughRate: { value: 0.6, previous: 0.55 },
    refinementRate: { value: 0.2, previous: 0.25 },
    averageClickPosition: { value: 1.8, previous: 2.1 },
  },
  searchesSeries: series([10, 20, 30]),
  zeroResultSeries: series([1, 2, 3]),
  topTerms:
    visibility === 'visible'
      ? [term({ term: 'install', termId: 't1', zeroResultSearches: 0, clickThroughRate: 0.8, topResultPath: 'getting-started' })]
      : [term({ term: null, termId: 'h1' })],
  failedTerms:
    visibility === 'visible' ? [term(), term({ term: 'rate limits', termId: 'r2', zeroResultSearches: 0 })] : [term({ term: null, termId: 'h2' })],
  refinements: visibility === 'visible' ? [{ from: 'sso', to: 'single sign-on', visits: 4 }] : [],
  hiddenTerms: { terms: 7, searches: 9 },
});

export const feedbackFixture = (): FeedbackInsights => ({
  meta: meta(),
  kpis: {
    helpful: { value: 30, previous: 20 },
    notHelpful: { value: 10, previous: 5 },
    helpfulRate: { value: 0.75, previous: 0.8 },
    responseRate: { value: 0.05, previous: 0.04 },
  },
  series: [{ bucket: '2026-11-01', helpful: 30, notHelpful: 10 }],
  pages: [
    { path: 'good', title: 'Good page', views: 100, helpful: 10, notHelpful: 0, helpfulRate: 1 },
    { path: 'unrated', title: 'Unrated', views: 100, helpful: 0, notHelpful: 0, helpfulRate: null },
    { path: 'bad', title: 'Bad page', views: 100, helpful: 1, notHelpful: 9, helpfulRate: 0.1 },
  ],
});

export const aiFixture = (): AiVisibilityInsights => ({
  meta: meta(),
  kpis: {
    aiCrawlerRequests: { value: 900, previous: 600 },
    aiAssistantFetches: { value: 40, previous: 30 },
    aiAssistantVisits: { value: 37, previous: 20 },
    crawledPages: { value: 50, previous: 45 },
    searchEngineRequests: { value: 400, previous: 380 },
  },
  crawlerSeries: [
    { category: 'ai_training', points: series([100, 200]) },
    { category: 'seo', points: series([5, 5]) },
    { category: 'monitor', points: series([1, 2]) },
  ],
  bots: [
    {
      bot: 'GPTBot',
      operator: 'OpenAI',
      category: 'ai_training',
      requests: 500,
      previousRequests: 300,
      pages: 40,
      lastSeenAt: '2026-11-05T10:00:00.000Z',
      verification: 'verified',
    },
    {
      bot: 'ClaudeBot',
      operator: 'Anthropic',
      category: 'ai_training',
      requests: 200,
      previousRequests: null,
      pages: 20,
      lastSeenAt: '2026-11-04T10:00:00.000Z',
      verification: 'claimed',
    },
  ],
  resources: [
    { resource: 'page', requests: 600 },
    { resource: 'llms_txt', requests: 30 },
  ],
  topCrawledPages: [{ path: 'getting-started', title: 'Getting started', requests: 90, bots: 4, lastSeenAt: '2026-11-05T10:00:00.000Z' }],
  assistantReferrals: [
    { source: 'chatgpt', visits: 25, previousVisits: 10 },
    { source: 'other_ai', visits: 2, previousVisits: null },
  ],
  assistantReferralSeries: series([10, 15]),
  assistantLandingPages: [{ path: 'getting-started', title: 'Getting started', visits: 20 }],
});

export const performanceFixture = (): PerformanceInsights => ({
  meta: meta(),
  overall: vitals(),
  byDevice: [{ device: 'mobile', ...vitals({ lcpP75Ms: 4200 }) }],
  slowestPages: [{ path: 'api/reference', title: 'API reference', ...vitals({ lcpP75Ms: 5100 }) }],
  lcpP75Series: series([2000, 2200]),
});
