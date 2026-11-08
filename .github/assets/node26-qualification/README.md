# Node 26 qualification receipts

Code source: `dcd9d873b6400bc81a5ff57639439ee689a7b74a`, based on main
`551fdcff6cdca595104a0ecad474d48bfff36946`. The evidence-only follow-up changes
this `.github` directory, excluded from the Docker build context.

The manually built Linux/amd64 image is `nibleaf-runtime:51`, local image identity
`sha256:d11c7c51f773018619e1097dc9ae98ec9c6d1bd9ef20b9feea156455e45b9eef`.
Actual Node: **26.13.0**, Alpine 3.24.4. No image was published or deployed.

## Explicit qualification decision

The installed Lexical 1.5.0 and Mobiledoc 7.2.3 renderers still declare Node 22/24
engine ranges. The latest published Lexical version checked on 2026-11-08 UTC,
1.5.3, also excludes Node 26. Nibleaf takes #51's explicit qualification option:
retain the exact renderer versions and qualify the reachable importer family
with actual execution. Upstream engine declarations and installation policy are
unchanged. See [the decision](../../../operations/node26-qualification.md).

`ghost-family.json` records the installed Ghost family manifests, including
additional Node 22/24 constraints in default nodes, Markdown rendering and HTML
cleanup. It is explicitly scoped to Ghost manifests, not a full transitive SBOM.

Inside the **exact Node 26 production Alpine image**, with no source mounts:

- `ghost-mapping.test.ts`: 26 passed, including Arabic headings, formatting and
  links through both official renderers with `usedFallback: false`.
- `ghost-assets.test.ts`: four passed.
- `markdown-image-compatibility.test.ts`: 21 passed, including the actual Ghost
  Markdown renderer and its image-size integration through CommonJS and ESM.

Total: **51 tests / three files passed**. The retained console receipt names
each suite. This qualification does not claim upstream Node 26 support or every
possible Ghost document/card shape.

## Validation

`verification.json` records the completed checks. Host checks used Node 26.13.0:

- All 27 typecheck tasks, lint, dead-code and all 25 full-test Turbo tasks passed.
- **All 12 workspace build/setup tasks passed, zero cache hits**, including
  app, admin, server, worker, CLI, email preview and Cloudflare edge builds.
- An analyzed app build and `CI=true pnpm --filter @nibleaf/app bundle:check`
  passed, including module attribution and existing boundaries. Public-docs
  gzip: 338.00 KiB; index: 337.20 KiB; budget: 340.04 KiB.
- Fresh owned PostgreSQL database `nibleaf_node26_test`: all 44 migrations,
  migration status/runtime query, three migration upgrade smoke scripts, three
  tenant-fence tests, 21 auth tests, 223 server tests across 18 PostgreSQL files
  and five worker tests passed.
- Inside the exact Alpine image: **148 ClickHouse tests / 18 files passed**,
  with ClickHouse integration and real PostgreSQL initialization-lock flags.
- Inside the exact Alpine image: **29 GitBook importer timing tests passed**.
- Inside the exact Alpine image: **four real Dragonfly/Postgres/ClickHouse
  pipeline tests passed**, including retained-job recovery and erasure fencing.

The lockfile package-key delta is only Node typings: 22.20.5 and the former
transitive 26.6.5 collapse to 26.6.6, and unused undici-types 6.21.0 is removed.
Other dependency versions are unchanged; the larger diff is peer-context churn.
The public CLI retains its Node 22 consumer target/engine range while its
contributor toolchain uses Node 26.

## Exact-image acceptance and limits

`acceptance.json` pins the image and baked source revision. All four roles booted
on the owned Compose project `nibleaf-runtime`: server/worker health and app/admin
sign-in SSR returned 200; all seven worker queues and ClickHouse were ready.
Both migration modes passed again, idempotently, with default production seeding
excluded. The runtime audit passed all 16 required artifacts and required module
resolutions. No source overlays, revision overrides or real provider credentials.

App/API/admin host ports are 4520/4521/4522; worker is 4442. Backing host ports
are the development Compose defaults plus 130. Qdrant stays internal because its
shifted host port was occupied. No existing listener or foreign container was
changed. Test data and credentials are fictional and isolated.

The first image build exposed the official Node 26 base's missing Corepack.
The final Dockerfile installs the repository's pinned pnpm through npm instead;
the corrected production build and both migration entrypoints passed. Docker
builds remain manual-only.

This PR is independent of #389's runtime-tool pruning. Combining them must keep
Node 26's base/standalone pnpm build setup and #389's final runtime pruning and
direct Node migration entrypoints. Historical Scout findings and #361 remain
separate security tracking; these receipts make no scan-clean claim.

No UI changed, so screenshots/video would not establish runtime compatibility.
Executable test receipts, exact-image inventory and HTTP/SSR acceptance provide
the relevant evidence. Production/provider acceptance is outside these local
checks. The earlier Node 22 security-image run observed app exit 137 at the
existing 30-second stop window; this migration does not change shutdown timing.
