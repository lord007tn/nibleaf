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
3. **Retention comes from env.** Register the table in `ANALYTICS_PROJECT_TABLES` (`src/tables.ts`) with `time` and `retention` (`raw` / `rollup` / `sensitive` / `conversation`, the last from `AI_CONVERSATION_RETENTION_DAYS`). Every migration run re-applies `MODIFY TTL` from the current env, with `materialize_ttl_after_modify = 0`.
4. **Erasure and rebuild come from the registry.** `deleteProjectAnalytics` deletes from every registered table except `preserve: true` entries: deletion tombstones, permanent freshness, and the views themselves. `rebuildProjectAnalyticsRollups` refills tables that declare `rebuild`. An integration test fails when any table with a `project_id` column is missing from the registry.
   - `usage_*` tables are owned by `deleteProjectUsage`.
   - AI chat tables are registered like any other: `ai_conversation_turns` and `ai_conversation_feedback` (conversation retention), `ai_usage_daily` (rollup) and the `ai_conversation_deletions` tombstones (preserved). Turn and feedback rows also carry a per-row `expires_at` that reads honour before the TTL runs.
5. **Export:** `exportProjectAnalytics` is content-free. Every new table is either exported there or explicitly listed as excluded, with the reason.
6. **Grants:** the reader role needs `SELECT` (including `analytics_deletion_tombstones`). The writer needs `INSERT` plus `SELECT` on tombstones. Erasure needs `ALTER DELETE` on every project table. Prefer database-level grants (see the self-hosting guide).

## AI chat (reader assistant)

- Reader chat events are `chat_*` payloads in `analytics_events` (`aiChatPayload` in `src/events.ts`), built by the server and sent through `trackProjectEvents`, so they get the same actor classification, consent-gated hashes, write fence, micro-batching and outage replay as every other event. They are content-free: ids, enums, counts and timings. `conversation_id`, `turn_id` and `previous_feedback` are the only chat-specific columns.
- Conversation text (questions, answers, comments) lives only in `ai_conversation_turns` / `ai_conversation_feedback`: redacted before queueing (`redactReaderText` for what people type), stored only with the project setting, an encryption key and the visitor's consent, and kept for `AI_CONVERSATION_RETENTION_DAYS`.
- Turn rows record `actor_type`; reader metrics and gaps count people only, while `ai_usage_daily` and the usage/cost totals count every turn a provider billed, automated traffic included. A turn's rewrite and suggestion calls on a separate utility model (`SEARCH_CHAT_UTILITY_MODEL`) keep their tokens and cost in `utility_*` columns, so per-model usage attributes them to that model. Each model's figures are known on their own (`tokens_known`/`cost_known` for the answer model, `utility_tokens_known`/`utility_cost_known` for the utility model); a turn's totals are known when both are. Session hashes use the same `ANALYTICS_HASH_SALT` scheme as `analytics_events`.
- Deleting one conversation writes a tombstone, then removes its turns, feedback and `chat_*` events and rebuilds only that conversation's `ai_usage_daily` days, never a day whose turns may already have expired.

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
