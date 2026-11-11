# Environment-gated CI audit, 2026-11-11

Baseline: `0090ccb66` on `origin/main`, refreshed from the issue's `47ddeff6` baseline. All twelve suites were invoked with their gates enabled against real disposable services. No suite was inferred green from source inspection.

| Suite | Gate | Result on main | Issue |
| --- | --- | --- | --- |
| Git sync | `DATA_INTEGRITY_POSTGRES` | 11 pass / 1 failure; #509 reproduced | [#509](https://github.com/lord007tn/nibleaf/issues/509) |
| MCP placement | `DATA_INTEGRITY_POSTGRES` | Assertion passes; teardown FK failure | [#515](https://github.com/lord007tn/nibleaf/issues/515) |
| Asset uploads | `ASSET_UPLOADS_POSTGRES` | Shared fixture DB refused; isolated DB: 17 pass | [#516](https://github.com/lord007tn/nibleaf/issues/516) |
| GitBook rehearsal | `GITBOOK_REHEARSAL` | First run timeout; repeat: 4 pass | [#517](https://github.com/lord007tn/nibleaf/issues/517) |
| Legacy rollback setup | `LEGACY_ROLLBACK_SETUP` | Fixture lacks an administered organization | [#518](https://github.com/lord007tn/nibleaf/issues/518) |
| Legacy schema compatibility | `LEGACY_SCHEMA_COMPAT` | Missing old-code journey artifacts | [#519](https://github.com/lord007tn/nibleaf/issues/519) |
| Activation reaper | `ACTIVATION_INTEGRATION` | 3 pass | ? |
| Analytics migration lock | `ANALYTICS_LOCK_INTEGRATION` | 1 pass | ? |
| Chat budgets | `NIBLEAF_REDIS_TESTS` | 5 pass | ? |
| Analytics pipeline | `CLICKHOUSE_INTEGRATION` | 4 failures plus teardown; fixture partition mismatch | [#521](https://github.com/lord007tn/nibleaf/issues/521) |
| Qdrant client | `QDRANT_INTEGRATION_URL` | First run timeout; after readiness: 1 pass | [#520](https://github.com/lord007tn/nibleaf/issues/520) |
| Self-host restore | `SELF_HOST_RESTORE_DRILL` | 1 pass | ? |

## Setup and observed failures

Service images matched current CI: `postgres:17-alpine`, `clickhouse/clickhouse-server:25.8-alpine`, `qdrant/qdrant:v1.19.0`. CI had no Redis service; the new job uses `docker.dragonflydb.io/dragonflydb/dragonfly:v1.39.0`, also used locally with emulated cluster mode and hashtag locking. The CI service sets `DFLY_cluster_mode=emulated` and `DFLY_lock_on_hashtags=true`; omitting them in its first run caused BullMQ undeclared-key errors. That failed job ran for 107 seconds, with 31 seconds for path detection (138 seconds / 2.30 added runner minutes for the failed attempt). The green-run measurement is reported separately in the PR. Local host ports were 5562, 6562, 8562 and 6563 respectively. No application dev server was needed. Service tests used synthetic fixtures under the exclusive machine stack lock.

The existing Qdrant CI step enables the gate for **server retrieval**, then ends; it never invokes the package client suite. The analytics migration step enables ClickHouse tests in its own package, but never invokes the worker pipeline. Other gates and explicit suite paths were checked against every current workflow. None of the twelve suites had an enabled CI invocation.

Asset uploads require a fresh database: unrelated pending uploads or tombstones intentionally abort the suite. A separate migrated `nibleaf_asset_uploads_test` database passes all 17 tests on unchanged main. The integration pipeline requires both database names to be `nibleaf_analytics_test`. Its old fixture's organization id differed from the generated data partition; the write fence correctly refused the mismatched events. Correcting the fictional partition and deleting its project before its organization passes all four tests. Redis budget tests pass all five cases. Qdrant passed after readiness (8.56 seconds); the initial collection/index setup exceeded 15 seconds during concurrent setup. The real GitBook route passed on repeat (4 tests, 60.81 seconds total).

Full failure output is attached to each linked issue. #509 already contains the Git sync diagnosis, and its failure was independently reproduced. Environment/setup failures remain recorded even when a subsequent run passes.

## Rollback floor

The existing harness pins pre-organizations `8a3ce217`, which is not the supported rollback floor. The new `--rollback-floor` mode pins full revision `0a18349c9855fa9dc6961e0f28bffe1be20febe3`. It executes the pinned runtime with its own generated Prisma client and dependencies against the current migrated schema, preserving the historical mode for the older rehearsal.

The complete local floor rehearsal passed: old-code journey (1), new-code setup (1), old-code rollback scenarios (4), current compatibility checks (3). Current setup explicitly creates administered organizations. Current checks compare against the pinned PR1 resolver and preserve legitimate organization membership after website access is removed. The old-code journey uses PR1 admission actions following a real OTP sign-in; its removed Better Auth organization endpoint is used only by the historical pre-floor mode. Data partitions are verified from the actual created website rather than assuming they equal the organization.

PRs run these suites only for `packages/database/prisma/**` or `scripts/migration-safety*` changes. Release and manual Docker workflows require the reusable floor check before publication. The Docker workflow remains manual-only.

## Integration and restore coverage

One independent integration job runs Redis budgets, the analytics pipeline and Qdrant client tests in parallel with `verify`, with fresh service containers and explicit gates. It waits for Qdrant readiness. Added runner time is measured from the PR's own completed Actions job and reported in its PR body.

The restore drill runs weekly, on manual dispatch and on release tags. It creates only the isolated fixture services, verifies PostgreSQL and storage restore plus occupied-target rejection, and cleans them in `finally`. A serialized failure reporter finds the exact tracking issue title across open and closed issues, reopens it if needed and comments with the failure/run link; otherwise it creates one issue. Unit tests cover this deduplication without posting synthetic issues.
