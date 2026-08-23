import type { ClickHouseClient } from '@clickhouse/client';
import { getClickHouseClient } from './client';

export type AnalyticsAvailability = 'complete' | 'partial' | 'unavailable';
export type AnalyticsRange = '24h' | '7d' | '30d' | '90d';

const RANGE_DAYS: Record<AnalyticsRange, number> = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 };
const safeTimezone = (timezone: string): string => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
    return timezone;
  } catch {
    return 'UTC';
  }
};

interface CountRow {
  value: string | number;
}
interface DimensionRow {
  key: string;
  value: string | number;
}
interface DayRow {
  date: string;
  views: string | number;
}

const json = async <T>(client: ClickHouseClient, query: string, queryParams: Record<string, unknown>): Promise<T[]> => {
  const result = await client.query({ query, query_params: queryParams, format: 'JSONEachRow' });
  return result.json<T>();
};
const num = (value: string | number | undefined): number => Number(value ?? 0);

export interface ProjectAnalyticsOverview {
  availability: AnalyticsAvailability;
  range: AnalyticsRange;
  timezone: string;
  totalViews: number | null;
  uniqueVisitors: number | null;
  timeseries: Array<{ date: string; views: number }>;
  topPages: Array<{ path: string; views: number }>;
  referrers: Array<{ referrer: string; views: number }>;
  languages: Array<{ language: string; views: number }>;
  devices: Array<{ device: string; count: number }>;
  engagement: { engagedViews: number | null; averageEngagementMs: number | null };
  searches: {
    total: number | null;
    zeroResults: number | null;
    clickedResults: number | null;
    averageLatencyMs: number | null;
    queryTerms: 'redacted';
  };
  ai: {
    answersCompleted: number | null;
    answersFailed: number | null;
    promptTokens: number | null;
    completionTokens: number | null;
    costMicros: number | null;
    averageLatencyMs: number | null;
  };
  noAnswerReasons: Array<{ reason: string; count: number }>;
}

const unavailableProjectOverview = (range: AnalyticsRange, timezone: string): ProjectAnalyticsOverview => ({
  availability: 'unavailable',
  range,
  timezone,
  totalViews: null,
  uniqueVisitors: null,
  timeseries: [],
  topPages: [],
  referrers: [],
  languages: [],
  devices: [],
  engagement: { engagedViews: null, averageEngagementMs: null },
  searches: { total: null, zeroResults: null, clickedResults: null, averageLatencyMs: null, queryTerms: 'redacted' },
  ai: { answersCompleted: null, answersFailed: null, promptTokens: null, completionTokens: null, costMicros: null, averageLatencyMs: null },
  noAnswerReasons: [],
});

export const queryProjectAnalytics = async (
  tenantId: string,
  projectId: string,
  range: AnalyticsRange,
  timezone = 'UTC',
  client: ClickHouseClient = getClickHouseClient('reader'),
): Promise<ProjectAnalyticsOverview> => {
  const tz = safeTimezone(timezone);
  const params = { tenant_id: tenantId, project_id: projectId, days: RANGE_DAYS[range], timezone: tz };
  const common = `tenant_id = {tenant_id:String} AND project_id = {project_id:String} AND hour >= toStartOfHour(now('UTC') - toIntervalDay({days:UInt16}))`;
  try {
    const [totals, visitors, days, pages, referrers, languages, devices, search, ai, noAnswer, engagement] = await Promise.all([
      json<CountRow>(
        client,
        `SELECT sum(c) AS value FROM (SELECT uniqCombined64Merge(event_ids) AS c FROM analytics_hourly WHERE ${common} AND event_name = 'page_view' GROUP BY hour, path, language, device, referrer_domain)`,
        params,
      ),
      json<CountRow>(
        client,
        `SELECT uniqCombined64Merge(sessions) AS value FROM analytics_hourly WHERE ${common} AND event_name = 'page_view'`,
        params,
      ),
      json<DayRow>(
        client,
        `SELECT date, sum(c) AS views FROM (SELECT formatDateTime(toTimeZone(hour, {timezone:String}), '%F') AS date, uniqCombined64Merge(event_ids) AS c FROM analytics_hourly WHERE ${common} AND event_name = 'page_view' GROUP BY hour, path, language, device, referrer_domain) GROUP BY date ORDER BY date`,
        params,
      ),
      json<DimensionRow>(
        client,
        `SELECT path AS key, sum(c) AS value FROM (SELECT path, hour, language, device, referrer_domain, uniqCombined64Merge(event_ids) AS c FROM analytics_hourly WHERE ${common} AND event_name = 'page_view' AND path != '' GROUP BY path, hour, language, device, referrer_domain) GROUP BY path ORDER BY value DESC LIMIT 10`,
        params,
      ),
      json<DimensionRow>(
        client,
        `SELECT referrer_domain AS key, sum(c) AS value FROM (SELECT referrer_domain, hour, path, language, device, uniqCombined64Merge(event_ids) AS c FROM analytics_hourly WHERE ${common} AND event_name = 'page_view' AND referrer_domain != '' GROUP BY referrer_domain, hour, path, language, device) GROUP BY referrer_domain ORDER BY value DESC LIMIT 8`,
        params,
      ),
      json<DimensionRow>(
        client,
        `SELECT language AS key, sum(c) AS value FROM (SELECT language, hour, path, device, referrer_domain, uniqCombined64Merge(event_ids) AS c FROM analytics_hourly WHERE ${common} AND event_name = 'page_view' AND language != '' GROUP BY language, hour, path, device, referrer_domain) GROUP BY language ORDER BY value DESC LIMIT 12`,
        params,
      ),
      json<DimensionRow>(
        client,
        `SELECT device AS key, sum(c) AS value FROM (SELECT device, hour, path, language, referrer_domain, uniqCombined64Merge(event_ids) AS c FROM analytics_hourly WHERE ${common} AND event_name = 'page_view' AND device != '' GROUP BY device, hour, path, language, referrer_domain) GROUP BY device ORDER BY value DESC`,
        params,
      ),
      json<Record<string, string | number>>(
        client,
        `SELECT
        uniqExactIf(event_id, event_name = 'search_query_submitted') AS total,
        uniqExactIf(event_id, event_name = 'search_zero_result') AS zero_results,
        uniqExactIf(event_id, event_name = 'search_result_clicked') AS clicked_results,
        sumIf(latency_ms, event_name = 'search_results_returned') AS latency_sum_value,
        countIf(event_name = 'search_results_returned' AND latency_known = 1) AS latency_samples_value
      FROM analytics_search_hourly FINAL WHERE ${common}`,
        params,
      ),
      json<Record<string, string | number>>(
        client,
        `SELECT
        uniqExactIf(event_id, event_name = 'answer_completed') AS completed,
        uniqExactIf(event_id, event_name = 'answer_failed') AS failed,
        sumIf(prompt_tokens, event_name = 'answer_completed') AS prompt_tokens,
        sumIf(completion_tokens, event_name = 'answer_completed') AS completion_tokens,
        sumIf(cost_micros, event_name = 'answer_completed') AS cost_micros,
        countIf(event_name = 'answer_completed' AND prompt_tokens_known = 1) AS prompt_tokens_samples,
        countIf(event_name = 'answer_completed' AND completion_tokens_known = 1) AS completion_tokens_samples,
        countIf(event_name = 'answer_completed' AND cost_micros_known = 1) AS cost_micros_samples,
        sumIf(latency_ms, event_name = 'answer_completed') AS latency_sum_value,
        countIf(event_name = 'answer_completed' AND latency_known = 1) AS latency_samples_value
      FROM analytics_search_hourly FINAL WHERE ${common}`,
        params,
      ),
      json<DimensionRow>(
        client,
        `SELECT no_answer_reason AS key, uniqExact(event_id) AS value FROM analytics_search_hourly FINAL WHERE ${common} AND no_answer_reason != '' GROUP BY no_answer_reason ORDER BY value DESC LIMIT 12`,
        params,
      ),
      json<Record<string, string | number>>(
        client,
        `SELECT uniqCombined64(event_id) AS engaged, avgIf(engagement_ms, engagement_ms > 0) AS average_ms FROM analytics_events FINAL WHERE tenant_id = {tenant_id:String} AND project_id = {project_id:String} AND occurred_at >= now() - toIntervalDay({days:UInt16}) AND event_name = 'page_engaged'`,
        params,
      ),
    ]);
    const searchRow = search[0] ?? {};
    const aiRow = ai[0] ?? {};
    const engagementRow = engagement[0] ?? {};
    const searchSamples = num(searchRow.latency_samples_value);
    const aiSamples = num(aiRow.latency_samples_value);
    const completedAnswers = num(aiRow.completed);
    const aiMetricsPartial =
      completedAnswers > 0 &&
      (num(aiRow.prompt_tokens_samples) < completedAnswers ||
        num(aiRow.completion_tokens_samples) < completedAnswers ||
        num(aiRow.cost_micros_samples) < completedAnswers ||
        aiSamples < completedAnswers);
    return {
      availability: aiMetricsPartial ? 'partial' : 'complete',
      range,
      timezone: tz,
      totalViews: num(totals[0]?.value),
      uniqueVisitors: num(visitors[0]?.value),
      timeseries: days.map((row) => ({ date: row.date, views: num(row.views) })),
      topPages: pages.map((row) => ({ path: row.key, views: num(row.value) })),
      referrers: referrers.map((row) => ({ referrer: row.key, views: num(row.value) })),
      languages: languages.map((row) => ({ language: row.key, views: num(row.value) })),
      devices: devices.map((row) => ({ device: row.key, count: num(row.value) })),
      engagement: {
        engagedViews: num(engagementRow.engaged),
        averageEngagementMs:
          engagementRow.average_ms === null || engagementRow.average_ms === undefined ? null : Math.round(num(engagementRow.average_ms)),
      },
      searches: {
        total: num(searchRow.total),
        zeroResults: num(searchRow.zero_results),
        clickedResults: num(searchRow.clicked_results),
        averageLatencyMs: searchSamples > 0 ? Math.round(num(searchRow.latency_sum_value) / searchSamples) : null,
        queryTerms: 'redacted',
      },
      ai: {
        answersCompleted: completedAnswers,
        answersFailed: num(aiRow.failed),
        promptTokens: completedAnswers === 0 ? 0 : num(aiRow.prompt_tokens_samples) === completedAnswers ? num(aiRow.prompt_tokens) : null,
        completionTokens:
          completedAnswers === 0 ? 0 : num(aiRow.completion_tokens_samples) === completedAnswers ? num(aiRow.completion_tokens) : null,
        costMicros: completedAnswers === 0 ? 0 : num(aiRow.cost_micros_samples) === completedAnswers ? num(aiRow.cost_micros) : null,
        averageLatencyMs: aiSamples > 0 ? Math.round(num(aiRow.latency_sum_value) / aiSamples) : null,
      },
      noAnswerReasons: noAnswer.map((row) => ({ reason: row.key, count: num(row.value) })),
    };
  } catch {
    return unavailableProjectOverview(range, tz);
  }
};

export interface WorkspaceAnalyticsOverview extends Omit<ProjectAnalyticsOverview, 'topPages' | 'languages' | 'engagement' | 'noAnswerReasons'> {
  byProject: Array<{ projectId: string; views: number }>;
  topPages: Array<{ path: string; projectId: string; views: number }>;
}

export const queryWorkspaceAnalytics = async (
  authorizedProjects: Array<{ tenantId: string; projectId: string }>,
  range: AnalyticsRange,
  timezone = 'UTC',
  client: ClickHouseClient = getClickHouseClient('reader'),
): Promise<WorkspaceAnalyticsOverview> => {
  const tz = safeTimezone(timezone);
  if (authorizedProjects.length === 0) {
    return {
      availability: 'complete',
      range,
      timezone: tz,
      totalViews: 0,
      uniqueVisitors: 0,
      timeseries: [],
      byProject: [],
      topPages: [],
      referrers: [],
      devices: [],
      searches: { total: 0, zeroResults: 0, clickedResults: 0, averageLatencyMs: null, queryTerms: 'redacted' },
      ai: { answersCompleted: 0, answersFailed: 0, promptTokens: 0, completionTokens: 0, costMicros: 0, averageLatencyMs: null },
    };
  }
  const params = {
    tenant_ids: authorizedProjects.map(({ tenantId }) => tenantId),
    project_ids: authorizedProjects.map(({ projectId }) => projectId),
    days: RANGE_DAYS[range],
    timezone: tz,
  };
  const common = `(tenant_id, project_id) IN arrayZip({tenant_ids:Array(String)}, {project_ids:Array(String)}) AND hour >= toStartOfHour(now('UTC') - toIntervalDay({days:UInt16}))`;
  try {
    const [total, visitors, days, byProject, pages, referrers, devices, search, ai] = await Promise.all([
      json<CountRow>(
        client,
        `SELECT sum(c) AS value FROM (SELECT uniqCombined64Merge(event_ids) AS c FROM analytics_hourly WHERE ${common} AND event_name = 'page_view' GROUP BY project_id, hour, path, language, device, referrer_domain)`,
        params,
      ),
      json<CountRow>(
        client,
        `SELECT uniqCombined64Merge(sessions) AS value FROM analytics_hourly WHERE ${common} AND event_name = 'page_view'`,
        params,
      ),
      json<DayRow>(
        client,
        `SELECT date, sum(c) AS views FROM (SELECT formatDateTime(toTimeZone(hour, {timezone:String}), '%F') AS date, project_id, path, language, device, referrer_domain, uniqCombined64Merge(event_ids) AS c FROM analytics_hourly WHERE ${common} AND event_name = 'page_view' GROUP BY hour, project_id, path, language, device, referrer_domain) GROUP BY date ORDER BY date`,
        params,
      ),
      json<DimensionRow>(
        client,
        `SELECT project_id AS key, sum(c) AS value FROM (SELECT project_id, hour, path, language, device, referrer_domain, uniqCombined64Merge(event_ids) AS c FROM analytics_hourly WHERE ${common} AND event_name = 'page_view' GROUP BY project_id, hour, path, language, device, referrer_domain) GROUP BY project_id ORDER BY value DESC`,
        params,
      ),
      json<Record<string, string | number>>(
        client,
        `SELECT project_id, path, sum(c) AS value FROM (SELECT project_id, path, hour, language, device, referrer_domain, uniqCombined64Merge(event_ids) AS c FROM analytics_hourly WHERE ${common} AND event_name = 'page_view' AND path != '' GROUP BY project_id, path, hour, language, device, referrer_domain) GROUP BY project_id, path ORDER BY value DESC LIMIT 10`,
        params,
      ),
      json<DimensionRow>(
        client,
        `SELECT referrer_domain AS key, sum(c) AS value FROM (SELECT referrer_domain, project_id, hour, path, language, device, uniqCombined64Merge(event_ids) AS c FROM analytics_hourly WHERE ${common} AND event_name = 'page_view' AND referrer_domain != '' GROUP BY referrer_domain, project_id, hour, path, language, device) GROUP BY referrer_domain ORDER BY value DESC LIMIT 8`,
        params,
      ),
      json<DimensionRow>(
        client,
        `SELECT device AS key, sum(c) AS value FROM (SELECT device, project_id, hour, path, language, referrer_domain, uniqCombined64Merge(event_ids) AS c FROM analytics_hourly WHERE ${common} AND event_name = 'page_view' AND device != '' GROUP BY device, project_id, hour, path, language, referrer_domain) GROUP BY device ORDER BY value DESC`,
        params,
      ),
      json<Record<string, string | number>>(
        client,
        `SELECT uniqExactIf(event_id, event_name = 'search_query_submitted') AS total, uniqExactIf(event_id, event_name = 'search_zero_result') AS zero_results, uniqExactIf(event_id, event_name = 'search_result_clicked') AS clicked_results, sumIf(latency_ms, event_name = 'search_results_returned') AS latency_sum_value, countIf(event_name = 'search_results_returned' AND latency_known = 1) AS latency_samples_value FROM analytics_search_hourly FINAL WHERE ${common}`,
        params,
      ),
      json<Record<string, string | number>>(
        client,
        `SELECT uniqExactIf(event_id, event_name = 'answer_completed') AS completed, uniqExactIf(event_id, event_name = 'answer_failed') AS failed, sumIf(prompt_tokens, event_name = 'answer_completed') AS prompt_tokens, sumIf(completion_tokens, event_name = 'answer_completed') AS completion_tokens, sumIf(cost_micros, event_name = 'answer_completed') AS cost_micros, countIf(event_name = 'answer_completed' AND prompt_tokens_known = 1) AS prompt_tokens_samples, countIf(event_name = 'answer_completed' AND completion_tokens_known = 1) AS completion_tokens_samples, countIf(event_name = 'answer_completed' AND cost_micros_known = 1) AS cost_micros_samples, sumIf(latency_ms, event_name = 'answer_completed') AS latency_sum_value, countIf(event_name = 'answer_completed' AND latency_known = 1) AS latency_samples_value FROM analytics_search_hourly FINAL WHERE ${common}`,
        params,
      ),
    ]);
    const searchRow = search[0] ?? {};
    const aiRow = ai[0] ?? {};
    const searchSamples = num(searchRow.latency_samples_value);
    const aiSamples = num(aiRow.latency_samples_value);
    const completedAnswers = num(aiRow.completed);
    const aiMetricsPartial =
      completedAnswers > 0 &&
      (num(aiRow.prompt_tokens_samples) < completedAnswers ||
        num(aiRow.completion_tokens_samples) < completedAnswers ||
        num(aiRow.cost_micros_samples) < completedAnswers ||
        aiSamples < completedAnswers);
    return {
      availability: aiMetricsPartial ? 'partial' : 'complete',
      range,
      timezone: tz,
      totalViews: num(total[0]?.value),
      uniqueVisitors: num(visitors[0]?.value),
      timeseries: days.map((row) => ({ date: row.date, views: num(row.views) })),
      byProject: byProject.map((row) => ({ projectId: row.key, views: num(row.value) })),
      topPages: pages.map((row) => ({ projectId: String(row.project_id), path: String(row.path), views: num(row.value) })),
      referrers: referrers.map((row) => ({ referrer: row.key, views: num(row.value) })),
      devices: devices.map((row) => ({ device: row.key, count: num(row.value) })),
      searches: {
        total: num(searchRow.total),
        zeroResults: num(searchRow.zero_results),
        clickedResults: num(searchRow.clicked_results),
        averageLatencyMs: searchSamples > 0 ? Math.round(num(searchRow.latency_sum_value) / searchSamples) : null,
        queryTerms: 'redacted',
      },
      ai: {
        answersCompleted: completedAnswers,
        answersFailed: num(aiRow.failed),
        promptTokens: completedAnswers === 0 ? 0 : num(aiRow.prompt_tokens_samples) === completedAnswers ? num(aiRow.prompt_tokens) : null,
        completionTokens:
          completedAnswers === 0 ? 0 : num(aiRow.completion_tokens_samples) === completedAnswers ? num(aiRow.completion_tokens) : null,
        costMicros: completedAnswers === 0 ? 0 : num(aiRow.cost_micros_samples) === completedAnswers ? num(aiRow.cost_micros) : null,
        averageLatencyMs: aiSamples > 0 ? Math.round(num(aiRow.latency_sum_value) / aiSamples) : null,
      },
    };
  } catch {
    const unavailable = unavailableProjectOverview(range, tz);
    return { ...unavailable, byProject: [], topPages: [] };
  }
};
