# syntax=docker/dockerfile:1.7
# Single image for the whole Midad monorepo. The container command selects the
# service (server / worker / app / www / migrate) via docker-entrypoint.sh.
#
# server & worker run their TypeScript directly with tsx (the Prisma driver
# adapter + workspace packages resolve cleanly that way); app & www run their
# self-contained Nitro SSR bundles.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PNPM_STORE_DIR=/pnpm/store
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app
# openssl: Prisma engine detection at migrate time. curl: Compose healthchecks.
# git: public repository imports for self-hosted Git/Forgejo/Gitea/GitLab URLs.
RUN apk add --no-cache curl git openssl && corepack enable && corepack prepare pnpm@10.30.3 --activate

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
# Generate the Prisma client (musl engine for this Alpine image).
RUN pnpm --filter @midad/database generate
# Bake the in-cluster API URL so the app's Nitro /api proxy targets the server
# service. The browser only ever sees the public app origin.
ARG VITE_APP_URL=https://app.midad.dev
ARG VITE_WWW_URL=https://midad.dev
ARG VITE_SITE_BASE_DOMAIN=midad.app
ARG VITE_API_URL=http://server:4311
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_APP_URL=$VITE_APP_URL
ENV VITE_WWW_URL=$VITE_WWW_URL
ENV VITE_SITE_BASE_DOMAIN=$VITE_SITE_BASE_DOMAIN
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN pnpm exec turbo run build --concurrency=1

FROM base AS runner
ARG VERSION=0.1.0
ENV NODE_ENV=production
LABEL org.opencontainers.image.title="Midad" \
  org.opencontainers.image.description="Self-hosted documentation platform" \
  org.opencontainers.image.licenses="AGPL-3.0-only" \
  org.opencontainers.image.source="https://github.com/lord007tn/midad" \
  org.opencontainers.image.version=$VERSION
COPY --from=build /app /app
COPY --chmod=755 docker-entrypoint.sh /app/docker-entrypoint.sh
EXPOSE 4310 4311 4312 4313 4314 4315
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["help"]
