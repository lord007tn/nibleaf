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
