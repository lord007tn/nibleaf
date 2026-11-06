# @nibleaf/clickhouse

ClickHouse analytics for Nibleaf: event model, schema migrations, ingestion transport, erasure, and the read models behind the docs-owner insights dashboard. Operators: see `docs/self-hosting/clickhouse-analytics.mdx` and `operations/clickhouse-analytics.md`.

## Conventions for new events

1. **Add a payload, not a column bag.** Add the event name to `analyticsEventNames` and a strict zod payload to `analyticsPayloadSchema` (`src/events.ts`). Then map its fields in `eventToClickHouseRow` (`src/client.ts`).
2. **Server builds the envelope.** Every event goes through `buildAnalyticsEvent(input, context)`. Tenant, project, source, `actor_type`/bot fields, `channel`/`ai_source`, hashes and redaction are derived on the server, never taken from a request body. Only payloads listed in `publicAnalyticsEventSchema` may come from browsers. Server-only events (`crawler_request`, search lifecycle, AI answers) are emitted by server code.
3. **Identity follows consent.** `session_hash` and `anonymous_user_hash` exist only with consent `granted` or `not_required`. They are HMACs of `ANALYTICS_HASH_SALT`, scoped to `tenant:project`. Never store raw identifiers, IPs, prompts or free text in `analytics_events`.
4. **Text that people type is sensitive.** Search text lives only in `analytics_sensitive_queries`: public sites, explicit project opt-in, consent `granted` or `not_required`. It is normalised with `normalizeSearchTerm` (redacts emails, URLs and digit runs of 6 or more) and kept for `CLICKHOUSE_SENSITIVE_RETENTION_DAYS`. Readers only see a term once `SEARCH_TERM_VISIBILITY_THRESHOLD` distinct visits used it, and that rule is enforced in SQL.
5. **Human by default.** Reader metrics filter `actor_type = 'human'`. Bots are kept for AI visibility and retained for `CLICKHOUSE_CRAWLER_RETENTION_DAYS`.
6. **Idempotent ids.** Retried producers use `deterministicAnalyticsEventId(scope)`. `analytics_events` is a `ReplacingMergeTree` on `event_id`, and readers query it with `FINAL`, so retries never double-count.
7. **Write through the fence.** Runtime writers hold the tenant analytics write fence (`runWithTenantAnalyticsWriteFence` in `@nibleaf/database`). They call `insertAnalyticsEvents`, which also drops events of tombstoned projects. The worker micro-batches track jobs and acks a job only after its batch is durably inserted.

## Conventions for new tables

1. **Migrations are append-only and date-versioned.** Append to `migrations` in `src/migrations.ts` with a new `YYYYMMDDNN` version (for example `2026110605`). Never edit an applied migration. Workstreams may append concurrently, so keep versions unique and resolve ordering conflicts by appending.
2. **Shape:** `tenant_id LowCardinality(String), project_id String` lead the `ORDER BY`, and the table has a time column with a TTL.
3. **Retention comes from env.** Register the table in `ANALYTICS_PROJECT_TABLES` (`src/tables.ts`) with `time` and `retention` (`raw` / `rollup` / `sensitive`). Every migration run re-applies `MODIFY TTL` from the current env, with `materialize_ttl_after_modify = 0`.
4. **Erasure and rebuild come from the registry.** `deleteProjectAnalytics` deletes from every registered table except `preserve: true` entries: deletion tombstones, permanent freshness, and the views themselves. `rebuildProjectAnalyticsRollups` refills tables that declare `rebuild`. An integration test fails when any table with a `project_id` column is missing from the registry.
   - `usage_*` tables are owned by `deleteProjectUsage`.
   - `ai_conversation*` tables are currently exempt, pending the AI chat work. Register them here too, or erase them from the same tenant-erasure orchestrator (`packages/auth/src/tenant-erasure.ts`) and keep the test exemption narrow.
5. **Export:** `exportProjectAnalytics` is content-free. Every new table is either exported there or explicitly listed as excluded, with the reason.
6. **Grants:** the reader role needs `SELECT` (including `analytics_deletion_tombstones`). The writer needs `INSERT` plus `SELECT` on tombstones. Erasure needs `ALTER DELETE` on every project table. Prefer database-level grants (see the self-hosting guide).

## Conventions for reads

- Scope every query by `tenant_id` and `project_id`. Check the deletion tombstone once per request (`readInsightsProjectStatus`), not once per subquery.
- `null` means unknown (not collected, unavailable, out of retention), never zero. Mark responses `partial` when a metric covers only part of the data, and compute each rate over the rows that can support it.
- A ClickHouse failure returns the empty shape with `availability: 'unavailable'`, never a 500. When reads are disabled by `ANALYTICS_MODE`, the response is `not_configured`.
- Series are complete bucket grids in the requested timezone (`InsightsReader.grid`). Custom ranges compare equal local calendar days, so DST is handled.
- Insights responses are cached for 30 s per tenant, project, endpoint and query. `invalidateInsightsCache` runs on erasure.

## Testing

- Unit: `pnpm --filter @nibleaf/clickhouse exec vitest run`
- Integration (needs ClickHouse and PostgreSQL): set `CLICKHOUSE_INTEGRATION=1`, then `pnpm --filter @nibleaf/clickhouse migrate`, then `pnpm --filter @nibleaf/clickhouse test`
- Dev data (refuses `NODE_ENV=production`): `pnpm --filter @nibleaf/clickhouse seed:demo -- --tenant <orgId> --project <projectId> --days 60`
