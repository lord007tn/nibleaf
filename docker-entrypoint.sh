#!/bin/sh
set -eu

cmd="${1:-help}"

# Known weak/demo secrets that must never be used in production. The compose
# file ships these as defaults so local `docker compose up` works out of the box;
# in production they are a hard failure.
WEAK_SECRET_COMPOSE="change-me-in-production-32chars-minimum"
WEAK_SECRET_DEV="dev-secret-change-me-please-32chars-min"

# Refuse to start in production with an empty or known-default auth secret.
require_prod_secret() {
  if [ "${NODE_ENV:-}" != "production" ]; then
    return 0
  fi
  secret="${BETTER_AUTH_SECRET:-}"
  if [ -z "$secret" ] || [ "$secret" = "$WEAK_SECRET_COMPOSE" ] || [ "$secret" = "$WEAK_SECRET_DEV" ]; then
    echo "[midad] FATAL: BETTER_AUTH_SECRET is unset or a known weak default while NODE_ENV=production." >&2
    echo "[midad] Generate a strong secret and set it in your environment:" >&2
    echo "[midad]     openssl rand -hex 32" >&2
    echo "[midad] See DEPLOYMENT.md for the full production checklist." >&2
    exit 1
  fi
}

# Seed only when explicitly opted in, or in development. Never auto-seed in prod.
should_seed() {
  if [ "${MIDAD_RUN_SEED:-}" = "true" ] || [ "${MIDAD_RUN_SEED:-}" = "1" ]; then
    return 0
  fi
  if [ "${PLUME_RUN_SEED:-}" = "true" ] || [ "${PLUME_RUN_SEED:-}" = "1" ]; then
    return 0
  fi
  if [ "${NODE_ENV:-}" = "development" ]; then
    return 0
  fi
  return 1
}

case "$cmd" in
  migrate)
    require_prod_secret
    echo "[midad] applying database migrations…"
    pnpm --filter @midad/database exec prisma migrate deploy
    if should_seed; then
      echo "[midad] seeding demo data…"
      pnpm --filter @midad/server exec tsx src/database/seed/index.ts || echo "[midad] seed skipped (continuing)"
    else
      echo "[midad] skipping seed (set MIDAD_RUN_SEED=true to enable)"
    fi
    echo "[midad] migrate complete"
    ;;
  server)
    require_prod_secret
    echo "[midad] starting API server on :${API_PORT:-4311}"
    exec pnpm --filter @midad/server exec tsx src/index.ts
    ;;
  worker)
    require_prod_secret
    echo "[midad] starting worker on :${WORKER_PORT:-4312}"
    exec pnpm --filter @midad/worker exec tsx src/index.ts
    ;;
  app)
    echo "[midad] starting dashboard on :${PORT:-4310}"
    exec node apps/app/.output/server/index.mjs
    ;;
  www)
    echo "[midad] starting marketing site on :${PORT:-4313}"
    exec node apps/www/.output/server/index.mjs
    ;;
  docs)
    echo "[midad] starting docs site on :${PORT:-4314}"
    exec node apps/docs/.output/server/index.mjs
    ;;
  *)
    exec "$@"
    ;;
esac
