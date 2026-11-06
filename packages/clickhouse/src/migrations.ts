import type { ClickHouseClient } from '@clickhouse/client';
import { aiConversationMigrations } from './ai-conversations';
import { keys } from './keys';
import { ANALYTICS_PROJECT_TABLES, insightsRollups } from './tables';

export interface ClickHouseMigration {
  version: number;
  name: string;
  statements: string[];
}

export const migrations: ClickHouseMigration[] = [
  {
    version: 1,
    name: 'analytics_events_v1',
    statements: [
      `CREATE TABLE IF NOT EXISTS analytics_schema_migrations (
        version UInt32,
        name String,
        applied_at DateTime64(3, 'UTC') DEFAULT now64(3)
      ) ENGINE = ReplacingMergeTree(applied_at) ORDER BY version`,
      `CREATE TABLE IF NOT EXISTS analytics_events (
        event_id UUID,
        schema_version UInt16,
        occurred_at DateTime64(3, 'UTC'),
        received_at DateTime64(3, 'UTC'),
        tenant_id LowCardinality(String),
        project_id String,
        site_id String,
        deployment_id Nullable(String),
        source LowCardinality(String),
        consent_state LowCardinality(String),
        visibility LowCardinality(String),
        event_name LowCardinality(String),
        session_hash Nullable(FixedString(64)),
        anonymous_user_hash Nullable(FixedString(64)),
        path String,
        target_path String,
        placement LowCardinality(String),
        referrer_domain LowCardinality(String),
        language LowCardinality(String),
        country LowCardinality(String),
        device LowCardinality(String),
        utm_source LowCardinality(String),
        utm_medium LowCardinality(String),
        utm_campaign String,
        utm_content String,
        utm_term String,
        operation_id String,
        source_type LowCardinality(String),
        format LowCardinality(String),
        outcome_reason LowCardinality(String),
        item_count UInt64,
        result_count UInt32,
        result_position UInt16,
        result_id String,
        feedback LowCardinality(String),
        feedback_target LowCardinality(String),
        provider LowCardinality(String),
        model LowCardinality(String),
        cache_status LowCardinality(String),
        no_answer_reason LowCardinality(String),
        citation_id String,
        citation_position UInt16,
        duration_ms UInt64,
        engagement_ms UInt64,
        scroll_depth UInt8,
        latency_ms UInt64,
        latency_known UInt8,
        prompt_tokens UInt64,
        completion_tokens UInt64,
        cost_micros UInt64,
        prompt_tokens_known UInt8,
        completion_tokens_known UInt8,
        cost_micros_known UInt8,
        query_hash Nullable(FixedString(64)),
        query_length UInt16,
        query_token_count UInt16
      ) ENGINE = ReplacingMergeTree(received_at)
      PARTITION BY toYYYYMM(occurred_at)
      ORDER BY (tenant_id, project_id, event_id)
      TTL occurred_at + toIntervalDay({raw_retention_days:UInt16}) DELETE
      SETTINGS index_granularity = 8192`,
      `CREATE TABLE IF NOT EXISTS analytics_sensitive_queries (
        event_id UUID,
        tenant_id LowCardinality(String),
        project_id String,
        occurred_at DateTime64(3, 'UTC'),
        query_text String CODEC(ZSTD(3))
      ) ENGINE = ReplacingMergeTree(occurred_at)
      PARTITION BY toYYYYMM(occurred_at)
      ORDER BY (tenant_id, project_id, event_id)
      TTL occurred_at + toIntervalDay({sensitive_retention_days:UInt16}) DELETE`,
      `CREATE TABLE IF NOT EXISTS analytics_daily (
        day Date,
        tenant_id LowCardinality(String),
        project_id String,
        event_name LowCardinality(String),
        path String,
        language LowCardinality(String),
        device LowCardinality(String),
        referrer_domain LowCardinality(String),
        event_ids AggregateFunction(uniqCombined64, UUID),
        sessions AggregateFunction(uniqCombined64, Nullable(FixedString(64)))
      ) ENGINE = AggregatingMergeTree
      PARTITION BY toYYYYMM(day)
      ORDER BY (tenant_id, project_id, day, event_name, language, device, referrer_domain, path)
      TTL day + toIntervalDay({rollup_retention_days:UInt16}) DELETE`,
      `CREATE MATERIALIZED VIEW IF NOT EXISTS analytics_daily_mv TO analytics_daily AS
      SELECT
        toDate(occurred_at) AS day,
        tenant_id,
        project_id,
        event_name,
        path,
        language,
        device,
        referrer_domain,
        uniqCombined64State(event_id) AS event_ids,
        uniqCombined64State(session_hash) AS sessions
      FROM analytics_events
      GROUP BY day, tenant_id, project_id, event_name, path, language, device, referrer_domain`,
      `CREATE TABLE IF NOT EXISTS analytics_search_daily (
        day Date,
        tenant_id LowCardinality(String),
        project_id String,
        event_id UUID,
        received_at DateTime64(3, 'UTC'),
        event_name LowCardinality(String),
        provider LowCardinality(String),
        model LowCardinality(String),
        cache_status LowCardinality(String),
        no_answer_reason LowCardinality(String),
        latency_ms UInt64,
        latency_known UInt8,
        result_count UInt32,
        prompt_tokens UInt64,
        completion_tokens UInt64,
        cost_micros UInt64,
        prompt_tokens_known UInt8,
        completion_tokens_known UInt8,
        cost_micros_known UInt8
      ) ENGINE = ReplacingMergeTree(received_at)
      PARTITION BY toYYYYMM(day)
      ORDER BY (tenant_id, project_id, day, event_name, provider, model, cache_status, no_answer_reason, event_id)
      TTL day + toIntervalDay({rollup_retention_days:UInt16}) DELETE`,
      `CREATE MATERIALIZED VIEW IF NOT EXISTS analytics_search_daily_mv TO analytics_search_daily AS
      SELECT
        toDate(occurred_at) AS day,
        tenant_id,
        project_id,
        event_id,
        received_at,
        event_name,
        provider,
        model,
        cache_status,
        no_answer_reason,
        latency_ms,
        latency_known,
        result_count,
        prompt_tokens,
        completion_tokens,
        cost_micros,
        prompt_tokens_known,
        completion_tokens_known,
        cost_micros_known
      FROM analytics_events
      WHERE event_name LIKE 'search_%' OR event_name LIKE 'answer_%' OR event_name LIKE 'citation_%'
      `,
    ],
  },
  {
    version: 2,
    name: 'timezone_safe_hourly_rollups',
    statements: [
      `CREATE TABLE IF NOT EXISTS analytics_hourly (
        hour DateTime('UTC'),
        tenant_id LowCardinality(String),
        project_id String,
        event_name LowCardinality(String),
        path String,
        language LowCardinality(String),
        device LowCardinality(String),
        referrer_domain LowCardinality(String),
        event_ids AggregateFunction(uniqCombined64, UUID),
        sessions AggregateFunction(uniqCombined64, Nullable(FixedString(64)))
      ) ENGINE = AggregatingMergeTree
      PARTITION BY toYYYYMM(hour)
      ORDER BY (tenant_id, project_id, hour, event_name, language, device, referrer_domain, path)
      TTL hour + toIntervalDay({rollup_retention_days:UInt16}) DELETE`,
      `CREATE MATERIALIZED VIEW IF NOT EXISTS analytics_hourly_mv TO analytics_hourly AS
      SELECT
        toStartOfHour(occurred_at) AS hour,
        tenant_id,
        project_id,
        event_name,
        path,
        language,
        device,
        referrer_domain,
        uniqCombined64State(event_id) AS event_ids,
        uniqCombined64State(session_hash) AS sessions
      FROM analytics_events
      GROUP BY hour, tenant_id, project_id, event_name, path, language, device, referrer_domain`,
      `CREATE TABLE IF NOT EXISTS analytics_search_hourly (
        hour DateTime('UTC'),
        tenant_id LowCardinality(String),
        project_id String,
        event_id UUID,
        received_at DateTime64(3, 'UTC'),
        event_name LowCardinality(String),
        provider LowCardinality(String),
        model LowCardinality(String),
        cache_status LowCardinality(String),
        no_answer_reason LowCardinality(String),
        latency_ms UInt64,
        latency_known UInt8,
        result_count UInt32,
        prompt_tokens UInt64,
        completion_tokens UInt64,
        cost_micros UInt64,
        prompt_tokens_known UInt8,
        completion_tokens_known UInt8,
        cost_micros_known UInt8
      ) ENGINE = ReplacingMergeTree(received_at)
      PARTITION BY toYYYYMM(hour)
      ORDER BY (tenant_id, project_id, hour, event_name, provider, model, cache_status, no_answer_reason, event_id)
      TTL hour + toIntervalDay({rollup_retention_days:UInt16}) DELETE`,
      `CREATE MATERIALIZED VIEW IF NOT EXISTS analytics_search_hourly_mv TO analytics_search_hourly AS
      SELECT
        toStartOfHour(occurred_at) AS hour,
        tenant_id,
        project_id,
        event_id,
        received_at,
        event_name,
        provider,
        model,
        cache_status,
        no_answer_reason,
        latency_ms,
        latency_known,
        result_count,
        prompt_tokens,
        completion_tokens,
        cost_micros,
        prompt_tokens_known,
        completion_tokens_known,
        cost_micros_known
      FROM analytics_events
      WHERE event_name LIKE 'search_%' OR event_name LIKE 'answer_%' OR event_name LIKE 'citation_%'`,
    ],
  },
  {
    version: 3,
    name: 'provider_neutral_usage_metering',
    statements: [
      `CREATE TABLE IF NOT EXISTS usage_events (
        event_id UUID,
        schema_version UInt16,
        occurred_at DateTime64(3, 'UTC'),
        received_at DateTime64(3, 'UTC'),
        tenant_id LowCardinality(String),
        project_id String,
        meter_key LowCardinality(String),
        quantity Int64,
        kind LowCardinality(String),
        correction_of_event_id Nullable(UUID),
        source LowCardinality(String),
        late UInt8
      ) ENGINE = ReplacingMergeTree(received_at)
      PARTITION BY toYYYYMM(occurred_at)
      ORDER BY (tenant_id, project_id, meter_key, event_id)
      TTL occurred_at + toIntervalDay({raw_retention_days:UInt16}) DELETE
      SETTINGS index_granularity = 8192`,
      `CREATE TABLE IF NOT EXISTS usage_hourly (
        hour DateTime('UTC'),
        tenant_id LowCardinality(String),
        project_id String,
        meter_key LowCardinality(String),
        quantity Decimal(38, 0),
        event_count UInt64,
        reconciled_at DateTime64(3, 'UTC')
      ) ENGINE = ReplacingMergeTree(reconciled_at)
      PARTITION BY toYYYYMM(hour)
      ORDER BY (tenant_id, project_id, meter_key, hour)
      TTL hour + toIntervalDay({rollup_retention_days:UInt16}) DELETE`,
      `CREATE TABLE IF NOT EXISTS usage_deletion_tombstones (
        tenant_id LowCardinality(String),
        project_id String,
        deleted_at DateTime64(3, 'UTC'),
        reason LowCardinality(String)
      ) ENGINE = ReplacingMergeTree(deleted_at)
      ORDER BY (tenant_id, project_id)`,
      `CREATE TABLE IF NOT EXISTS analytics_deletion_tombstones (
        tenant_id LowCardinality(String),
        project_id String,
        deleted_at DateTime64(3, 'UTC'),
        reason LowCardinality(String)
      ) ENGINE = ReplacingMergeTree(deleted_at)
      ORDER BY (tenant_id, project_id)`,
      `CREATE TABLE IF NOT EXISTS usage_reconciliation_state (
        tenant_id LowCardinality(String),
        project_id String,
        period_start DateTime('UTC'),
        period_end DateTime('UTC'),
        status LowCardinality(String),
        source_received_through DateTime64(3, 'UTC'),
        updated_at DateTime64(3, 'UTC')
      ) ENGINE = ReplacingMergeTree(updated_at)
      PARTITION BY toYYYYMM(period_start)
      ORDER BY (tenant_id, project_id, period_start, period_end)
      TTL period_end + toIntervalDay({rollup_retention_days:UInt16}) DELETE`,
      `CREATE TABLE IF NOT EXISTS usage_reconciliation_coverage (
        tenant_id LowCardinality(String),
        project_id String,
        period_start DateTime('UTC'),
        period_end DateTime('UTC'),
        event_count UInt64,
        fact_received_through DateTime64(3, 'UTC'),
        reconciled_at DateTime64(3, 'UTC')
      ) ENGINE = ReplacingMergeTree(reconciled_at)
      PARTITION BY toYYYYMM(period_start)
      ORDER BY (tenant_id, project_id, period_start, period_end)
      TTL period_end + toIntervalDay({rollup_retention_days:UInt16}) DELETE`,
    ],
  },
  {
    version: 2_026_110_601,
    name: 'reader_actor_search_and_web_vitals',
    statements: [
      `ALTER TABLE analytics_events
        ADD COLUMN IF NOT EXISTS actor_type LowCardinality(String) DEFAULT if(device = 'bot', 'bot', 'human'),
        ADD COLUMN IF NOT EXISTS bot_name LowCardinality(String) DEFAULT '',
        ADD COLUMN IF NOT EXISTS bot_operator LowCardinality(String) DEFAULT '',
        ADD COLUMN IF NOT EXISTS bot_category LowCardinality(String) DEFAULT '',
        ADD COLUMN IF NOT EXISTS verification LowCardinality(String) DEFAULT 'claimed',
        ADD COLUMN IF NOT EXISTS channel LowCardinality(String) DEFAULT 'direct',
        ADD COLUMN IF NOT EXISTS ai_source LowCardinality(String) DEFAULT '',
        ADD COLUMN IF NOT EXISTS search_id String DEFAULT '',
        ADD COLUMN IF NOT EXISTS lcp_ms Nullable(UInt32),
        ADD COLUMN IF NOT EXISTS inp_ms Nullable(UInt32),
        ADD COLUMN IF NOT EXISTS cls_milli Nullable(UInt32),
        ADD COLUMN IF NOT EXISTS fcp_ms Nullable(UInt32),
        ADD COLUMN IF NOT EXISTS ttfb_ms Nullable(UInt32),
        ADD COLUMN IF NOT EXISTS crawled_resource LowCardinality(String) DEFAULT '',
        ADD COLUMN IF NOT EXISTS status_code UInt16 DEFAULT 0`,
    ],
  },
  {
    version: 2_026_110_602,
    name: 'deduplicated_insights_snapshots',
    statements: insightsRollups.map(
      (table) => `CREATE TABLE IF NOT EXISTS ${table.name} (
      tenant_id LowCardinality(String), project_id String, ${table.columns}
    ) ENGINE = MergeTree
      PARTITION BY toYYYYMM(${table.time})
      ORDER BY (tenant_id, project_id, ${table.dimensions})
      TTL ${table.time} + toIntervalDay({rollup_retention_days:UInt16}) DELETE`,
    ),
  },
  {
    version: 2_026_110_603,
    name: 'crawler_response_content_type',
    statements: ["ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS content_type LowCardinality(String) DEFAULT ''"],
  },
  {
    version: 2_026_110_604,
    name: 'human_only_legacy_projections',
    statements: [
      'DROP VIEW IF EXISTS analytics_daily_mv',
      `CREATE MATERIALIZED VIEW IF NOT EXISTS analytics_daily_mv TO analytics_daily AS
      SELECT
        toDate(occurred_at) AS day,
        tenant_id,
        project_id,
        event_name,
        path,
        language,
        device,
        referrer_domain,
        uniqCombined64State(event_id) AS event_ids,
        uniqCombined64State(session_hash) AS sessions
      FROM analytics_events WHERE actor_type = 'human'
      GROUP BY day, tenant_id, project_id, event_name, path, language, device, referrer_domain`,
      'DROP VIEW IF EXISTS analytics_search_daily_mv',
      `CREATE MATERIALIZED VIEW IF NOT EXISTS analytics_search_daily_mv TO analytics_search_daily AS
      SELECT
        toDate(occurred_at) AS day,
        tenant_id,
        project_id,
        event_id,
        received_at,
        event_name,
        provider,
        model,
        cache_status,
        no_answer_reason,
        latency_ms,
        latency_known,
        result_count,
        prompt_tokens,
        completion_tokens,
        cost_micros,
        prompt_tokens_known,
        completion_tokens_known,
        cost_micros_known
      FROM analytics_events
      WHERE actor_type = 'human' AND (event_name LIKE 'search_%' OR event_name LIKE 'answer_%' OR event_name LIKE 'citation_%')
      `,
      'DROP VIEW IF EXISTS analytics_hourly_mv',
      `CREATE MATERIALIZED VIEW IF NOT EXISTS analytics_hourly_mv TO analytics_hourly AS
      SELECT
        toStartOfHour(occurred_at) AS hour,
        tenant_id,
        project_id,
        event_name,
        path,
        language,
        device,
        referrer_domain,
        uniqCombined64State(event_id) AS event_ids,
        uniqCombined64State(session_hash) AS sessions
      FROM analytics_events WHERE actor_type = 'human'
      GROUP BY hour, tenant_id, project_id, event_name, path, language, device, referrer_domain`,
      'DROP VIEW IF EXISTS analytics_search_hourly_mv',
      `CREATE MATERIALIZED VIEW IF NOT EXISTS analytics_search_hourly_mv TO analytics_search_hourly AS
      SELECT
        toStartOfHour(occurred_at) AS hour,
        tenant_id,
        project_id,
        event_id,
        received_at,
        event_name,
        provider,
        model,
        cache_status,
        no_answer_reason,
        latency_ms,
        latency_known,
        result_count,
        prompt_tokens,
        completion_tokens,
        cost_micros,
        prompt_tokens_known,
        completion_tokens_known,
        cost_micros_known
      FROM analytics_events
      WHERE actor_type = 'human' AND (event_name LIKE 'search_%' OR event_name LIKE 'answer_%' OR event_name LIKE 'citation_%')`,
    ],
  },
  {
    version: 2_026_110_605,
    name: 'project_human_activity_watermark',
    statements: [
      `CREATE TABLE IF NOT EXISTS analytics_project_activity (
        tenant_id LowCardinality(String), project_id String, last_human_event_at DateTime64(3, 'UTC')
      ) ENGINE = ReplacingMergeTree(last_human_event_at) ORDER BY (tenant_id, project_id)`,
      `CREATE MATERIALIZED VIEW IF NOT EXISTS analytics_project_activity_mv TO analytics_project_activity AS
        SELECT tenant_id, project_id, max(received_at) AS last_human_event_at FROM analytics_events
        WHERE actor_type = 'human' AND (tenant_id, project_id) NOT IN
          (SELECT tenant_id, project_id FROM analytics_deletion_tombstones FINAL)
        GROUP BY tenant_id, project_id`,
      `INSERT INTO analytics_project_activity SELECT tenant_id, project_id, max(received_at)
        FROM analytics_events FINAL WHERE actor_type = 'human' AND (tenant_id, project_id) NOT IN
          (SELECT tenant_id, project_id FROM analytics_deletion_tombstones FINAL)
        GROUP BY tenant_id, project_id`,
    ],
  },
];

export interface MigrationOptions {
  rawRetentionDays: number;
  rollupRetentionDays: number;
  sensitiveRetentionDays: number;
  crawlerRetentionDays?: number;
}

export const runClickHouseMigrations = async (client: ClickHouseClient, options: MigrationOptions): Promise<number[]> => {
  await client.command({
    query: `CREATE TABLE IF NOT EXISTS analytics_schema_migrations (
      version UInt32, name String, applied_at DateTime64(3, 'UTC') DEFAULT now64(3)
    ) ENGINE = ReplacingMergeTree(applied_at) ORDER BY version`,
  });
  const result = await client.query({ query: 'SELECT version FROM analytics_schema_migrations FINAL', format: 'JSONEachRow' });
  const appliedRows = await result.json<{ version: number }>();
  const applied = new Set(appliedRows.map((row) => Number(row.version)));
  const completed: number[] = [];
  for (const migration of [...migrations, ...aiConversationMigrations]) {
    if (applied.has(migration.version)) continue;
    for (const statement of migration.statements) {
      await client.command({
        query: statement,
        query_params: {
          raw_retention_days: options.rawRetentionDays,
          rollup_retention_days: options.rollupRetentionDays,
          sensitive_retention_days: options.sensitiveRetentionDays,
        },
      });
    }
    await client.insert({
      table: 'analytics_schema_migrations',
      format: 'JSONEachRow',
      values: [{ version: migration.version, name: migration.name }],
    });
    completed.push(migration.version);
  }
  // Re-apply current retention even when no schema migration is pending. Do
  // not materialize old parts here: that would turn a config edit into a costly
  // synchronous rewrite. Background merges enforce the new policy.
  const crawlerDays = options.crawlerRetentionDays ?? keys().CLICKHOUSE_CRAWLER_RETENTION_DAYS;
  const periods = { raw: options.rawRetentionDays, rollup: options.rollupRetentionDays, sensitive: options.sensitiveRetentionDays };
  for (const table of ANALYTICS_PROJECT_TABLES) {
    if (!table.time || !table.retention) continue;
    const days = periods[table.retention];
    await client.command({
      query: `ALTER TABLE ${table.name} MODIFY TTL ${table.time} + toIntervalDay(${table.name === 'analytics_events' ? "if(actor_type = 'bot', {crawler_days:UInt16}, {days:UInt16})" : '{days:UInt16}'}) DELETE`,
      query_params: { days, crawler_days: crawlerDays },
      clickhouse_settings: { materialize_ttl_after_modify: 0 },
    });
  }
  for (const [table, column, days] of [
    ['usage_events', 'occurred_at', options.rawRetentionDays],
    ['usage_hourly', 'hour', options.rollupRetentionDays],
    ['usage_reconciliation_state', 'period_end', options.rollupRetentionDays],
    ['usage_reconciliation_coverage', 'period_end', options.rollupRetentionDays],
  ] as const) {
    await client.command({
      query: `ALTER TABLE ${table} MODIFY TTL ${column} + toIntervalDay({days:UInt16}) DELETE`,
      query_params: { days },
      clickhouse_settings: { materialize_ttl_after_modify: 0 },
    });
  }
  return completed;
};
