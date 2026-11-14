# CI critical path

Measured on 2026-11-14 from the last ten successful `push` runs on `main` of
`ci.yml`. Cancelled and failed runs are excluded. Workflow elapsed time is
`updatedAt - createdAt` from `gh run list`; required-job elapsed time is
`completed_at - started_at` from the jobs API. These include provider scheduling
and teardown, so sums of step medians do not equal the workflow median.

The workflow median is **1,211.5 seconds (20m 11.5s)**, range 914?1,333 seconds.
The `Typecheck, lint & test` job median is **1,189.5 seconds (19m 49.5s)**.
[Raw per-step measurements](ci-performance-baseline.csv) retain run IDs, source
SHAs and UTC timestamps. Run URLs can be reconstructed from those IDs.

| Run | Workflow | Required job |
| --- | ---: | ---: |
| [43608098952](https://github.com/lord007tn/nibleaf/actions/runs/43608098952) | 15m 23s | 15m 21s |
| [43605337993](https://github.com/lord007tn/nibleaf/actions/runs/43605337993) | 21m 13s | 21m 11s |
| [43602250938](https://github.com/lord007tn/nibleaf/actions/runs/43602250938) | 19m 16s | 18m 54s |
| [43599003467](https://github.com/lord007tn/nibleaf/actions/runs/43599003467) | 15m 14s | 15m 11s |
| [43597064798](https://github.com/lord007tn/nibleaf/actions/runs/43597064798) | 22m 03s | 21m 59s |
| [43594125364](https://github.com/lord007tn/nibleaf/actions/runs/43594125364) | 18m 25s | 18m 06s |
| [43583586274](https://github.com/lord007tn/nibleaf/actions/runs/43583586274) | 21m 07s | 20m 45s |
| [43578964746](https://github.com/lord007tn/nibleaf/actions/runs/43578964746) | 21m 58s | 21m 54s |
| [43570847514](https://github.com/lord007tn/nibleaf/actions/runs/43570847514) | 15m 18s | 15m 16s |
| [43563021358](https://github.com/lord007tn/nibleaf/actions/runs/43563021358) | 22m 13s | 21m 55s |

| Serial step / group | Median seconds | Implication |
| --- | ---: | --- |
| Test | 480 | Split app into four shards, server into two, and run other packages separately |
| Growth tests, serial | 189.5 | Dedicated runner; keep package/file execution serial |
| Build production app | 48.5 | Build, runtime smoke and budgets together on a separate runner |
| Typecheck | 47.5 | Run beside tests, with lint and repository checks |
| Private reader access | 38 | Independent PostgreSQL content group |
| Concurrent page moves | 26 | Same content group, still serial against its database |
| ClickHouse migrations | 22.5 | Same content group with its own ClickHouse service |
| Setup Node (includes pnpm restore) | 20.5 | Preserve pnpm cache; use shallow checkouts except history-dependent checks |
| Install dependencies | 6 | Too small to justify a serial install/artifact fan-out barrier |

All ten logs restored the same pnpm store key with no misses in this sample.
Turbo's summaries showed local dependency-build hits, but no cross-run remote
cache. The unit-test task had 5 cached / 25 total tasks in each sampled run;
those five were dependency builds, rather than cached test results.

## Structure and coverage

- Static checks retain full Git history for migration, translation baseline and
  release-note checks. Installer/provider-safety tests still precede installation.
- Six app/server shards use the unchanged package test scripts and Vitest's
  complete `index/count` partitions, with two workers per runner. All other
  workspaces remain covered by a Turbo exclusion filter, with two packages and
  one Vitest worker per package. No `passWithNoTests`, retries, changed-file
  filters or timing-threshold changes are introduced.
- Two independent PostgreSQL runners each migrate a fresh database and retain
  the migration/smoke assertions. Within each group the original integration
  steps stay serial. The content group also owns its ClickHouse service; pending
  asset uploads retain their separate fresh database. Server/worker dependency
  builds are performed once up front per database runner instead of replaying
  builds inside multiple suites.
- Growth tests retain `turbo --concurrency=1` and the package-level single-worker,
  no-file-parallelism commands. Importer performance follows on the same idle
  runner with one worker. No other job shares that runner's CPU.
- App and admin builds retain runtime smoke assertions, bundle module analysis,
  budget enforcement and report uploads. No Docker image builds are added.
- The existing Redis/ClickHouse/Qdrant pipeline job retains all assertions. Its
  ready Qdrant service also runs the existing indexed search/chat fixture suite.
- Every independent job starts immediately. Per-job pnpm installs are intentional:
  a cached 6-second install costs less critical-path time than waiting for a
  shared workspace artifact. The composite setup keeps versions and generation
  commands consistent. Existing Turbo output caching stays local to each job;
  no environment-dependent test result or production output is restored across
  runs without a complete input/environment audit.
- PR concurrency cancels superseded runs. Main uses a commit-specific group and
  is not cancelled by later merges, keeping each revision's source-CI receipt
  available to the release gate.

## Required check

The final `verify` job is still named exactly **Typecheck, lint & test**. It uses
`always()` and directly needs all CI groups, including the existing pipeline and
rollback jobs. Every result must be `success`; only `rollback-floor` may be
`skipped`, after its successful detector explicitly returned `required=false`.
Failed/cancelled/skipped matrix children fail the matrix result and therefore
fail this check. No protection settings change.

The exact embedded `jq` predicate was executed locally against 68 result maps:
all green, each dependency failing/cancelling/skipping with rollback required or
not required, and missing/invalid detector outputs. Only green maps and the
explicitly unnecessary rollback skip passed. This is a **dry-run failure proof**,
not a deliberately broken GitHub Actions run. Provider check-name and success
observations are recorded in the PR alongside the two validation runs.

## What applies from T3 Code

The inspected revision is `1e9f93a48e231db3ccc5bcde6c5d84a00d5b9e9a`.

- [CI workflow](https://github.com/pingdotgg/t3code/blob/1e9f93a48e231db3ccc5bcde6c5d84a00d5b9e9a/.github/workflows/ci.yml): separate lint/build/test
  jobs, app/server sharding, `fail-fast: false`, PR-only cancellation and an
  `always()` final `Check` job. Nibleaf adopts those patterns and keeps its own
  required name. T3 Code's server uses eight weighted shards and its web uses
  two; Nibleaf starts with four app/two server native Vitest partitions based on
  its measured unit-test dominance.
- [Dependency setup](https://github.com/pingdotgg/t3code/blob/1e9f93a48e231db3ccc5bcde6c5d84a00d5b9e9a/.github/actions/setup-ci-deps/action.yml): one
  shared setup action, version/policy-keyed pnpm caches, and no dependency on a
  serial preparation job. Nibleaf keeps `setup-node`'s existing lockfile cache
  and centralizes the repeated runtime generation commands.
- [Package scripts](https://github.com/pingdotgg/t3code/blob/1e9f93a48e231db3ccc5bcde6c5d84a00d5b9e9a/package.json),
  [Vite+ config](https://github.com/pingdotgg/t3code/blob/1e9f93a48e231db3ccc5bcde6c5d84a00d5b9e9a/vite.config.ts),
  [task-cache config](https://github.com/pingdotgg/t3code/blob/1e9f93a48e231db3ccc5bcde6c5d84a00d5b9e9a/.task-cache.json), and
  [cached-test runner](https://github.com/pingdotgg/t3code/blob/1e9f93a48e231db3ccc5bcde6c5d84a00d5b9e9a/scripts/test-cached.ts): current T3 Code uses
  Vite+, not Turbo. Its private remote task cache, cache-hit verification and
  weighted test machinery require infrastructure Nibleaf does not have. Those
  are not copied; no new secrets or paid runners are introduced.
- [Workspace policy](https://github.com/pingdotgg/t3code/blob/1e9f93a48e231db3ccc5bcde6c5d84a00d5b9e9a/pnpm-workspace.yaml): pnpm remains the workspace
  installer, but its runtime and lockfile-verification caches target pnpm 12 and
  Vite+; Nibleaf uses pnpm 10 and should retain its own lockfile/install policy.
- T3 Code's affected-job graph fails open and still runs full Linux CI on main.
  Nibleaf's many fixture, generation and cross-workspace dependencies need a
  separate dependency audit before it is safe to skip assertions. This change
  keeps every existing suite on every run, apart from the pre-existing rollback
  path condition. Blacksmith runner choices and desktop/mobile system packages
  do not apply to Nibleaf's existing GitHub-hosted Linux budget.

## Risks and verification limits

Parallel jobs consume more runner minutes and can queue under account concurrency
limits. Native Vitest partitions balance file counts rather than historical cost,
so the slowest shard can drift as tests change. PostgreSQL grouping removes
accidental fixture sharing, which is checked by real CI rather than assumed.
Timing assertions can still flake on hosted machines; thresholds and retry policy
are unchanged. Provider CI observations, per-job durations and before/after
comparisons belong in the PR, because later source changes and runner load can
change them. This is a CI-only change, so product screenshots/video provide no
meaningful evidence; jobs, logs, the coverage audit and failure dry run are the
verification artifacts.
