# syntax=docker/dockerfile:1.7
# Single image for the whole Nibleaf monorepo. The container command selects the
# service (server / worker / app / admin / migrate) via docker-entrypoint.sh.
#
# server & worker run their TypeScript directly with tsx (the Prisma driver
# adapter + workspace packages resolve cleanly that way); app and admin
# run their self-contained Nitro SSR bundles.

# Refresh within the reviewed Alpine branch; distro upgrades need their own review.
FROM node:26-alpine3.24@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216 AS base
WORKDIR /app
# openssl: Prisma engine detection at migrate time. curl: Compose healthchecks.
# git: public repository imports for self-hosted Git/Forgejo/Gitea/GitLab URLs.
# Chromium needs an Arabic font for readable RTL PDF exports.
RUN apk add --no-cache chromium curl git openssl font-noto-naskh-arabic
ENV EXPORT_CHROMIUM_PATH=/usr/bin/chromium-browser

# Node 26 no longer bundles Corepack. Only build stages need standalone pnpm;
# runtime services, migrations and operators execute Node/tsx directly.
FROM base AS build-tools
ENV PNPM_HOME=/pnpm
ENV PNPM_STORE_DIR=/pnpm/store
ENV PATH=$PNPM_HOME:$PATH
RUN npm install --global pnpm@10.34.9

FROM build-tools AS build
ARG MARKETING_GITHUB_STARS=0
ENV MARKETING_GITHUB_STARS=$MARKETING_GITHUB_STARS
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
# Generate the Prisma client (musl engine for this Alpine image).
RUN pnpm --filter @nibleaf/database generate
# Reserved markers are resolved from the container environment before web boot.
# Never compile an installation's public origin into the shared image.
ENV VITE_API_URL=http://nibleaf-runtime-api.invalid
ENV VITE_APP_URL=https://nibleaf-runtime-app.invalid
ENV VITE_ADMIN_URL=https://nibleaf-runtime-admin.invalid
ENV VITE_SITE_BASE_DOMAIN=nibleaf-runtime-site.invalid
# The app build exceeds a 4 GiB V8 heap as the editor, docs renderer, and SSR
# bundles are optimized together. Keep this aligned with the 5-6 GiB build
# requirement documented in docker-compose.yml.
ENV NODE_OPTIONS=--max-old-space-size=6144
# Build only container services and their workspace dependencies. The separately
# deployed Cloudflare edge uses workerd, whose Linux binary is not Alpine-native.
RUN pnpm exec turbo run build --concurrency=1 \
  --filter=@nibleaf/app... \
  --filter=@nibleaf/admin... \
  --filter=@nibleaf/server... \
  --filter=@nibleaf/worker...
# Wrappers must refuse an unconfigured image even when the entrypoint is skipped.
RUN touch apps/app/.output/.nibleaf-runtime-required apps/admin/.output/.nibleaf-runtime-required

# Install a clean production graph instead of copying the builder's tooling.
# Keep the workspace layout: server/worker and their workspace dependencies run
# through tsx, and migrations invoke the installed Prisma/tsx entry points.
FROM build-tools AS runtime-deps
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile
# Production peers pull TypeScript's optional native compiler into this graph.
# Runtime TS/TSX executes through tsx/esbuild; no service invokes tsc. Exclude
# only that unused compiler, retaining sharp/esbuild/Prisma optional binaries.
RUN rm -rf /app/node_modules/@typescript/typescript-*
# These ignored/generated files are runtime inputs, not development tooling.
COPY --from=build /app/packages/database/src/generated /app/packages/database/src/generated
COPY --from=build /app/packages/i18n/src/paraglide /app/packages/i18n/src/paraglide
COPY --from=build /app/packages/search/dist /app/packages/search/dist
COPY --from=build /app/apps/server/dist /app/apps/server/dist
COPY --from=build /app/apps/app/.output /app/apps/app/.output
COPY --from=build /app/apps/admin/.output /app/apps/admin/.output

FROM base AS runner
ARG VERSION=0.1.1
ARG REVISION=development
ENV NODE_ENV=production
ENV NIBLEAF_REVISION=$REVISION
LABEL org.opencontainers.image.title="Nibleaf" \
  org.opencontainers.image.description="Self-hosted documentation platform" \
  org.opencontainers.image.licenses="AGPL-3.0-only" \
  org.opencontainers.image.source="https://github.com/lord007tn/nibleaf" \
  org.opencontainers.image.version=$VERSION \
  org.opencontainers.image.revision=$REVISION
COPY --from=runtime-deps /app /app
COPY --chmod=755 docker-entrypoint.sh /app/docker-entrypoint.sh
# Services and migrations use Node/tsx directly. Package managers are build tools;
# remove their separate bundled dependency graphs from the shipped image.
# Refresh every installed stable-branch package, including Chromium's native
# dependencies. The manual workflow bypasses only this stage's layer cache.
RUN apk upgrade --no-cache && rm -rf \
  /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/lib/node_modules/pnpm \
  /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
  /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg \
  /root/.cache/node/corepack /pnpm
EXPOSE 4310 4311 4312 4315
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["help"]
