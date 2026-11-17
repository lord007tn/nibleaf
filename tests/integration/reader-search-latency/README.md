# Reader search latency (P1-PUB-002)

This local benchmark exercises `searchSite` inside Hono request context against a
real PostgreSQL publication and the real Orama indexes, language merge and section
projection. It seeds one fictional 300-page EN/AR site. It never reads customer
data or calls an embedding provider. A pending analytics sink verifies that logging
does not hold the response open.

The nine query entries reproduce the audit's wording and order: `custom domain`,
`publsh`, `zzqxv`, `نطاق`, `promo code`, `zzqxv`, `الحجوزات`, `reservation`, `install`.
The two `zzqxv` entries represent the two audited sites; this fixture searches one
fictional site for both. Typos and snippets retain their existing behavior.

## Measurements

Each scenario runs seven rounds, discards two warm-up rounds, and measures 45
requests. Percentiles use the nearest-rank method. Timing starts before publication
resolution and ends after search action completion; it excludes HTTP transport and
JSON serialization. Before uses the runtime source from `b50e2e38`; after uses the
updated runtime on top of `2cf12d3fe`. The relevant search code on main did not
change between those revisions. Runs occurred on the same machine, before and
after the session resumed, so normal-case differences also include machine load.

| Seeded local scenario | Before p50 | After p50 | Before p95 | After p95 |
| --- | ---: | ---: | ---: | ---: |
| Readiness immediately unavailable | 15.3 ms | 5.4 ms | 16.6 ms | 15.2 ms |
| Controlled 700 ms readiness delay | 711.7 ms | 91.7 ms | 724.6 ms | 93.4 ms |

The initial cold index build was 314.6 ms before and 258.3 ms after. The under-200-ms
result applies to warm p50; this change does not promise cold-start latency below
200 ms. All 18 scenario/query result hashes match before/after, including order,
scores and snippets. The benchmark also asserts stable results across measured
rounds. Per-query percentiles and result hashes are in [before.json](before.json)
and [after.json](after.json). `benchmark.ts` now also writes every measured
request's timing (`samplesMs` per query), so a fresh run's percentiles can be
recomputed. The receipts committed here are from the original run, before that
field existed, so they carry percentiles and sample counts, not the raw timings.

![Seeded local latency comparison](latency.png)

The controlled delay demonstrates the request-path defect, not the exact cause of
the production audit's 690–1019 ms observations. No production requests were made.
An embedding/provider/transport breakdown for those original requests remains
unknown. The new public API `Server-Timing: search;dur=...` header makes server
duration observable without changing the JSON response.

## Cause and change

Hybrid mode previously awaited readiness, live provider configuration, embedding
and vector retrieval before trying keywords. Those operations could hold the
response for their complete timeouts. Keywords now start independently, and all
optional hybrid work shares an 80 ms budget. Fast hybrid results retain the existing
relevance gate and ranking; timeout or failure uses the existing keyword fallback.
Cancellation aborts provider/vector HTTP work, and late uncancellable lookups
cannot start an embedding request. Answer/chat readiness still checks live state.

The reader now calls the same-origin public API directly, removing the server
function and its loopback request. The API still owns publication, access grants,
rate limits and consent-aware analytics. The hook's hit array and per-hit search ID
are unchanged. Debounce is 120 ms, and previous results still use placeholder data.
The dialog's markup and interaction semantics are unchanged.

Analytics was already asynchronous; failures now produce a content-free warning.
Prisma and keyword indexes were already reused. Fixture EXPLAIN used a backward
scan of `deployment_projectId_version_key` (0.050 ms execution); no additional
index or product migration was justified.

## Reproduce locally

Build workspace dependencies first. Before any build, suite or fixture start on a
shared machine, verify at least 8 GB free RAM and CPU below 70%. Use one worker and
one fixture stack. Do not load a project `.env` or point this fixture at production.

From the repository root, in PowerShell:

```powershell
docker compose -p nibleaf-search-latency -f tests/integration/reader-search-latency/compose.yaml up -d --wait
$env:POSTGRES_URL = 'postgresql://user:passer@127.0.0.1:55463/reader_search_latency'
pnpm --filter @nibleaf/database exec prisma migrate deploy
pnpm exec vitest run --config tests/integration/reader-search-latency/vitest.config.ts
```

The database URL and database-name assertion are fixed to this disposable fixture.
The benchmark writes ignored receipts to `output/search-latency/after.json`.

To compare the old runtime, temporarily extract only that source beside its
relative imports, run the identical harness, then delete the scratch file:

```powershell
git show b50e2e38:apps/server/src/lib/ai-search/runtime.ts | Set-Content -Encoding utf8 apps/server/src/lib/ai-search/runtime.before.ts
$env:SEARCH_BENCH_BASELINE = '1'
pnpm exec vitest run --config tests/integration/reader-search-latency/vitest.config.ts
Remove-Item Env:SEARCH_BENCH_BASELINE
Remove-Item -LiteralPath apps/server/src/lib/ai-search/runtime.before.ts
```

Always clean up the owned fixture and its volume afterward:

```powershell
docker compose -p nibleaf-search-latency -f tests/integration/reader-search-latency/compose.yaml down -v
Remove-Item Env:POSTGRES_URL
```

No application server is needed. The completed run removed its container, network
and volume. No shared backing services were stopped or changed.

## Verification scope

Recovery tests cover pending readiness/configuration/embedding/vector requests,
deadline cleanup, cancellation, errors, fast hybrid ranking and lexical filtering.
Existing reader relevance and private/granted-language tests remain authoritative.
Transport tests cover scope, current consent, response shape, cancellation and API
errors. Existing dialog/hook tests cover previous results, localized routing,
keyboard selection and cold opening.

The latency graph and measured receipts are the visual evidence for this timing
change. A dialog screenshot would show the same markup; a browser recording was
not produced because this fixture uses an in-process handler without a running app.
Browser transport timing, private-site cookies through deployed proxies, and
production acceptance remain outside these local measurements.
