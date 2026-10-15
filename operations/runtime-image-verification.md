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
Runtime exclusion is verified from installed files in the final image; this does
not claim that the source-lock development advisory has been fixed upstream.

Production peers still install TypeScript and Vitest metadata. The runtime stage
omits only TypeScript's unused optional native compiler packages; services execute
TS/TSX with tsx/esbuild. Contributor builds retain the compiler. Other native
optional dependencies, including sharp and Prisma, remain installed. The runner
also omits the base image's unused npm/npx installer while retaining pnpm for
existing migration/operator commands. Both the root package-manager pin and
Corepack preparation use pnpm 10.34.6, whose bundled tar is 7.5.22.

The runner upgrades only the stable-branch zlib package; image scan dispositions
must use the built image's installed version rather than an earlier baseline.

Chromium's Arabic PDF output needs `font-noto-naskh-arabic`. A successful export
job or matching file checksum alone cannot establish that its text is readable.

## Build and inspect

Run these commands explicitly. Docker builds must remain manual; do not add them
to pull-request CI. The full build needs about 6 GiB of V8 heap plus Docker/OS
headroom. Use a committed source revision for the final acceptance image.

```sh
node scripts/docker-context-smoke.mjs
docker build --target runner --progress=plain --build-arg REVISION="$(git rev-parse HEAD)" --build-arg VITE_APP_URL=http://localhost:4410 --build-arg VITE_API_URL=http://server:4311 --tag nibleaf-runtime:local .
node scripts/runtime-image-audit.mjs nibleaf-runtime:local output/runtime-image/inventory.json
```

The context smoke creates uniquely named synthetic files beneath excluded QA,
browser-auth, local-volume, and environment paths. A real Docker `COPY` must omit
all canaries while retaining application source. It removes only its own files
and temporary image tag. It never reads existing browser state or env contents.

The image audit checks required artifacts, TypeScript/config/Prisma resolution,
MCP runtime presence, and installed package inventory including nested and Nitro
dependencies. It fails if Ultracite, braces, or a TypeScript native compiler
package remains installed. No host env is
forwarded into the probe container. Keep the JSON report with the exact image ID,
source revision, build log, and acceptance evidence.

## Disposable service acceptance

Use a unique Compose project, new synthetic volumes, alternate ports, generated
local-only secrets and a local SMTP catcher. Do not reuse customer or production
data, credentials, provider accounts or existing service volumes. Do not infer
deployment acceptance from a local image test.

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
migrations, email, PDF, Git, MCP or graceful shutdown. Remove only the temporary
project's containers/volumes after preserving its reports.
