# Track C: analytics infrastructure and documentation

Date: 2026-11-06. Branch: `analytics/infra-docs`. Base: `da7b6ce4`.
Implementation commit: `f4026fc3` (infra/docs and this report follow separately).
No push, amend, rebase, service startup, or production change was performed.

## Delivered

- Worker starts ClickHouse database creation and pending migrations in the background.
  Opt-out: `CLICKHOUSE_MIGRATE_ON_BOOT=false`; analytics disabled also skips it.
  Retries indefinitely with 1/2/4/8/16/32/60-second capped delays, without blocking boot.
- Explicit CLI uses exactly the same locked migration path and disconnects its pool.
- PostgreSQL transaction advisory lock via `@nibleaf/database`:
  `pg_try_advisory_xact_lock(hashtextextended('nibleaf:clickhouse:migrations:' || database_name, 904712))`.
  Same Postgres database required across workers/CLI. A nonblocking acquisition
  avoids waiting under a held transaction; contention retries outside it. Failure
  releases the transaction lock. Timeout ceiling is one hour. As with any external
  DDL protected by a database lock, losing the Postgres session does not cancel an
  already submitted ClickHouse query: inspect/stop the original operation before
  manually bypassing a stuck migration.
- `getAnalyticsHealth()` probes versions, with a 750 ms total request deadline.
  Server and worker health HTTP status still follows core readiness only.
- Dev, source quickstart, production and Coolify Compose retain Alpine-compatible
  wget healthchecks, durable logs, add a backups disk/volume, 1536 MiB container
  memory, 1 GiB tracked server memory, 128 MiB mark cache, warning log rotation,
  and disable noisy system-log writes. Old system-log tables are not deleted.
- One-shot migration services are under `analytics-tools`, depend on Postgres and
  ClickHouse, and never gate app/server/worker. All runtime analytics settings are
  wired in app Compose files. Dev Compose provides backing services only.
- English/Arabic operator guides and product analytics pages are paired and navigated.
  Includes modes, privacy/consent, two-visit term threshold, crawler categories,
  erasure, TTL, failure diagnosis, backups/restoration, and upgrade guidance.
- Defaults `ANALYTICS_MODE=disabled` in Coolify and production env remain unchanged.
  Separate SELECT-only reader provisioning is documented rather than automatically
  creating/changing credentials. Existing keys were preserved.

## Health JSON contract

API `/health` retains:

```typescript
{
  status: 'ok' | 'starting' | 'shutting_down',
  service: string,
  revision: string,
  analytics: {
    configured: boolean,
    latencyMs: number | null,
    status: 'ok' | 'migrating' | 'unavailable' | 'disabled' | 'schema_outdated'
  }
}
```

Worker `/health` retains:

```typescript
{
  status: 'ok' | 'starting' | 'degraded',
  service: 'worker',
  revision: string,
  queues: { status: 'ok' | 'unavailable', workers: WorkerHealth[] },
  email: { status: 'ok' | 'misconfigured' | 'disabled', provider: string, required: boolean },
  analytics: {
    configured: boolean,
    latencyMs: number | null,
    status: 'ok' | 'migrating' | 'unavailable' | 'disabled' | 'schema_outdated'
  }
}
```

`schema_outdated` means a code migration version is missing, even if later versions
exist. Missing migration table also yields outdated; a failed probe is unavailable.
`migrating` is local process state; the separate API may report outdated until the
worker finishes. `configured=false` only when analytics mode is disabled.

## Verification actually run

- `pnpm turbo run typecheck --filter=@nibleaf/clickhouse --filter=@nibleaf/server --filter=@nibleaf/worker`
  PASS (8 tasks including dependencies).
- `pnpm --filter @nibleaf/clickhouse exec vitest run`: PASS, 34 passed / 4 skipped.
  Skips include the opt-in Postgres lock test, run separately below, and original
  ClickHouse integration tests belonging to backend integration coverage.
- `pnpm --filter @nibleaf/worker exec vitest run src/modules/system/handlers.test.ts`:
  PASS, 6 tests. Explicitly asserts core HTTP 200 across all non-ok analytics states.
- With `ANALYTICS_LOCK_INTEGRATION=1`:
  `python C:/Users/raedb/Desktop/Work/product-ops/infrastructure/shared-services/services.py run --project nibleaf-analytics-infra -- pnpm --filter @nibleaf/clickhouse exec vitest run src/initialization-lock.postgres.test.ts`:
  PASS, real Postgres transactions, contention exclusion and failure release.
- `python C:/Users/raedb/Desktop/Work/product-ops/infrastructure/shared-services/services.py run --project nibleaf-analytics-infra -- pnpm --filter @nibleaf/clickhouse migrate`:
  PASS on shared ClickHouse 26.9; applied base migrations 1,2,3.
- Same isolated namespace, `pnpm --filter @nibleaf/clickhouse exec tsx -e "import { getAnalyticsHealth, closeClickHouseClients } from './src/index.ts'; getAnalyticsHealth().then(console.log).finally(closeClickHouseClients);"`:
  actual `{ configured: true, latencyMs: 127, status: 'ok' }`.
- `npx ultracite fix <all changed paths>` then `npx ultracite check <all changed paths>`:
  PASS; Biome checks 11 supported source/JSON files. YAML, env and MDX are outside
  that configured formatter's supported scope and have separate checks below.
- `pnpm docs:check`: PASS, 32 English/Arabic pairs, 64 navigated pages.
- `docker compose -f <file> config -q`: PASS independently for docker-compose.yml,
  docker-compose.dev.yml, docker-compose.prod.yml, docker-compose.coolify.yml.
  Required inputs used synthetic validation values, never deployment credentials.
- `docker compose -f docker-compose.yml -f docker-compose.search.yml config -q`:
  PASS. Search is an existing overlay and fails standalone because it intentionally
  supplies no server/worker image; validate it merged with its base.
- `pnpm check:dead-code`: exit 1, only pre-existing unused export
  `SEARCH_TERM_VISIBILITY_THRESHOLD` in apps/server/src/actions/analytics-insights.ts:25.
  Confirmed present at da7b6ce4. No Track C findings.
- `git diff --check`: PASS.

## Merge notes and verification limits

1. Keep Track A's crawler-retention key and TTL reapplication in migrations.ts.
   This track changes only one schema property in keys.ts (`CLICKHOUSE_MIGRATE_ON_BOOT`).
   It passes `crawlerRetentionDays` from a small local validated env schema to the
   runner, so it compiles independently before Track A adds the runner option.
   TTL reapplication is Track A-owned and is not implemented or proven by this branch alone.
2. Added `@nibleaf/database` as a ClickHouse workspace dependency (three lockfile lines).
   No existing API was renamed or removed; new lifecycle exports are additive.
   Old `clickHouseHealth` remains available; server/worker use `getAnalyticsHealth`.
3. Shared services were already healthy; only namespace nibleaf-analytics-infra was
   provisioned and used. No data in master, backend-test or UI namespaces was touched.
   Namespace retained for repeatable tests; no long-lived process was started.
4. Native BACKUP/RESTORE procedure and disk configuration were checked against the
   official ClickHouse reference; no native backup/restore drill or 25.8 container
   startup was executed. Shared ClickHouse configuration was preserved. Run the
   documented isolated restore drill on deployment-equivalent 25.8 before release.
   This is source/config and local test evidence, not deployment acceptance.
5. Compose inline configs require Compose >=2.23.1. Production defaults do not
   require a ClickHouse password merely to interpolate/start the core stack while
   analytics is disabled; supply writer credentials before enabling analytics.
6. The one-hour outage/replay and shed-load guarantees remain Track A integration
   gates; this track does not claim to have validated them.
7. No browser/UI files were changed. Operator docs/JSON and automated tests are the
   equivalent evidence here; dashboard screenshots belong to Track B's PR.

## Final cleanup review

Reviewed the Track C diff from da7b6ce4, including owned tests and boot callers.
Found and corrected a health timeout risk: a 5-second optional analytics probe
could overrun a 5-second container healthcheck; it now aborts at 750 ms with a stalled
probe regression test. Simplified the start-once migration guard to one boolean.
No remaining actionable slop found in the owned diff. Checks above cover the final
code; native restore and provider deployment remain explicitly unverified.