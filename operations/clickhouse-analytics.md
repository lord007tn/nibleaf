# ClickHouse analytics operations

Postgres owns the core product. ClickHouse availability must not gate API or
worker readiness. Keep ingestion queues intact during outages and monitor their
oldest pending job, retries and failed jobs independently of core health.

## Health contract

API `/health` includes `status`, `service`, `revision` and `analytics`. Worker
`/health` also includes `queues: { status, workers }` and
`email: { status, provider, required }`. The analytics field is:

```typescript
{
  configured: boolean,
  latencyMs: number | null,
  status: 'ok' | 'migrating' | 'unavailable' | 'disabled' | 'schema_outdated'
}
```

| Analytics status | Meaning / response |
| --- | --- |
| `disabled` | ANALYTICS_MODE is disabled; configured is false and latency is null. |
| `ok` | Every migration version in the running code is recorded. This does not prove event delivery. |
| `migrating` | The local worker is attempting schema migration; latency is null. |
| `schema_outdated` | A migration version or the migration table is missing. Check worker migration logs and permissions. |
| `unavailable` | Connection, authentication or schema probe failed. Restore connectivity and let queued work retry. |

Probes share a cached result, including failures, for ten seconds per process.
Concurrent callers share the same pending probe. Each probe has a 750 ms deadline.
Local migration state overrides the cache immediately; migration completion
invalidates the cache. Another API process may report outdated until its next
probe after worker migration. API core status remains ok/starting/shutting_down;
worker core status remains ok/starting/degraded based on queues and required email.
Analytics status does not change their HTTP 200/503 readiness decision.

With ClickHouse enabled, missing ANALYTICS_HASH_SALT drops events even if schema
health is ok. Restore the existing salt; generate one only for a new installation.
Identity/visits require granted or not_required consent. Denied/unknown events
still contribute content-free page-view and search counts without identity hashes.
Origin crawler capture cannot see requests answered entirely by a CDN/edge cache.

## Boot migration and lock behavior

When analytics is enabled and CLICKHOUSE_MIGRATE_ON_BOOT=true, the worker creates
the database if absent and runs pending migrations in the background. Migration
runs also apply the current retention settings. Core boot never awaits this work.
Retry delays are 1, 2, 4, 8, 16, 32, then at most 60 seconds, including lock contention.

The worker and CLI share a PostgreSQL transaction advisory lock through
@nibleaf/database. The key is hashtextextended of
`nibleaf:clickhouse:migrations:<CLICKHOUSE_DATABASE>` with seed 904712. Every
worker/CLI must use the same Postgres database. Acquisition is nonblocking;
only the lock holder submits DDL. The transaction releases on completion, failure
or connection closure, with a one-hour ceiling. Never bypass the lock by deleting
migration records or launching unlocked DDL. A lost Postgres session does not
cancel an already submitted ClickHouse query: inspect both systems before retrying
manually. Check pg_stat_activity, pg_locks, system.processes and system.mutations.

The runtime writer role alone (INSERT plus tombstone SELECT) cannot migrate.
Provision schema privileges for boot migration, or disable it and use a dedicated
migration identity. Readers need SELECT on the analytics database, including
analytics_deletion_tombstones. Erasure needs ALTER DELETE on every project table;
use database-wide grants to cover new tables. See the role examples in
[analytics operations](../docs/self-hosting/clickhouse-analytics.mdx).

## Explicit migrations

For the standard self-hosted production stack, from its deployment directory:

```bash
docker compose -f docker-compose.prod.yml --profile analytics-tools run --rm analytics-migrate
```

For the source-build quickstart, use docker-compose.yml instead. A generated
installer directory may name its production definition docker-compose.yml. The
one-shot service waits for Postgres and ClickHouse; core app services never depend
on its success. Lock contention makes the explicit command fail; rerun after the
holder finishes. From a configured source checkout:

```bash
pnpm --filter @nibleaf/clickhouse migrate
```

Set POSTGRES_URL and matching ClickHouse writer/migration credentials securely.
In Coolify, use its generated deployment definition or run `./docker-entrypoint.sh
clickhouse-migrate` in the deployed image through the platform terminal. Do not
pass the repository's Coolify-only file directly to the plain Compose CLI.

## Configuration compatibility

The Coolify definition uses its documented file-creation bind mount with content,
source ./clickhouse/nibleaf.xml and target
/etc/clickhouse-server/config.d/nibleaf.xml. Plain Compose rejects that extension;
Coolify materializes it. Standard Compose files retain inline configs and require
Compose >=2.23.1. Keep log and backup volumes durable when replacing containers.

The XML uses a 1 GiB server memory budget, 128 MiB mark cache, disabled
uncompressed cache, and warning logs rotating at 10M with three retained files.
These limits bound resources; they are not a capacity guarantee. Disabled system
log sections stop new writes, but do not reclaim existing tables. Review old
system tables explicitly and never remove data-volume files by hand.

The following references establish compatibility with ClickHouse 25.8:

- [Pinned 25.8 server config](https://github.com/ClickHouse/ClickHouse/blob/v25.8.1.5101-lts/programs/server/config.xml)
  defines logger level/size/count, max_server_memory_usage, uncompressed_cache_size
  and mark_cache_size (the latter in a commented example), and all removed log
  sections: query_log, query_thread_log, trace_log, text_log, metric_log,
  asynchronous_metric_log, part_log, processors_profile_log, session_log (optional),
  query_views_log, error_log and crash_log.
- [Pinned 25.8 settings declarations](https://github.com/ClickHouse/ClickHouse/blob/v25.8.1.5101-lts/src/Core/ServerSettings.cpp)
  define the three memory/cache values as server settings.
- [Configuration merging documentation](https://clickhouse.com/docs/operations/configuration-files)
  describes remove attributes. The [25.8 config parser](https://github.com/ClickHouse/ClickHouse/blob/v25.8.1.5101-lts/src/Common/Config/ConfigProcessor.cpp)
  checks attribute presence, so remove="1" is supported, including optional log sections.
- [Native disk backup documentation](https://clickhouse.com/docs/operations/backup/disk)
  defines storage_configuration/disks/backups/type=local/path and backups/allowed_disk.
  [25.8 backup disk registration](https://github.com/ClickHouse/ClickHouse/blob/v25.8.1.5101-lts/src/Backups/registerBackupEnginesFileAndDisk.cpp)
  checks backups.allowed_disk for the Disk engine; allowed_path is for the File engine.
- [Coolify Compose documentation](https://coolify.io/docs/knowledge-base/docker/compose)
  specifies the bind source/target/content extension used by the hosted definition.

## Backup and isolated restore drill

Use an operator SQL client with securely supplied credentials. Choose a unique
backup name and record the application revision, ClickHouse version, schema,
retention values, role grants and counts/distinct event ids for the recovery set.
The configured disk backups maps /var/lib/clickhouse/backups to a separate volume.

```sql
BACKUP DATABASE nibleaf_analytics TO Disk('backups', 'analytics-recovery-001');
SELECT name, status, error FROM system.backups;
```

Require BACKUP_CREATED. Archive that backup volume, encrypt it, record checksums
and copy it off-host with separate access control. A separate volume on the same
full physical disk does not protect against host/disk loss. Back up Postgres and
object storage separately; analytics backups do not contain core business data.

On an isolated host with the same ClickHouse version and backups disk definition,
copy the backup files into its backups volume. Keep production disconnected and
restore to a fresh database:

```sql
RESTORE DATABASE nibleaf_analytics AS nibleaf_analytics_restore
FROM Disk('backups', 'analytics-recovery-001');
SELECT name, status, error FROM system.backups;
SELECT count(), uniqExact(event_id) FROM nibleaf_analytics_restore.analytics_events;
SELECT version FROM nibleaf_analytics_restore.analytics_schema_migrations FINAL ORDER BY version;
```

Require RESTORED. Match counts and sampled event ids to the manifest. Configure
CLICKHOUSE_DATABASE=nibleaf_analytics_restore and an isolated POSTGRES_URL, run
migrations, then verify tenant/project-scoped reads and deletion filtering. Replay
all project erasures since the recovery point before allowing application access.
Preserve existing keys and salts. Retain evidence of the recovered schema/data;
a successful BACKUP command alone does not establish recovery readiness.

Restore to the original server version before taking a supported upgrade path.
Automatic additive migrations do not downgrade schemas. Pin releases and perform
the drill before changing the serving server or retention windows.

## What is safe to lose

Analytics rollups can be rebuilt with rebuildProjectAnalyticsRollups from raw
facts that remain within retention. Losing raw events leaves permanent gaps;
expired facts cannot reconstruct older rollups. Sensitive public query text is
intentionally short-lived and is not reconstructed. Losing that text is compatible
with retention policy; retaining old backups must not bypass deletion/retention
obligations. Do not apply these analytics assumptions to billing/usage tables or
core Postgres records. Do not clear ingestion queues to free disk: they may hold
the only remaining copy of pending facts.
