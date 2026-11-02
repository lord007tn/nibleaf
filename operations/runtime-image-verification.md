# Manual runtime image verification

The builder installs development tools and builds the workspace. A separate
`runtime-deps` stage installs the frozen production graph from a clean Docker
context, then receives only the generated runtime artifacts. The final image
keeps the existing workspace layout and all `docker-entrypoint.sh` service modes.

`tsx` and the shared TypeScript configuration are runtime dependencies because
server, worker, ClickHouse migrations, and transactional email execute source
TypeScript/TSX. Prisma's CLI is a runtime dependency of the database package for
`migrate deploy`. Generated Prisma and Paraglide code, the search bundle, the RPC
export, both Nitro outputs and their public assets must come from the same build.

The repository lockfile still contains development dependencies for contributors.
Runtime exclusion must be checked against installed files and scans of the final
image; this does not claim that the source-lock development advisory has been
fixed upstream.

Production peers still install TypeScript and Vitest metadata. The runtime stage
omits only TypeScript's unused optional native compiler packages; services execute
TS/TSX with tsx/esbuild. Contributor builds retain the compiler. Other native
optional dependencies, including sharp and Prisma, remain installed. The runner
also omits the base image's unused npm/npx installer while retaining pnpm for
existing migration/operator commands. Both the root package-manager pin and
Corepack preparation use pnpm 10.34.9, whose bundled `ip-address` is 10.7.4,
tar is 7.5.22, and http-cache-semantics is 4.3.0. Its bundled glob 10.5.0 and
minimatch 9.0.9 findings remain unresolved. Root dependency overrides do not
update pnpm's separate bundled dependencies; verify the actual image after
changing the toolchain pin.

The base stays on Node 22 and Alpine 3.24. The runner upgrades all installed
packages from that stable branch, including Chromium's native dependencies.
The manual Docker workflow pulls the current base image and bypasses only the
`runner` stage's layer cache, retaining the build/runtime-deps stages and pnpm
store caching when their inputs are unchanged. Cached `RUN apk add/upgrade`
layers do not query newer repository metadata just because a release is newer.
Local manual builds must use the same pull/cache options shown below.

Image scan dispositions must use the built image's installed versions and a
fresh unfiltered scan. An available upstream fix is not proof that Alpine 3.24
ships it, and embedded Rust crates need a rebuilt containing native package.
Do not add edge/testing repositories or suppress unresolved findings to make a
report green. Keep findings without a compatible stable fix visible, then
verify the exact candidate image and all four service roles before promotion.

Chromium's Arabic PDF output needs `font-noto-naskh-arabic`. A successful export
job or matching file checksum alone cannot establish that its text is readable.

PDF exports render the cover and each visible article in separate browser
contexts, then combine their pages with continuous numbering and internal link
destinations. This bounds decoded image/DOM memory instead of loading a whole
image-heavy site into Chromium at once. Cancellation is checked between articles.
The Coolify worker defaults to one export at a time, with a 1 GiB memory limit
and one CPU. Verify the resulting container limits and complete a representative
export before raising concurrency or admitting other expensive work on the host.

## Build and inspect

Run these commands explicitly. Docker builds must remain manual; do not add them
to pull-request CI. The full build needs about 6 GiB of V8 heap plus Docker/OS
headroom. Use a committed source revision for the final acceptance image.

```sh
node scripts/docker-context-smoke.mjs
docker build --pull --no-cache-filter runner --target runner --progress=plain --build-arg REVISION="$(git rev-parse HEAD)" --build-arg VITE_APP_URL=http://localhost:4410 --build-arg VITE_API_URL=http://server:4311 --tag nibleaf-runtime:local .
node scripts/runtime-image-audit.mjs nibleaf-runtime:local output/runtime-image/inventory.json
```

The context smoke creates uniquely named synthetic files beneath excluded QA,
browser-auth, local-volume, and environment paths. A real Docker `COPY` must omit
all canaries while retaining application source. It removes only its own files
and temporary image tag. It never reads existing browser state or env contents.

The image audit checks required artifacts, TypeScript/config/Prisma resolution,
MCP runtime presence, and packages reached by its normal `node_modules` and
Nitro output traversal. It can miss embedded trees such as
`nf3/dist/node_modules`; inspect embedded bundles separately and retain an
unfiltered scan of the whole image. The audit fails when it finds Ultracite, braces, or
a TypeScript native compiler package in its inventory. No host env is forwarded
into the probe container. Keep the JSON report with the exact image ID, source
revision, build log, and acceptance evidence.

## Disposable service acceptance

For the owner's local workflow, use the shared service helper to provision a
project namespace on `productops-shared`. Reuse the individual `postgres`,
`dragonfly`, `clickhouse`, `maxio`, and `qdrant` backing containers; preserve their
existing keys and configuration. Use isolated containers for the application
roles, alternate ports, synthetic namespace data, and a local SMTP catcher.
Do not start duplicate backing services or a Compose stack per project. Keep
customer or production data and provider accounts out of these tests; a local image
test does not establish deployment acceptance.

1. Run `migrate` and `clickhouse-migrate` twice. Both second runs must be
   idempotent. Default production migration must skip demo seeding; test explicit
   seed opt-in only in the disposable database. Run the database `smoke` script
   to execute an actual query through the generated Prisma client.
2. Run `node --test scripts/email-runtime.test.mjs` in the image and render an
   Arabic transactional email through the same TSX runtime. Confirm code, HTML,
   plain text, language and RTL output without delivering external mail.
3. Start `server`, `worker`, `app` and `admin` from the final image. Verify
   readiness, API proxying, SSR and static assets. Test MCP initialization and
   tool listing with a scoped synthetic key; confirm rejected unauthenticated
   and invalid-origin requests still fail closed.
4. Create a synthetic project, edit and publish on mobile, wait for worker
   completion and verify its reader in English/Arabic. Test Git import from a
   public read-only fixture plus HTML/ZIP and PDF exports. Private/local Git URLs
   must remain blocked by SSRF protections. PDF acceptance must exercise the
   image's Chromium executable and produce a readable file.
5. Send SIGTERM to each service mode. Verify clean exit, drained HTTP requests
   and queue shutdown without orphan child processes or abruptly lost jobs.

Record each result separately. A health response does not prove publishing,
migrations, email, PDF, Git, MCP or graceful shutdown. After preserving reports,
remove only owned application containers and synthetic fixtures through the
namespace helper; preserve shared backing containers, volumes, and keys.
