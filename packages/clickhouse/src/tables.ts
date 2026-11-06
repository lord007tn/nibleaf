/** The single inventory for erasure, retention and rebuild. Views are included
 * so a system.tables audit cannot silently omit a future project projection.
 * Tombstones are permanent and must never be erased with their project. */
export interface AnalyticsProjectTable {
  name: string;
  time?: string;
  retention?: 'raw' | 'rollup' | 'sensitive';
  rebuild?: string;
  preserve?: boolean;
}
const scope = `tenant_id = {tenant_id:String} AND project_id = {project_id:String}
  AND (tenant_id, project_id) NOT IN (SELECT tenant_id, project_id FROM analytics_deletion_tombstones FINAL)`;

/** Batch snapshots, deliberately not additive materialized views. Every sum,
 * session boundary and quantile is derived from FINAL facts. Retried inserts
 * cannot inflate them. Rebuild while raw coverage exists; keep older buckets.
 * Readers use raw facts until snapshot freshness/coverage can be proven. */
export const insightsRollups = [
  {
    name: 'analytics_pages_hourly',
    time: 'hour',
    dimensions: 'hour, path',
    columns: `hour DateTime('UTC'), path String, views UInt64, visits UInt64,
      engaged_ms UInt64, engaged_samples UInt64, scroll_sum UInt64, helpful UInt64, not_helpful UInt64`,
    select: `SELECT tenant_id, project_id, toStartOfHour(occurred_at) AS hour, path,
      countIf(event_name = 'page_view') AS views, uniqExactIf(session_hash, event_name = 'page_view') AS visits,
      sumIf(engagement_ms, event_name = 'page_engaged') AS engaged_ms, countIf(event_name = 'page_engaged') AS engaged_samples,
      sumIf(scroll_depth, event_name = 'page_engaged') AS scroll_sum,
      countIf(feedback = 'helpful' AND feedback_target = 'page') AS helpful,
      countIf(feedback = 'not_helpful' AND feedback_target = 'page') AS not_helpful
      FROM analytics_events FINAL WHERE ${scope} AND actor_type = 'human'
      GROUP BY tenant_id, project_id, hour, path`,
  },
  {
    name: 'analytics_sessions',
    time: 'day',
    dimensions: 'day, session_hash',
    columns: `day Date, session_hash FixedString(64), first_at DateTime64(3, 'UTC'), last_at DateTime64(3, 'UTC'),
      landing_page String, exit_page String, pageviews UInt64, engaged_ms UInt64, max_scroll UInt8`,
    select: `SELECT tenant_id, project_id, toDate(min(occurred_at)) AS day, assumeNotNull(session_hash) AS session_hash,
      min(occurred_at) AS first_at, max(occurred_at) AS last_at,
      argMinIf(path, tuple(occurred_at, event_id), event_name = 'page_view') AS landing_page,
      argMaxIf(path, tuple(occurred_at, event_id), event_name = 'page_view') AS exit_page,
      countIf(event_name = 'page_view') AS pageviews, sumIf(engagement_ms, event_name = 'page_engaged') AS engaged_ms,
      max(scroll_depth) AS max_scroll FROM analytics_events FINAL
      WHERE ${scope} AND actor_type = 'human' AND session_hash IS NOT NULL
      GROUP BY tenant_id, project_id, session_hash`,
  },
  {
    name: 'analytics_web_vitals_hourly',
    time: 'hour',
    dimensions: 'hour, path, device',
    columns: `hour DateTime('UTC'), path String, device LowCardinality(String), samples UInt64,
      lcp AggregateFunction(quantileTDigestIf(0.75), UInt32, UInt8),
      inp AggregateFunction(quantileTDigestIf(0.75), UInt32, UInt8),
      cls AggregateFunction(quantileTDigestIf(0.75), UInt32, UInt8),
      fcp AggregateFunction(quantileTDigestIf(0.75), UInt32, UInt8),
      ttfb AggregateFunction(quantileTDigestIf(0.75), UInt32, UInt8)`,
    select: `SELECT tenant_id, project_id, toStartOfHour(occurred_at) AS hour, path, device, count() AS samples,
      ${['lcp', 'inp', 'cls', 'fcp', 'ttfb'].map((vital) => `quantileTDigestIfState(0.75)(toUInt32(ifNull(${vital === 'cls' ? 'cls_milli' : `${vital}_ms`}, 0)), isNotNull(${vital === 'cls' ? 'cls_milli' : `${vital}_ms`})) AS ${vital}`).join(', ')}
      FROM analytics_events FINAL WHERE ${scope} AND actor_type = 'human' AND event_name = 'web_vitals'
      GROUP BY tenant_id, project_id, hour, path, device`,
  },
  {
    name: 'analytics_crawlers_hourly',
    time: 'hour',
    dimensions: 'hour, path, bot_name, crawled_resource, status_code',
    columns: `hour DateTime('UTC'), path String, bot_name LowCardinality(String), crawled_resource LowCardinality(String),
      status_code UInt16, bot_operator LowCardinality(String), bot_category LowCardinality(String),
      verification LowCardinality(String), requests UInt64, last_seen_at DateTime64(3, 'UTC')`,
    select: `SELECT tenant_id, project_id, toStartOfHour(occurred_at) AS hour, path, bot_name, crawled_resource, status_code,
      any(bot_operator), any(bot_category), any(verification), count(), max(occurred_at)
      FROM analytics_events FINAL WHERE ${scope} AND actor_type = 'bot' AND event_name = 'crawler_request'
      GROUP BY tenant_id, project_id, hour, path, bot_name, crawled_resource, status_code`,
  },
  {
    name: 'analytics_referrals_hourly',
    time: 'hour',
    dimensions: 'hour, path, channel, ai_source',
    columns: `hour DateTime('UTC'), path String, channel LowCardinality(String), ai_source LowCardinality(String),
      views UInt64, visits UInt64`,
    select: `SELECT tenant_id, project_id, toStartOfHour(occurred_at) AS hour, path, channel, ai_source,
      count(), uniqExact(session_hash) FROM analytics_events FINAL
      WHERE ${scope} AND actor_type = 'human' AND event_name = 'page_view'
      GROUP BY tenant_id, project_id, hour, path, channel, ai_source`,
  },
];

export const ANALYTICS_PROJECT_TABLES: readonly AnalyticsProjectTable[] = [
  { name: 'analytics_events', time: 'occurred_at', retention: 'raw' },
  { name: 'analytics_sensitive_queries', time: 'occurred_at', retention: 'sensitive' },
  { name: 'analytics_deletion_tombstones', preserve: true },
  {
    name: 'analytics_daily',
    time: 'day',
    retention: 'rollup',
    rebuild: `SELECT toDate(occurred_at) AS day, tenant_id, project_id, event_name, path, language, device, referrer_domain,
        uniqCombined64State(event_id) AS event_ids, uniqCombined64State(session_hash) AS sessions
      FROM analytics_events FINAL
      WHERE tenant_id = {tenant_id:String} AND project_id = {project_id:String}
        AND (tenant_id, project_id) NOT IN (SELECT tenant_id, project_id FROM analytics_deletion_tombstones FINAL)
      GROUP BY day, tenant_id, project_id, event_name, path, language, device, referrer_domain`,
  },
  { name: 'analytics_daily_mv', preserve: true },
  {
    name: 'analytics_search_daily',
    time: 'day',
    retention: 'rollup',
    rebuild: `SELECT toDate(occurred_at), tenant_id, project_id, event_id, received_at, event_name, provider, model, cache_status, no_answer_reason,
        latency_ms, latency_known, result_count, prompt_tokens, completion_tokens, cost_micros, prompt_tokens_known, completion_tokens_known, cost_micros_known
      FROM analytics_events FINAL
      WHERE tenant_id = {tenant_id:String} AND project_id = {project_id:String}
        AND (tenant_id, project_id) NOT IN (SELECT tenant_id, project_id FROM analytics_deletion_tombstones FINAL)
        AND (event_name LIKE 'search_%' OR event_name LIKE 'answer_%' OR event_name LIKE 'citation_%')`,
  },
  { name: 'analytics_search_daily_mv', preserve: true },
  {
    name: 'analytics_hourly',
    time: 'hour',
    retention: 'rollup',
    rebuild: `SELECT toStartOfHour(occurred_at) AS hour, tenant_id, project_id, event_name, path, language, device, referrer_domain,
        uniqCombined64State(event_id) AS event_ids, uniqCombined64State(session_hash) AS sessions
      FROM analytics_events FINAL
      WHERE tenant_id = {tenant_id:String} AND project_id = {project_id:String}
        AND (tenant_id, project_id) NOT IN (SELECT tenant_id, project_id FROM analytics_deletion_tombstones FINAL)
      GROUP BY hour, tenant_id, project_id, event_name, path, language, device, referrer_domain`,
  },
  { name: 'analytics_hourly_mv', preserve: true },
  {
    name: 'analytics_search_hourly',
    time: 'hour',
    retention: 'rollup',
    rebuild: `SELECT toStartOfHour(occurred_at), tenant_id, project_id, event_id, received_at, event_name, provider, model, cache_status, no_answer_reason,
        latency_ms, latency_known, result_count, prompt_tokens, completion_tokens, cost_micros, prompt_tokens_known, completion_tokens_known, cost_micros_known
      FROM analytics_events FINAL
      WHERE tenant_id = {tenant_id:String} AND project_id = {project_id:String}
        AND (tenant_id, project_id) NOT IN (SELECT tenant_id, project_id FROM analytics_deletion_tombstones FINAL)
        AND (event_name LIKE 'search_%' OR event_name LIKE 'answer_%' OR event_name LIKE 'citation_%')`,
  },
  { name: 'analytics_search_hourly_mv', preserve: true },
  ...insightsRollups.map((table) => ({ name: table.name, time: table.time, retention: 'rollup' as const, rebuild: table.select })),
];
