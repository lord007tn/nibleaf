#!/usr/bin/env bash
#
# Nibleaf backup — Postgres dump + object-storage volume archive.
#
# Usage (from the repo/deploy directory, next to your compose file):
#   ./scripts/backup.sh
#
# Configuration (environment variables, all optional):
#   COMPOSE_FILE    compose file the stack runs from   (default: docker-compose.prod.yml)
#   BACKUP_DIR      where backups are written          (default: ./backups)
#   RETENTION_DAYS  delete local backups older than N  (default: 14)
#   PGUSER          postgres user                      (default: nibleaf)
#   PGDATABASE      postgres database                  (default: nibleaf)
#   STORAGE_VOLUME  docker volume holding maxio data   (default: nibleaf_nibleaf-maxio;
#                   unused/skipped automatically when you use external R2/S3)
#
# Schedule it with cron for a 24h RPO, e.g.:
#   0 3 * * *  cd /opt/nibleaf && ./scripts/backup.sh >> /var/log/nibleaf-backup.log 2>&1
#
# Ship $BACKUP_DIR off the host (rclone/restic/object storage) — a backup on
# the same disk as the database is not a backup.
#
# ── RESTORE ────────────────────────────────────────────────────────────────
# Database (into a running stack; drops and recreates objects it restores):
#   docker compose -f docker-compose.prod.yml exec -T postgres \
#     pg_restore -U nibleaf -d nibleaf --clean --if-exists \
#     < backups/nibleaf-db-<STAMP>.dump
#
# Object storage (stop the stack first so maxio isn't writing):
#   docker compose -f docker-compose.prod.yml stop
#   docker run --rm -v nibleaf_nibleaf-maxio:/data -v "$PWD/backups":/backup \
#     alpine:3.22 sh -c "rm -rf /data/* && tar xzf /backup/nibleaf-storage-<STAMP>.tar.gz -C /data"
#   docker compose -f docker-compose.prod.yml up -d
#
# TEST YOUR RESTORE. An untested backup is a hope, not a plan — restore into a
# scratch database/volume at least once and after every major upgrade.
# ───────────────────────────────────────────────────────────────────────────

set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
PGUSER="${PGUSER:-nibleaf}"
PGDATABASE="${PGDATABASE:-nibleaf}"
STORAGE_VOLUME="${STORAGE_VOLUME:-nibleaf_nibleaf-maxio}"

STAMP="$(date +%Y%m%d-%H%M%S)"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "[backup] FATAL: compose file '$COMPOSE_FILE' not found (set COMPOSE_FILE or cd to your deploy directory)" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

# ── 1. Postgres: pg_dump in custom format (compressed, pg_restore-able) ────
DB_FILE="$BACKUP_DIR/nibleaf-db-$STAMP.dump"
echo "[backup] dumping database '$PGDATABASE' -> $DB_FILE"
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U "$PGUSER" -d "$PGDATABASE" --format=custom > "$DB_FILE"
echo "[backup] database dump done ($(du -h "$DB_FILE" | cut -f1))"

# ── 2. Object storage: tar the bundled maxio volume ────────────────────────
# Skipped when the volume doesn't exist (external R2/S3 deployments — use your
# provider's replication/lifecycle tooling for bucket backups instead).
if docker volume inspect "$STORAGE_VOLUME" >/dev/null 2>&1; then
  STORAGE_FILE="$BACKUP_DIR/nibleaf-storage-$STAMP.tar.gz"
  echo "[backup] archiving storage volume '$STORAGE_VOLUME' -> $STORAGE_FILE"
  docker run --rm \
    -v "$STORAGE_VOLUME":/data:ro \
    -v "$(cd "$BACKUP_DIR" && pwd)":/backup \
    alpine:3.22 tar czf "/backup/nibleaf-storage-$STAMP.tar.gz" -C /data .
  echo "[backup] storage archive done ($(du -h "$STORAGE_FILE" | cut -f1))"
else
  echo "[backup] storage volume '$STORAGE_VOLUME' not found — skipping (external S3/R2?)"
fi

# ── 3. Retention: prune old local backups ──────────────────────────────────
echo "[backup] pruning backups older than $RETENTION_DAYS days"
find "$BACKUP_DIR" -maxdepth 1 -name 'nibleaf-*' -type f -mtime +"$RETENTION_DAYS" -print -delete

echo "[backup] complete: $STAMP"
