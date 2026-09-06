# BullMQ v5 scheduler migration and v6 release

The v5 migration executables are intentionally absent from this v6 source tree.
Run every v5 command below only from the retained staged-v5 checkout/image with
its original BullMQ 5 dependencies. Never copy or run that operator with v6.
Before deploying v6, require the v5 dry-run to confirm all four schedulers and
no legacy definitions, then verify actual scheduled execution on staged v5.
The v6 application validates existing IDs, cron, UTC, data and job options
before upserting; an unknown or unmigrated definition blocks that startup path.
Fresh installations create the same four stable scheduler IDs.


Perform this transition while every producer and worker still uses BullMQ v5.
The staged application recognizes existing platform repeats and leaves them
alone at startup. Fresh queues create Job Schedulers using stable IDs. Startup
never recreates a legacy repeat once migrated.

Use the existing Redis environment configuration and run from the repository
root. Commands print platform schedule status only, never connection details.

1. Deploy this staged v5 release. Keep its image available for rollback.
2. Run `pnpm exec tsx packages/bullmq/scripts/migrate-schedules.ts` to inventory
   the four platform schedules. Unknown IDs, cron patterns, timezones, data,
   or job options require investigation; do not bypass the refusal.
3. Stop all processes that schedule these jobs and pause the analytics/export
   queues using the operator's existing queue controls. Wait for active jobs
   to finish and ensure there are no ready/paused jobs. Do not drain user jobs.
4. Run `pnpm exec tsx packages/bullmq/scripts/migrate-schedules.ts --apply`.
   It creates and verifies every destination before removing the exact known
   legacy definitions. On failure leave queues paused, investigate, and rerun;
   the operation supports partial-migration recovery.
5. Run the dry-run again: all four entries must show `scheduler: true` and
   `legacy: false`. Resume queues and restart the staged v5 processes; verify
   another dry-run and actual scheduled execution before upgrading BullMQ.

Do not run concurrent migration operators. Queue pause prevents job execution,
not another operator or an old process from recreating schedules. All scheduling
processes must remain stopped during apply/rollback. The tool never automatically
pauses, resumes, drains, or deletes arbitrary jobs.

## Rollback

The preferred rollback image is the retained staged v5 release, which understands Job
Schedulers. Rolling back to an older image that still creates legacy repeats
requires restoring legacy definitions first: stop scheduling processes, pause
the affected queues, wait for no active/ready jobs, then run the same command
with `--rollback --apply`. Verify a dry-run shows all four `legacy: true` and
`scheduler: false` before starting the older v5 image and resuming queues.
Do not run this rollback tool after upgrading its dependency to BullMQ v6.

## Disposable integration verification

Set `SCHEDULE_TEST_REDIS_URL` to an isolated Redis/Dragonfly test endpoint and run
`pnpm exec tsx packages/bullmq/scripts/verify-schedules.ts`. The runner uses UUID
queue names, never flushes a database, and deletes only its own test queues.
It exercises dry-run, both startup paths, migration/retry, rollback/retry, and
remigration against real v5 storage.

With the same isolated endpoint, run
`pnpm exec tsx packages/bullmq/scripts/verify-schedule-dry-run.ts` to compare all
keys, serialized values, and TTLs before and after the actual default operator
command. TTL comparison accounts for elapsed time; only its own expiring
synthetic key is created and cleaned. Operator Queue clients disable BullMQ's
automatic metadata write during construction.

See the [official BullMQ upgrade sequence](https://docs.bullmq.io/guide/migrations/migrate-from-v5-to-v6).
