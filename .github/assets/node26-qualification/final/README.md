# Final Node 26 and shutdown acceptance

Base: `52de4bc2851660192ec7567c2f81549f350c11fb` (merged #389).
Code: `4ea0472b618b5a7c7bcf8fcd028ab7c76b3c155e`.
Image: `nibleaf-runtime:390-final`, identity
`sha256:ef5e9375f38817d8b8ace049620299a0f83de267c32db8a5d9b409991adfd6b3`.
Actual runtime: Node **26.13.0**, Alpine **3.24.4**.
Evidence-only follow-ups change `.github`, excluded from the image context.
No publication or deployment occurred.

The Node 26 digest and pinned standalone pnpm are retained. pnpm lives in a
separate `build-tools` stage; the runner inherits the base directly and retains
#389's package-manager/compiler pruning, direct entrypoints and docs guard.
The image audit passed 18 artifacts, 1,403 package records, installed documented
executables/subcommands and zero forbidden tooling. The production source audit
and unfiltered Trivy 0.76.2 vulnerability scan both report zero findings. Trivy
uses the prior frozen vulnerability DB; historical Scout/native findings remain
tracked in #195 and development deepmerge in #361 until 2027-02-08.

## Execution and compatibility

- All 27 typecheck tasks, lint, dead-code, docs (47 commands), the complete
  test command (25 successful Turbo tasks), and all 12 forced workspace
  build/setup tasks passed with zero build cache hits.
- CI-mode bundle budget and module boundaries passed: public docs **338.28 KiB
  gzip**, budget **340.04 KiB**.
- Fresh owned PostgreSQL namespace: 46 migrations, runtime smoke, three
  migration-upgrade/rollback smokes, three tenant-fence tests, 21 auth tests,
  267 server tests across 19 files and five worker tests passed.
- The PostgreSQL tenant/auth/server/worker suites also passed inside this exact
  image on fresh `nibleaf_node26_final_image_test`, with CI's `shadow_read`
  analytics mode (267 server tests in a single passing 19-file run).
- ClickHouse: all 148 tests / 18 files passed both on the host and inside the
  exact Alpine image, including the PostgreSQL initialization lock.
- Four real Dragonfly/Postgres/ClickHouse pipeline tests passed on the host
  and in the exact image, including retry recovery and erasure fencing.
- Inside the exact image: Ghost mapping 26, assets four and Markdown/image
  compatibility 21 tests passed (51 total). Official renderer paths require
  `usedFallback: false`, including Arabic formatting and links. See the
  [bounded qualification decision](../../../../operations/node26-qualification.md):
  upstream Ghost engine declarations still exclude Node 26 and are unchanged.
- All eight Linux signal tests passed inside the exact image, including
  operator signal/exit propagation and truthful failed web shutdowns.
- All 30 release-contract tests, published v0.2.1 checksums and the manual
  Docker-context exclusion smoke passed.

The lockfile package-key delta adds only `@types/node@26.6.6`, removing the two
old Node typing versions and unused `undici-types@6.21.0`. Other versions are
unchanged; peer-context churn accounts for the larger textual diff. The public
CLI keeps its Node 22 consumer target/range; contributor builds use Node 26.

## Exact-image stack and operators

`acceptance.json` verifies all four source-labelled image roles, HTTP/SSR 200,
seven ready worker queues, ClickHouse readiness and zero source bind mounts.
Both `migrate` and `clickhouse-migrate` ran twice successfully. Production
seeding stayed excluded (zero users/projects before the fictional operator
fixture). Compose project: `nibleaf-runtime`; app/API/admin ports 4520/4521/4522,
worker 4442, backing host ports shifted by +130. Qdrant remains internal because
its shifted port was occupied. No foreign listener/container was touched.

`search-reindex-all` exited 0 and queued one seeded published site. The real
worker reached READY with two EN/AR pages/chunks, two new-deployment points,
two reused seeded synthetic vectors, zero newly embedded chunks and zero
failures. Provider hostnames were blocked. This does not claim live-provider
acceptance or a separately measured provider-request counter.

`search-alias-switch` exited 0, moved a dummy alias from v1 to v2, and retained
both dummy collections. An unconfirmed target exited 1 without changing it.
`operator-proof.json` and the retained fixture show the state/readback.

## Shutdown #391

The pre-existing app hang was caused by 20 referenced five-minute TanStack Query
GC timers remaining after HTTP closure, captured in `../shutdown-diagnosis.json`
on Node 22. Request-local SSR clients now retain infinite server GC lifetime,
creating no collection timers; browser caches still expire after five minutes.
The web wrapper defaults to one second of readiness drain plus an eight-second
forced-exit allowance, and preserves failed/nonzero child exits.

Actual final-image shutdown, with Compose's 30-second stop window:

| Role | Elapsed | Exit |
| --- | ---: | ---: |
| App | 2.628 s | 0 |
| Admin | 2.576 s | 0 |
| API | 0.606 s | 0 |
| Worker | 0.616 s | 0 |

App/admin each served 20 successful SSR requests, then closed all 20 idle
keep-alive connections during SIGTERM shutdown. No forced kill or OOM occurred.
The native servers reported successful closure. This probe covers SSR and idle
keep-alives; it does not simulate a long-running SSR handler. Separately, the
unchanged shipped wrapper around a synthetic SIGTERM-ignoring child hit its
default deadline and exited **1** in **9.318 s**, proving the fallback no longer
reports a forced kill as success. Reproduction scripts and raw receipts remain
alongside this report; no source overlays or custom timeout env were used.

The first full host test attempt saw stale generated translations after rebase;
explicit generation followed by the complete rerun passed. The additional
GitBook rehearsal exceeded its default 10-second cold-import hook budget; all
four tests passed with a 60-second setup allowance and unchanged assertions.
Both GitBook receipts are retained. These are setup observations, not omitted
test failures.

The additional PostgreSQL-in-image run first inherited the stack's production
`clickhouse` read mode: two SQL assertions read empty ClickHouse data instead
of their seeded PostgreSQL rows. Repeating the full suite with CI's
`shadow_read` mode passed all 267 tests. The initial and corrected receipts
are retained. No product behavior was changed to accommodate the fixture.

Secret scanning initially mistook a checksum keyed by an auth-related filename
for an API key. The checksum manifest now uses separate `path` and `sha256`
fields, hashes canonical staged bytes, and passes local scanning without any
new suppression. The obsolete Docker-stage-name assertion was updated to check
the marketing build argument independently of its stage ancestry; the image
and all acceptance above were rebuilt/repeated after that test-only change.

UI screenshots/video would not prove runtime/command compatibility. Executable
tests, installed-artifact checks, durable state/readback, HTTP/SSR receipts and
measured process exits provide the relevant evidence. PDF/live-provider and
production acceptance remain outside this isolated check. Task-owned final
ai-slop-cleanup review found no actionable slop.
