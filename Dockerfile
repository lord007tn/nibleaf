# syntax=docker/dockerfile:1.7
# Single image for the whole Plume monorepo. The container command selects the
# service (server / worker / app / www / migrate) via docker-entrypoint.sh.
#
# server & worker run their TypeScript directly with tsx (the Prisma driver
# adapter + workspace packages resolve cleanly that way); app & www run their
# self-contained Nitro SSR bundles.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app
# openssl: Prisma engine detection at migrate time. curl: Compose healthchecks.
RUN apk add --no-cache curl openssl && corepack enable && corepack prepare pnpm@10.30.3 --activate

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
# Generate the Prisma client (musl engine for this Alpine image).
RUN pnpm --filter @plume/database generate
# Bake the in-cluster API URL so the app's Nitro /api proxy targets the server
# service. The browser only ever sees the public app origin.
ENV VITE_API_URL=http://server:4311
RUN pnpm build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app /app
COPY --chmod=755 docker-entrypoint.sh /app/docker-entrypoint.sh
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["help"]
