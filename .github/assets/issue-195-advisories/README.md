# Issue #195: runtime tooling removal, 2026-11-08

The requested `sha-9cf0b0cb4d21bfe02910a0e506af0470f53c8a1c` tag is absent
(its manual publication failed). The baseline is its published main descendant
`8986b3cc08e6a2f6c1ddbc9e98908ab9a1abac03`, verified by ancestry and OCI revision:
`ghcr.io/lord007tn/nibleaf@sha256:9a9098961bb45c5b6c8a2f9d4a998c25a98246c5a2744908e301e91ca48a6f8e`.

The candidate was manually built from code commit
`7f6333e1f67245c7a0925fa8d45598d9bf03c6cb`. The attached reports identify the
exact image and installed graph. The subsequent evidence commit changes only
this `.github` directory, which is excluded from the Docker build context.

## Scanner receipts and dispositions

Docker Scout 1.24.0 refused this session without Docker Hub authentication.
Trivy 0.76.2 scanned both complete Linux/amd64 images with the same database
snapshot (updated 2026-11-08 18:58:44 UTC). Commands used `image --image-src docker
--scanners vuln --skip-db-update --format json`, with no severity, fixed-version,
package or advisory exclusions. The database was downloaded before the baseline
scan. Raw, unfiltered JSON is compressed here; hashes refer to decompressed bytes.

| Trivy observation | Critical | High | Medium | Low | Finding occurrences | Unique advisory IDs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Published descendant | 0 | 0 | 3 | 0 | 3 | 2 |
| Candidate | 0 | 0 | 0 | 0 | 0 | 0 |

| Baseline finding | Location | Disposition |
| --- | --- | --- |
| CVE-2026-118773, glob 10.5.0 | Corepack's pnpm bundle | Removed with the build-only package manager. Migrations now invoke Node directly. |
| CVE-2026-118764, minimatch 9.0.9 | Corepack's pnpm bundle | Same physical bundle removal; no nested override. |
| CVE-2026-118773, glob 13.0.6 | nf3's embedded dependencies | Nitro/nf3 are build tooling. Moving Nitro to devDependencies excludes the tracer from the production install while retaining built SSR outputs. |

The lockfile changes only Nitro's importer classification; no package version
changes. The direct pnpm 10 pin is already the latest patch in its major.
The complete source audit separately retains development-only deepmerge
GHSA-gcqx-w48m-w2h4 with no patched release. #361 and its 2027-02-08 expiry remain
unchanged; this is not a claim that the development graph is clean.

These Trivy counts are **not comparable to historical Scout counts** (66/22 high,
or the later 56/12 high). In particular, zero Trivy results does not establish
that embedded native/Rust findings from Scout have been corrected. Their
Chromium dependency families remain installed and cannot be removed without
removing PDF export support. No current Scout scan or production deployment is
claimed.

### Remaining compatible-upstream blockers

Fresh signed Alpine 3.24 main/community indexes, checked 2026-11-08, offered no
upgrades for the final 206-package OS graph. The retained availability receipt
shows the installed versions. Historical Scout-advertised corrections still
require compatible containing-package releases on this stable branch:

| Family retained for Chromium/PDF | Installed stable version | Historical Scout correction / blocker |
| --- | --- | --- |
| cups-libs | 2.4.19-r1 | 2.4.20-r0 unavailable on Alpine 3.24 |
| musl | 1.2.6-r3 | 1.2.6-r6 unavailable on Alpine 3.24 |
| libvpx | 1.15.2-r1 | 1.16.0-r0 unavailable on Alpine 3.24 |
| FFmpeg libswresample | 8.1.3-r0 | 9.0.2-r0 unavailable on Alpine 3.24 |
| rav1e-libs / embedded Rust | 0.8.1-r0 | No newer containing package in the compatible stable index |

Keep #195 open for these upstream families and a renewed unsuppressed Scout
assessment; next review date: **2026-11-15**. Their historical advisory counts are
not represented as current findings or as unreachable. No edge/testing packages,
scanner suppression or security-protection weakening was introduced.

## Verification

- All 27 local typecheck tasks, lint, dead-code checks and all 25 full-test Turbo
  tasks passed on Node 26.13.0. The candidate itself runs Node 22.23.4; its manual
  Linux build passed and its four Linux entrypoint/signal tests passed.
- PostgreSQL: 44 migrations, runtime query smoke, three migration upgrade smoke
  scripts, tenant-fence suite, 21 Better Auth tests, 223 server integration tests
  across 18 files, and five worker tests passed against the owned disposable
  `nibleaf_analytics_test` database.
- All 148 ClickHouse tests passed with integrations and PostgreSQL initialization
  locking enabled. One first-run test exceeded its unchanged five-second limit;
  the complete rerun passed without changing timeouts or assertions.
- Analyzed app build and `CI=true pnpm --filter @nibleaf/app bundle:check` passed,
  including module boundaries. Public-docs gzip: 338.00 KiB; index: 337.20 KiB;
  existing budget: 340.04 KiB.
- Exact candidate: all 16 runtime artifacts and required resolutions passed;
  Nitro/nf3, excluded development tools and package managers are absent.
- Owned Compose project `nibleaf-runtime`: server/worker health and app/admin
  sign-in SSR returned 200; seven worker queues and ClickHouse were ready.
  Both direct migration entrypoints passed, including idempotent repeat runs,
  with production seeding excluded. No source overlays or revision overrides.
- Shutdown observation: worker/server/admin exited 0; app exceeded the existing
  30-second Compose stop window and exited 137 after logging server closure.
  Shutdown timing was not modified by this patch.

No UI was changed, so screenshots/video would not demonstrate the security
change. Installed inventories, unsuppressed scanner output, executable checks
and exact-image HTTP receipts provide the relevant evidence. No image was
published or deployed by this task.
