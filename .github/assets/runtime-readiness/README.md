# Synthetic runtime packaging evidence

This directory records local acceptance using fictional **Runtime QA Alpha**
content. The PNGs show its synthetic Arabic PDF page. The fixture databases,
object store and queues were disposable local services.

The baseline image is `nibleaf-runtime:887cb0d766ef`, built from source
`887cb0d766ef28150b5da4113cf69fdd87cc8fe2`. Its immutable image ID is
`sha256:fdd149e128891703222d6e0493bb13d56c7f4d79d04ef472c46c953e30ffe3ac`.
Later source changes require a new image and acceptance run. This evidence does
not establish deployment or external provider acceptance.

| Check | Baseline result | Qualification |
| --- | --- | --- |
| Database migrations | 30 PostgreSQL migrations; PostgreSQL and ClickHouse re-runs idempotent | New local volumes |
| Seeding | Default production migration excluded seed; explicit opt-in idempotent | Separate synthetic database |
| Service startup | API, worker, app and admin healthy; sign-in SSR, static assets and API proxy passed | Exact image pinned throughout |
| Email | English and Arabic HTML/plain-text rendering passed through production TSX | Local rendering only |
| MCP | Initialization, scoped tools and tenant fence passed; missing auth 401 and invalid origin 403 | Synthetic scoped key |
| Worker publication | Real worker produced a READY deployment; active publish drained on SIGTERM | Synthetic content |
| Reader | English/Arabic passed with matching public/container ports | Public 4410 → container 4310 produced SSR 500; source fix needs final-image retest |
| Exports | Markdown, static HTML and PDF stored; checksums verified | Baseline Arabic PDF was blank; see font experiment below |
| Git import | Public read-only fixture imported once, then updated without duplicates | No private repository credentials |
| Shutdown | All four services exited 0 without OOM; active worker job completed | SIGTERM exercised during publication |
| Installed application graph | Zero Ultracite and braces packages | Source development lock metadata still contains braces |
| Security | Application workspace production audit reported zero advisories | Full unfiltered image scan reported 4 critical and 62 high findings; image is not scanner-clean |

The tracked inventory verifier counted 1,390 installed resolution roots. An
independent raw manifest walk counted 1,593, including nested package fixtures;
these are different measures. Docker Scout's SBOM contained 2,055 packages and
zero braces entries. Production optional peers still included TypeScript and
Vitest, so no blanket absence-of-development-tools claim is made.

## Arabic PDF font experiment

The baseline image's third PDF page was visually blank:

![Baseline synthetic Arabic PDF page](arabic-pdf-baseline.png)

Installing `font-noto-naskh-arabic` inside a disposable container made the same
synthetic page readable. The immutable baseline image was unchanged. This
experiment motivates the Docker font fix; the rebuilt final image must repeat
the export and visual check.

![Synthetic Arabic PDF page after disposable font experiment](arabic-pdf-font-experiment.png)

The machine-readable aggregate is [baseline-acceptance.json](baseline-acceptance.json).
Manual reproduction and acceptance gates are documented in
[operations/runtime-image-verification.md](../../../operations/runtime-image-verification.md).
Docker builds remain manual.

## Final packaging candidate: bb72cddb32a6

The final synthetic run used source
`bb72cddb32a6cb1744683034d26fdfe16b3dbfdb` and immutable image ID
`sha256:60032d759714ac29e3b37d5a668f1b5a334ebf2e78d52cebe5862497fc917064`.
The compact [final acceptance record](final-acceptance.json) belongs to that
image. It records local acceptance and retained failures; it does **not**
establish production readiness, deployment or external provider acceptance.

Fresh disposable PostgreSQL, ClickHouse, queue and object-storage volumes passed
migration and seed checks. All four services, transactional email rendering,
scoped MCP, worker publication, exports and public Git import passed. An active
publication drained successfully on SIGTERM, and all four services exited zero.
Public English/Arabic SSR passed with host port 4410 mapped to container 4310,
including authenticated, private, unpublished and synthetic custom-domain
checks. The custom-domain fixture establishes no real DNS or TLS provisioning.

The final image's Arabic PDF page is readable without changing its containers:

![Synthetic Arabic PDF page from the final image](arabic-pdf-final.png)

A controlled Redis network interruption retained two **failed** checks:
the worker reported HTTP 200/healthy while Redis was unavailable, and the OTP
endpoint reported HTTP 200 after required email enqueue timed out. Both the
previously accepted job and a new job completed after Redis returned, without
restarting the worker. These defects are tracked in
[issue #201](https://github.com/lord007tn/nibleaf/issues/201). Separate source
corrections and regression checks are pending and are not verified by this image.

The application production audit found zero advisories. The full unfiltered
image scan retained **67 unique advisories**: **0 critical, 23 high, 18 moderate
and 26 low**, classified from CVSS scores. No suppressions were applied, and the
image is not scanner-clean. See [security dispositions](final-security-dispositions.json).
Installed compiler and npm bytes were removed; TypeScript/Vitest optional peer
wrappers and source-lock development metadata are recorded separately.

The durable scan artifacts are:

- [Unfiltered Docker Scout SARIF](final-image-cves.sarif.json.gz): all 67 findings,
  byte-identical to the original report after gzip decompression.
- [Privacy-minimized SPDX package inventory](final-image-packages.spdx.json.gz):
  all 1,941 package identities and package-manager references retained; public
  maintainer/contact and per-file metadata omitted. This is a derived inventory,
  not the raw unfiltered SPDX file.

Artifact hashes, the original full SPDX hash and distinct installed-package/SBOM
counts are recorded in the final acceptance JSON. Later source or dependency
changes require their own image evidence.
