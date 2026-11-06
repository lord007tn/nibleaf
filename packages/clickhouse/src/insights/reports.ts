import { readPages, readViewsSeries, readVitals, vitalSummary } from './pages';
import { type InsightsReader, ratio } from './reader';
import { readSearch } from './search';
import type { AiVisibilityInsights, FeedbackInsights, OverviewInsights, PerformanceInsights, SeriesPoint } from './types';

export const readAiVisibility = async (reader: InsightsReader): Promise<AiVisibilityInsights> => {
  const crawlers = `${reader.facts} AND actor_type = 'bot' AND event_name = 'crawler_request'`;
  const [totals, bots, resources, pages, referrals, series, landing, crawlerSeries] = await Promise.all([
    reader.rows<{ current: number; ai: number; fetches: number; pages: number; engines: number; visits: number }>(`WITH totals AS (
      SELECT current, countIf(startsWith(bot_category, 'ai_')) AS ai, countIf(bot_category = 'ai_assistant') AS fetches,
        uniqExactIf(path, startsWith(bot_category, 'ai_') AND crawled_resource IN ('page', 'markdown')) AS pages,
        countIf(bot_category = 'search_engine') AS engines FROM (${crawlers}) GROUP BY current
    ), visits AS (SELECT current, uniqExact(session_hash) AS visits FROM (${reader.human}) WHERE event_name = 'page_view' AND channel = 'ai_assistant' GROUP BY current)
    SELECT coalesce(t.current, v.current) AS current, ifNull(ai, 0) AS ai, ifNull(fetches, 0) AS fetches, ifNull(pages, 0) AS pages,
      ifNull(engines, 0) AS engines, ifNull(visits, 0) AS visits FROM totals t FULL OUTER JOIN visits v ON t.current = v.current SETTINGS join_use_nulls = 1`),
    reader.rows<AiVisibilityInsights['bots'][number] & { current: number }>(`SELECT current, bot_name AS bot, any(bot_operator) AS operator,
      any(bot_category) AS category, count() AS requests, uniqExact(path) AS pages,
      formatDateTime(max(occurred_at), '%FT%T.000Z', 'UTC') AS lastSeenAt, any(verification) AS verification
      FROM (${crawlers}) GROUP BY current, bot ORDER BY requests DESC LIMIT 500`),
    reader.rows<AiVisibilityInsights['resources'][number]>(
      `SELECT crawled_resource AS resource, count() AS requests FROM (${crawlers}) WHERE current GROUP BY resource ORDER BY requests DESC`,
    ),
    reader.rows<Omit<AiVisibilityInsights['topCrawledPages'][number], 'title'>>(`SELECT path, count() AS requests, uniqExact(bot_name) AS bots,
      formatDateTime(max(occurred_at), '%FT%T.000Z', 'UTC') AS lastSeenAt FROM (${crawlers}) WHERE current AND crawled_resource IN ('page', 'markdown') GROUP BY path ORDER BY requests DESC LIMIT 100`),
    reader.rows<{ current: number; source: AiVisibilityInsights['assistantReferrals'][number]['source']; visits: number }>(
      `SELECT current, ai_source AS source, uniqExact(session_hash) AS visits FROM (${reader.human}) WHERE event_name = 'page_view' AND channel = 'ai_assistant' AND ai_source != '' GROUP BY current, ai_source`,
    ),
    reader.rows<SeriesPoint>(
      `SELECT ${reader.bucket} AS bucket, uniqExact(session_hash) AS value FROM (${reader.human}) WHERE current AND event_name = 'page_view' AND channel = 'ai_assistant' GROUP BY bucket ORDER BY bucket`,
    ),
    reader.rows<{ path: string; visits: number }>(`SELECT landing AS path, count() AS visits FROM (
      SELECT session_hash, argMin(path, tuple(occurred_at, event_id)) AS landing, argMin(channel, tuple(occurred_at, event_id)) AS arrival
      FROM (${reader.human}) WHERE current AND event_name = 'page_view' AND session_hash IS NOT NULL GROUP BY session_hash
    ) WHERE arrival = 'ai_assistant' GROUP BY path ORDER BY visits DESC LIMIT 100`),
    reader.rows<{ category: AiVisibilityInsights['crawlerSeries'][number]['category']; bucket: string; value: number }>(
      `SELECT bot_category AS category, ${reader.bucket} AS bucket, count() AS value FROM (${crawlers}) WHERE current GROUP BY category, bucket ORDER BY bucket`,
    ),
  ]);
  const compared = (key: 'ai' | 'fetches' | 'pages' | 'engines' | 'visits') => ({
    value: reader.covered('current', key === 'visits' ? 'human' : 'crawler') ? (totals.find((row) => row.current === 1)?.[key] ?? 0) : null,
    previous: reader.covered('previous', key === 'visits' ? 'human' : 'crawler') ? (totals.find((row) => row.current === 0)?.[key] ?? 0) : null,
  });
  const previousBots = new Map(bots.filter((row) => !row.current).map((row) => [row.bot, row.requests]));
  const previousReferrals = new Map(referrals.filter((row) => !row.current).map((row) => [row.source, row.visits]));
  return {
    meta: reader.meta(),
    kpis: {
      aiCrawlerRequests: compared('ai'),
      aiAssistantFetches: compared('fetches'),
      aiAssistantVisits: compared('visits'),
      crawledPages: compared('pages'),
      searchEngineRequests: compared('engines'),
    },
    bots: bots
      .filter((row) => row.current)
      .map(({ current: _current, ...row }) => ({
        ...row,
        previousRequests: reader.covered('previous', 'crawler') ? (previousBots.get(row.bot) ?? 0) : null,
      })),
    resources,
    topCrawledPages: pages.map((row) => ({ ...row, title: reader.title(row.path) })),
    assistantReferrals: referrals
      .filter((row) => row.current)
      .map((row) => ({
        source: row.source,
        visits: row.visits,
        previousVisits: reader.covered('previous') ? (previousReferrals.get(row.source) ?? 0) : null,
      })),
    assistantReferralSeries: series,
    assistantLandingPages: landing.map((row) => ({ ...row, title: reader.title(row.path) })),
    crawlerSeries: [...new Set(crawlerSeries.map((row) => row.category))].map((category) => ({
      category,
      points: crawlerSeries.filter((row) => row.category === category).map(({ bucket, value }) => ({ bucket, value })),
    })),
  };
};

export const readFeedback = async (reader: InsightsReader): Promise<FeedbackInsights> => {
  const [totals, series, pages] = await Promise.all([
    reader.rows<{ current: number; helpful: number; notHelpful: number; views: number }>(`SELECT current,
      countIf(feedback = 'helpful' AND feedback_target = 'page') AS helpful, countIf(feedback = 'not_helpful' AND feedback_target = 'page') AS notHelpful,
      countIf(event_name = 'page_view') AS views FROM (${reader.human}) GROUP BY current`),
    reader.rows<FeedbackInsights['series'][number]>(`SELECT ${reader.bucket} AS bucket, countIf(feedback = 'helpful') AS helpful,
      countIf(feedback = 'not_helpful') AS notHelpful FROM (${reader.human}) WHERE current AND event_name = 'feedback_submitted' AND feedback_target = 'page' GROUP BY bucket ORDER BY bucket`),
    reader.rows<Omit<FeedbackInsights['pages'][number], 'title' | 'helpfulRate'>>(`SELECT path, countIf(event_name = 'page_view') AS views,
      countIf(feedback = 'helpful' AND feedback_target = 'page') AS helpful, countIf(feedback = 'not_helpful' AND feedback_target = 'page') AS notHelpful
      FROM (${reader.human}) WHERE current AND path != '' GROUP BY path HAVING helpful + notHelpful > 0 ORDER BY notHelpful DESC LIMIT 500`),
  ]);
  const value = (period: number, key: 'helpful' | 'notHelpful' | 'helpfulRate' | 'responseRate') => {
    const row = totals.find((item) => item.current === period);
    if (key === 'helpful' || key === 'notHelpful') return row?.[key] ?? 0;
    return row
      ? ratio(key === 'helpfulRate' ? row.helpful : row.helpful + row.notHelpful, key === 'helpfulRate' ? row.helpful + row.notHelpful : row.views)
      : null;
  };
  const compared = (key: Parameters<typeof value>[1]) => ({
    value: reader.covered('current') ? value(1, key) : null,
    previous: reader.covered('previous') ? value(0, key) : null,
  });
  return {
    meta: reader.meta(),
    kpis: {
      helpful: compared('helpful'),
      notHelpful: compared('notHelpful'),
      helpfulRate: compared('helpfulRate'),
      responseRate: compared('responseRate'),
    },
    series,
    pages: pages.map((row) => ({ ...row, title: reader.title(row.path), helpfulRate: ratio(row.helpful, row.helpful + row.notHelpful) })),
  };
};

export const readPerformance = async (reader: InsightsReader): Promise<PerformanceInsights> => {
  const [overall, devices, pages, series] = await Promise.all([
    readVitals(reader),
    readVitals<{ device: string }>(reader, 'device'),
    readVitals<{ path: string }>(reader, 'path'),
    readVitals<{ bucket: string }>(reader, 'bucket'),
  ]);
  return {
    meta: reader.meta(!overall[0]?.samples || overall[0].rated < overall[0].samples),
    overall: vitalSummary(overall[0]),
    byDevice: devices.map((row) => ({ device: row.device || 'unknown', ...vitalSummary(row) })),
    slowestPages: pages.map((row) => ({ path: row.path, title: reader.title(row.path), ...vitalSummary(row) })),
    lcpP75Series: series
      .filter((row) => row.lcpP75Ms !== null)
      .map((row) => ({ bucket: row.bucket, value: row.lcpP75Ms ?? 0 }))
      .sort((a, b) => a.bucket.localeCompare(b.bucket)),
  };
};

export const readOverview = async (reader: InsightsReader): Promise<OverviewInsights> => {
  const [totals, series, pages, search, ai, channels] = await Promise.all([
    reader.rows<{
      current: number;
      views: number;
      visits: number;
      engaged: number;
      engagement: number | null;
      scroll: number | null;
      helpful: number;
      notHelpful: number;
    }>(`SELECT current,
      countIf(event_name = 'page_view') AS views, uniqExactIf(session_hash, event_name = 'page_view') AS visits,
      countIf(event_name = 'page_engaged') AS engaged, avgOrNullIf(engagement_ms, event_name = 'page_engaged') AS engagement,
      avgOrNullIf(scroll_depth, event_name = 'page_engaged') AS scroll, countIf(feedback = 'helpful' AND feedback_target = 'page') AS helpful,
      countIf(feedback = 'not_helpful' AND feedback_target = 'page') AS notHelpful FROM (${reader.human}) GROUP BY current`),
    readViewsSeries(reader),
    readPages(reader),
    readSearch(reader),
    readAiVisibility(reader),
    reader.rows<{
      current: number;
      channel: OverviewInsights['channels'][number]['channel'];
      visits: number;
    }>(`SELECT current, channel, count() AS visits FROM (
      SELECT current, session_hash, argMin(channel, tuple(occurred_at, event_id)) AS channel FROM (${reader.human})
      WHERE event_name = 'page_view' AND session_hash IS NOT NULL GROUP BY current, session_hash
    ) GROUP BY current, channel ORDER BY visits DESC`),
  ]);
  const value = (period: number, key: 'views' | 'visits' | 'engagement' | 'scroll' | 'helpfulRate') => {
    const row = totals.find((item) => item.current === period);
    if (key === 'views' || key === 'visits') return row?.[key] ?? 0;
    return row ? (key === 'helpfulRate' ? ratio(row.helpful, row.helpful + row.notHelpful) : row[key]) : null;
  };
  const compared = (key: Parameters<typeof value>[1]) => ({
    value: reader.covered('current') ? value(1, key) : null,
    previous: reader.covered('previous') ? value(0, key) : null,
  });
  return {
    meta: reader.meta([pages.meta, search.meta, ai.meta].some((meta) => meta.availability === 'partial')),
    kpis: {
      pageViews: compared('views'),
      visits: compared('visits'),
      avgEngagedMs: compared('engagement'),
      avgScrollDepth: compared('scroll'),
      searches: search.kpis.searches,
      searchSuccessRate: search.kpis.clickThroughRate,
      zeroResultRate: search.kpis.zeroResultRate,
      helpfulRate: compared('helpfulRate'),
      aiAssistantVisits: ai.kpis.aiAssistantVisits,
      aiCrawlerRequests: ai.kpis.aiCrawlerRequests,
    },
    pageViewsSeries: series.filter((row) => row.current).map(({ bucket, value: count }) => ({ bucket, value: count })),
    previousPageViewsSeries: series.filter((row) => !row.current).map(({ bucket, value: count }) => ({ bucket, value: count })),
    topPages: pages.rows.slice(0, 10).map((row) => ({ path: row.path, title: row.title, views: row.views, previousViews: row.previousViews })),
    pagesNeedingWork: pages.rows
      .filter((row) => row.attention.length > 0)
      .slice(0, 10)
      .map((row) => ({
        path: row.path,
        title: row.title,
        views: row.views,
        reasons: row.attention,
        helpfulRate: row.helpfulRate,
        exitRate: row.exitRate,
        avgEngagedMs: row.avgEngagedMs,
      })),
    failedSearches: search.failedTerms.slice(0, 10),
    searchTermsVisibility: reader.scope.visibility,
    channels: channels
      .filter((row) => row.current)
      .map((row) => ({
        channel: row.channel,
        visits: row.visits,
        previousVisits: reader.covered('previous') ? (channels.find((item) => !item.current && item.channel === row.channel)?.visits ?? 0) : null,
      })),
    feedback: { helpful: totals.find((row) => row.current)?.helpful ?? 0, notHelpful: totals.find((row) => row.current)?.notHelpful ?? 0 },
  };
};
