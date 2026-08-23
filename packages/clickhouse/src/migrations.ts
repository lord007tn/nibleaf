import type { ClickHouseClient } from '@clickhouse/client';

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
];

export interface MigrationOptions {
  rawRetentionDays: number;
  rollupRetentionDays: number;
  sensitiveRetentionDays: number;
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
  for (const migration of migrations) {
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
  return completed;
};
