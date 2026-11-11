# Page-tree council regression evidence

Recorded locally on 2026-11-11. Blocked source: `960ba7c9`.
Integrated implementation: `b27d5d79` (includes main through `cd45e6fe`).
The evidence-only commit containing this file does not change tested code.

The final four council regression files were copied into a detached worktree
at the blocked revision, without implementation changes. All 14 council
regressions failed there: 12 client tests and two PostgreSQL tests. All pass
with the integrated implementation.

| Item | Failure on blocked source | Passing coverage after repair |
| --- | --- | --- |
| 1. Stale move intent | Language-wide request assertion failed. Two real blocked PostgreSQL requests completed, but one page returned to root. Both requests with the same stale structure revision were accepted. | One narrow request assertion and two PostgreSQL cases: both independent moves survive, sibling positions are contiguous, paths are correct; an explicit stale revision returns typed 409. |
| 2. Rollback and pending state | Overlapping failures left an optimistic move applied; rollback replaced a newer refetch and cached fields; another observer missed pending state; handles remained available. | Four hook tests plus one tree test: lifecycle serialization, server truth after both rejections, preserved refetch/newer fields, shared pending state, blocked move controls and visible explanation. |
| 3. Focus | All three focus assertions failed after collapsed-parent nesting, deletion and filtered rename. | Three regression cases pass. The seven unchanged #425 rename tests also pass. |
| 4. Feedback | Both outcome tests heard saved wording during preview. | Two sequences pass: preview, pending, then saved success or restored failure. All 12 catalogs have the six new IDs and Paraglide setup passes. |
| 5. Benchmark assertion | The guard failed because no elapsed-time expectation existed. This does not claim old code exceeded the new budget. | The guard and real six-expansion timing harness pass with a 1,500 ms limit on each expansion. |

Client reproduction:

```text
pnpm --filter @nibleaf/app test src/components/editor/page-tree-council.test.tsx src/components/editor/page-tree-performance.guard.test.ts src/hooks/api/mutations.page-moves.test.tsx --maxWorkers=1
```

PostgreSQL reproduction uses `DATA_INTEGRITY_POSTGRES=1`, a migrated isolated
test database and:

```text
pnpm --filter @nibleaf/server exec vitest run src/actions/data-integrity.postgres.test.ts -t council --maxWorkers=1
```

The two PostgreSQL requests are observed waiting behind a real database lock
before its release. Synthetic authorized editors share a stale tree. Their
test-only compatibility envelope supplies both narrow fields and legacy items
so the same test executes on the old implementation and demonstrates its
actual overwrite. The fixed server chooses the intent; the editor sends only
the narrow operation. No production database or development stack was used.

Integrated checks passed:

- All-package typecheck: 27 successful tasks.
- Editor and API tests: 69 files, 779 tests.
- Server pages/address and MCP tests: four files, 156 tests, including anchored
  and legacy bulk subtree redirect/link preservation.
- Real PostgreSQL: 14 data-integrity tests and two #426 address-atomicity tests.
- Biome on 36 changed text files with LF endings; `git diff --check`.
- Dead-code check; root scripts: 173 passed, 28 platform-dependent skips.
- App production build and bundle check: public docs 334.28 KiB gzip against
  337.01 KiB. Optional module-boundary analysis was not enabled.

Standalone jsdom timing: first expansion 140.2 ms; five warm expansions in run
order 96.6, 76.2, 82.7, 74.6 and 72.0 ms; warm median 76.2 ms. The owner's
Chromium evidence and media are preserved separately. Local timings do not
establish production performance or final assistive-technology acceptance.

Cleanup review removed one unused helper export. No remaining actionable
cleanup findings were found in the council-owned changes.
