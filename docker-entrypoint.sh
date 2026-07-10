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
    echo "[nibleaf] FATAL: BETTER_AUTH_SECRET is unset or a known weak default while NODE_ENV=production." >&2
    echo "[nibleaf] Generate a strong secret and set it in your environment:" >&2
    echo "[nibleaf]     openssl rand -hex 32" >&2
    echo "[nibleaf] See DEPLOYMENT.md for the full production checklist." >&2
    exit 1
  fi
}

# Seed only when explicitly opted in, or in development. Never auto-seed in prod.
should_seed() {
  if [ "${NIBLEAF_RUN_SEED:-}" = "true" ] || [ "${NIBLEAF_RUN_SEED:-}" = "1" ]; then
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
    echo "[nibleaf] applying database migrations…"
    pnpm --filter @nibleaf/database exec prisma migrate deploy
    if should_seed; then
      echo "[nibleaf] seeding demo data…"
      # NIBLEAF_RUN_SEED is an explicit operator opt-in, so pass ALLOW_SEED=1 to
      # clear the seed script's own production guard (it otherwise refuses to
      # seed when NODE_ENV=production). Seeding is idempotent and never runs
      # unless opted in.
      ALLOW_SEED=1 pnpm --filter @nibleaf/server exec tsx src/database/seed/index.ts || echo "[nibleaf] seed skipped (continuing)"
    else
      echo "[nibleaf] skipping seed (set NIBLEAF_RUN_SEED=true to enable)"
    fi
    echo "[nibleaf] migrate complete"
    ;;
  server)
    require_prod_secret
    echo "[nibleaf] starting API server on :${API_PORT:-4311}"
    exec pnpm --filter @nibleaf/server exec tsx src/index.ts
    ;;
  worker)
    require_prod_secret
    echo "[nibleaf] starting worker on :${WORKER_PORT:-4312}"
    exec pnpm --filter @nibleaf/worker exec tsx src/index.ts
    ;;
  app)
    echo "[nibleaf] starting dashboard on :${PORT:-4310}"
    exec node apps/app/.output/server/index.mjs
    ;;
  docs)
    echo "[nibleaf] starting docs site on :${PORT:-4314}"
    exec node apps/docs/.output/server/index.mjs
    ;;
  admin)
    echo "[nibleaf] starting admin panel on :${PORT:-4315}"
    exec node apps/admin/.output/server/index.mjs
    ;;
  *)
    exec "$@"
    ;;
esac
