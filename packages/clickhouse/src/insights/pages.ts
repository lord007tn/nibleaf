import { type InsightsReader, ratio } from './reader';
import { readSearchBounces, readSearchesLeadingHere } from './search';
import type { PageAttentionReason, PageDetailInsights, PageRow, PagesInsights, SeriesPoint, WebVitalsSummary } from './types';

interface PageMetrics {
  current: number;
  path: string;
  views: number;
  visits: number;
  engaged: number;
  engagement: number | null;
  scroll: number | null;
  helpful: number;
  notHelpful: number;
  lcp: number | null;
}

/** Evidence thresholds avoid flagging single-visit noise. Exit and engagement
 * need >=10 views, feedback >=5 votes; slow needs >=5 measured loads. Search
 * bounce means >=5 clicks led here and >=50% refined within 120s (added only
 * where that correlation is measured, never inferred from an exit alone). */
const attention = (row: PageRow, vitalSamples: number): PageAttentionReason[] => {
  const reasons: PageAttentionReason[] = [];
  if (row.helpful + row.notHelpful >= 5 && (row.helpfulRate ?? 1) < 0.6) reasons.push('low_helpfulness');
  if (row.views >= 10 && (row.exitRate ?? 0) > 0.8) reasons.push('high_exit');
  if (row.views >= 10 && row.avgEngagedMs !== null && row.avgEngagedMs < 10_000 && row.avgScrollDepth !== null && row.avgScrollDepth < 25)
    reasons.push('low_engagement');
  if (vitalSamples >= 5 && (row.lcpP75Ms ?? 0) > 4000) reasons.push('slow');
  return reasons;
};

export const readPages = async (reader: InsightsReader): Promise<PagesInsights> => {
  const [metrics, edges, crawlers, vitals, bounces] = await Promise.all([
    reader.rows<PageMetrics>(`SELECT current, path, countIf(event_name = 'page_view') AS views,
      uniqExactIf(session_hash, event_name = 'page_view') AS visits,
      countIf(event_name = 'page_engaged') AS engaged,
      avgOrNullIf(engagement_ms, event_name = 'page_engaged') AS engagement,
      avgOrNullIf(scroll_depth, event_name = 'page_engaged') AS scroll,
      countIf(feedback = 'helpful' AND feedback_target = 'page') AS helpful,
      countIf(feedback = 'not_helpful' AND feedback_target = 'page') AS notHelpful,
      quantileExactOrNullIf(0.75)(lcp_ms, event_name = 'web_vitals' AND lcp_ms IS NOT NULL) AS lcp
      FROM (${reader.human}) WHERE path != '' GROUP BY current, path ORDER BY views DESC LIMIT 501 BY current`),
    reader.rows<{ path: string; entries: number; exits: number }>(`WITH sessions AS (
      SELECT argMin(path, tuple(occurred_at, event_id)) AS entry, argMax(path, tuple(occurred_at, event_id)) AS exit
      FROM (${reader.human}) WHERE current AND session_hash IS NOT NULL AND event_name = 'page_view' GROUP BY session_hash
    ) SELECT path, countIf(kind = 'entry') AS entries, countIf(kind = 'exit') AS exits FROM (
      SELECT entry AS path, 'entry' AS kind FROM sessions UNION ALL SELECT exit AS path, 'exit' AS kind FROM sessions
    ) GROUP BY path`),
    reader.rows<{ path: string; requests: number }>(
      `SELECT path, count() AS requests FROM (${reader.facts}) WHERE current AND event_name = 'crawler_request' AND actor_type = 'bot' AND startsWith(bot_category, 'ai_') GROUP BY path`,
    ),
    reader.rows<{ path: string; samples: number }>(
      `SELECT path, countIf(lcp_ms IS NOT NULL) AS samples FROM (${reader.human}) WHERE current AND event_name = 'web_vitals' GROUP BY path`,
    ),
    readSearchBounces(reader),
  ]);
  const previousTruncated = metrics.filter((row) => !row.current).length >= 501;
  const previous = new Map(metrics.filter((row) => !row.current).map((row) => [row.path, row]));
  const edgeMap = new Map(edges.map((row) => [row.path, row]));
  const crawlerMap = new Map(crawlers.map((row) => [row.path, row.requests]));
  const vitalMap = new Map(vitals.map((row) => [row.path, row.samples]));
  const rows = metrics
    .filter((row) => row.current)
    .map((metric): PageRow => {
      const edge = edgeMap.get(metric.path);
      const row: PageRow = {
        path: metric.path,
        title: reader.title(metric.path),
        views: metric.views,
        previousViews: reader.covered('previous') ? (previous.get(metric.path)?.views ?? (previousTruncated ? null : 0)) : null,
        visits: metric.visits,
        avgEngagedMs: metric.engagement,
        avgScrollDepth: metric.scroll,
        entries: edge?.entries ?? 0,
        exits: edge?.exits ?? 0,
        exitRate: metric.visits > 0 ? ratio(edge?.exits ?? 0, metric.visits) : null,
        helpful: metric.helpful,
        notHelpful: metric.notHelpful,
        helpfulRate: ratio(metric.helpful, metric.helpful + metric.notHelpful),
        lcpP75Ms: metric.lcp,
        aiCrawlerRequests: crawlerMap.get(metric.path) ?? 0,
        attention: [],
      };
      row.attention = attention(row, vitalMap.get(row.path) ?? 0);
      const bounce = bounces.find((item) => item.path === row.path);
      if (bounce && bounce.landings >= 5 && bounce.bounces / bounce.landings >= 0.5) row.attention.push('search_bounce');
      return row;
    })
    .sort((left, right) => right.views - left.views || left.path.localeCompare(right.path));
  return {
    meta: reader.meta(
      previousTruncated ||
        metrics.some((row) => row.views > 0 && (row.visits === 0 || row.engaged === 0)) ||
        rows.length > 500 ||
        metrics.length >= 1002,
    ),
    rows: rows.slice(0, 500),
    truncated: rows.length > 500 || metrics.length >= 1002,
  };
};

export const readViewsSeries = async (reader: InsightsReader, path?: string) => {
  const rows = await reader.rows<SeriesPoint & { current: number }>(
    `SELECT current, ${reader.bucket} AS bucket, count() AS value FROM (${reader.human}) WHERE event_name = 'page_view'
    ${path !== undefined ? 'AND path = {path:String}' : ''} GROUP BY current, bucket ORDER BY bucket`,
    { path },
  );
  return [
    ...reader.grid(
      rows.filter((row) => row.current),
      { current: 1, value: 0 },
    ),
    ...reader.grid(
      rows.filter((row) => !row.current),
      { current: 0, value: 0 },
      'previous',
    ),
  ];
};

const vitalSelect = `count() AS samples,
  quantileExactOrNull(0.75)(lcp_ms) AS lcpP75Ms, quantileExactOrNull(0.75)(inp_ms) AS inpP75Ms,
  quantileExactOrNull(0.75)(cls_milli) / 1000 AS clsP75,
  quantileExactOrNull(0.75)(fcp_ms) AS fcpP75Ms, quantileExactOrNull(0.75)(ttfb_ms) AS ttfbP75Ms,
  countIf(lcp_ms IS NOT NULL AND inp_ms IS NOT NULL AND cls_milli IS NOT NULL) AS rated,
  countIf(lcp_ms <= 2500 AND inp_ms <= 200 AND cls_milli <= 100) AS good,
  countIf(lcp_ms IS NOT NULL AND inp_ms IS NOT NULL AND cls_milli IS NOT NULL AND (lcp_ms > 4000 OR inp_ms > 500 OR cls_milli > 250)) AS poor`;

interface VitalRow extends Omit<WebVitalsSummary, 'rating'> {
  rated: number;
  good: number;
  poor: number;
}
export const vitalSummary = (row?: VitalRow): WebVitalsSummary => ({
  samples: row?.samples ?? 0,
  lcpP75Ms: row?.lcpP75Ms ?? null,
  inpP75Ms: row?.inpP75Ms ?? null,
  clsP75: row?.clsP75 ?? null,
  fcpP75Ms: row?.fcpP75Ms ?? null,
  ttfbP75Ms: row?.ttfbP75Ms ?? null,
  rating: row?.rated
    ? { good: row.good / row.rated, needsImprovement: (row.rated - row.good - row.poor) / row.rated, poor: row.poor / row.rated }
    : null,
});

export const readVitals = <T extends object = object>(reader: InsightsReader, dimension?: 'path' | 'device' | 'bucket', path?: string) =>
  reader.rows<VitalRow & T>(
    `SELECT ${dimension ? `${dimension === 'bucket' ? reader.bucket : dimension} AS ${dimension},` : ''} ${vitalSelect}
    FROM (${reader.human}) WHERE current AND event_name = 'web_vitals' ${path !== undefined ? 'AND path = {path:String}' : ''}
    ${dimension ? `GROUP BY ${dimension}` : ''} ${dimension === 'path' ? 'HAVING samples >= 5 ORDER BY lcpP75Ms DESC LIMIT 100' : ''}`,
    { path },
  );

// A visit contributes once, using its first page view's arrival attribution.
const arrivals = (reader: InsightsReader) => `SELECT
  argMin(channel, tuple(occurred_at, event_id)) AS channel,
  argMin(referrer_domain, tuple(occurred_at, event_id)) AS domain
  FROM analytics_events FINAL WHERE tenant_id = {tenant:String} AND project_id = {project:String}
  AND actor_type = 'human' AND event_name = 'page_view' AND session_hash IN (
    SELECT session_hash FROM (${reader.human}) WHERE current AND event_name = 'page_view' AND path = {path:String} AND session_hash IS NOT NULL
  ) GROUP BY session_hash
  UNION ALL SELECT channel, referrer_domain AS domain FROM (${reader.human})
  WHERE current AND event_name = 'page_view' AND session_hash IS NULL AND path = {path:String}`;

export const readPageDetail = async (reader: InsightsReader, path: string): Promise<PageDetailInsights> => {
  const [metrics, series, feedback, channels, referrers, devices, languages, vitals, bots, transitions, terms] = await Promise.all([
    reader.rows<PageMetrics & { exits: number }>(
      `WITH views AS (
      SELECT current, session_hash, argMax(path, tuple(occurred_at, event_id)) AS exit FROM (${reader.human})
      WHERE event_name = 'page_view' AND session_hash IS NOT NULL GROUP BY current, session_hash
    ), exits_by_period AS (SELECT current, countIf(exit = {path:String}) AS exits_count FROM views GROUP BY current)
    SELECT e.current AS current, e.path AS path, countIf(event_name = 'page_view') AS views, uniqExactIf(session_hash, event_name = 'page_view') AS visits,
      countIf(event_name = 'page_engaged') AS engaged, avgOrNullIf(engagement_ms, event_name = 'page_engaged') AS engagement,
      avgOrNullIf(scroll_depth, event_name = 'page_engaged') AS scroll,
      countIf(feedback = 'helpful' AND feedback_target = 'page') AS helpful, countIf(feedback = 'not_helpful' AND feedback_target = 'page') AS notHelpful,
      any(x.exits_count) AS exits
      FROM (${reader.human}) e LEFT JOIN exits_by_period x ON e.current = x.current
      WHERE e.path = {path:String} GROUP BY e.current, e.path`,
      { path },
    ),
    readViewsSeries(reader, path),
    reader.rows<{ bucket: string; helpful: number; notHelpful: number }>(
      `SELECT ${reader.bucket} AS bucket,
      countIf(feedback = 'helpful') AS helpful, countIf(feedback = 'not_helpful') AS notHelpful FROM (${reader.human})
      WHERE current AND event_name = 'feedback_submitted' AND feedback_target = 'page' AND path = {path:String} GROUP BY bucket ORDER BY bucket`,
      { path },
    ),
    reader.rows<{ channel: PageDetailInsights['channels'][number]['channel']; visits: number }>(
      `SELECT channel, count() AS visits FROM (${arrivals(reader)}) GROUP BY channel ORDER BY visits DESC`,
      { path },
    ),
    reader.rows<{ domain: string; visits: number }>(
      `SELECT domain, count() AS visits FROM (${arrivals(reader)}) WHERE domain != '' GROUP BY domain ORDER BY visits DESC LIMIT 50`,
      { path },
    ),
    reader.rows<{ device: string; views: number }>(
      `SELECT device, count() AS views FROM (${reader.human}) WHERE current AND event_name = 'page_view' AND path = {path:String} GROUP BY device`,
      { path },
    ),
    reader.rows<{ language: string; views: number }>(
      `SELECT language, count() AS views FROM (${reader.human}) WHERE current AND event_name = 'page_view' AND path = {path:String} GROUP BY language`,
      { path },
    ),
    readVitals(reader, undefined, path),
    reader.rows<PageDetailInsights['aiCrawlers'][number]>(
      `SELECT bot_name AS bot, any(bot_operator) AS operator, count() AS requests,
      formatDateTime(max(occurred_at), '%FT%T.000Z', 'UTC') AS lastSeenAt FROM (${reader.facts}) WHERE current AND actor_type = 'bot' AND event_name = 'crawler_request' AND startsWith(bot_category, 'ai_') AND path = {path:String} GROUP BY bot ORDER BY requests DESC`,
      { path },
    ),
    reader.rows<{ path: string; target: string; clicks: number }>(
      `SELECT path, replaceRegexpOne(target_path, '^/(?:sites/[^/]+/?)?', '') AS target, count() AS clicks FROM (${reader.human})
      WHERE current AND event_name = 'navigation_clicked' AND target != path AND (path = {path:String} OR target = {path:String}) GROUP BY path, target ORDER BY clicks DESC LIMIT 200`,
      { path },
    ),
    readSearchesLeadingHere(reader, path),
  ]);
  const current = metrics.find((row) => row.current === 1);
  const previous = metrics.find((row) => row.current === 0);
  const metric = (row: typeof current, key: 'views' | 'visits' | 'engagement' | 'scroll' | 'exitRate' | 'helpfulRate'): number | null => {
    if (key === 'views' || key === 'visits') return row?.[key] ?? 0;
    if (!row) return null;
    return key === 'exitRate' ? ratio(row.exits, row.visits) : key === 'helpfulRate' ? ratio(row.helpful, row.helpful + row.notHelpful) : row[key];
  };
  const compared = (key: Parameters<typeof metric>[1]) => ({
    value: reader.covered('current') ? metric(current, key) : null,
    previous: reader.covered('previous') ? metric(previous, key) : null,
  });
  return {
    meta: reader.meta(!current?.engaged || !vitals[0]?.samples),
    path,
    title: reader.title(path),
    kpis: {
      views: compared('views'),
      visits: compared('visits'),
      avgEngagedMs: compared('engagement'),
      avgScrollDepth: compared('scroll'),
      exitRate: compared('exitRate'),
      helpfulRate: compared('helpfulRate'),
    },
    viewsSeries: series.filter((row) => row.current).map(({ current: _current, ...row }) => row),
    previousViewsSeries: series.filter((row) => !row.current).map(({ current: _current, ...row }) => row),
    feedback: { helpful: current?.helpful ?? 0, notHelpful: current?.notHelpful ?? 0, series: reader.grid(feedback, { helpful: 0, notHelpful: 0 }) },
    channels,
    referrers,
    devices,
    languages,
    webVitals: vitalSummary(vitals[0]),
    aiCrawlers: bots,
    searchesLeadingHere: terms,
    searchTermsVisibility: reader.scope.visibility,
    nextPages: transitions.filter((row) => row.path === path).map((row) => ({ path: row.target, clicks: row.clicks })),
    previousPages: transitions.filter((row) => row.target === path).map((row) => ({ path: row.path, clicks: row.clicks })),
  };
};
