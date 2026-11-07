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
#   COMPOSE_PROJECT_NAME  optional Compose project override (also honors compose name:)
#   BACKUP_STORAGE  bundled (default) or external (explicitly skip object backup)
#   STORAGE_VOLUME  optional assertion: must match the selected maxio /data mount
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
#   docker run --rm -v <volume-from-backup-manifest>:/data -v "$PWD/backups":/backup \
#     alpine:3.22 sh -c "rm -rf /data/* && tar xzf /backup/nibleaf-storage-<STAMP>.tar.gz -C /data"
#   docker compose -f docker-compose.prod.yml up -d
#
# TEST YOUR RESTORE. An untested backup is a hope, not a plan — restore into a
# scratch database/volume at least once and after every major upgrade.
# ───────────────────────────────────────────────────────────────────────────

set -euo pipefail
umask 077

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
PGUSER="${PGUSER:-nibleaf}"
PGDATABASE="${PGDATABASE:-nibleaf}"
BACKUP_STORAGE="${BACKUP_STORAGE:-bundled}"
STAMP="$(date +%Y%m%d-%H%M%S)-$$"

fatal() { echo "[backup] FATAL: $*" >&2; exit 1; }
[[ -f "$COMPOSE_FILE" ]] || fatal "compose file '$COMPOSE_FILE' not found"
[[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || fatal "RETENTION_DAYS must be a nonnegative integer"
[[ "$BACKUP_STORAGE" = bundled || "$BACKUP_STORAGE" = external ]] || fatal "BACKUP_STORAGE must be bundled or external"

# Compose resolves name:, --project-name via COMPOSE_PROJECT_NAME, and the chosen
# file's directory. Never guess a volume name from another installation.
PG_CONTAINER="$(docker compose -f "$COMPOSE_FILE" ps -q postgres)"
[[ -n "$PG_CONTAINER" && "$PG_CONTAINER" != *$'\n'* ]] || fatal "expected exactly one selected postgres container"
PROJECT="$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$PG_CONTAINER")"
[[ "$PROJECT" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || fatal "could not identify the selected Compose project"
VOLUME=""
if [[ "$BACKUP_STORAGE" = bundled ]]; then
  STORAGE_CONTAINER="$(docker compose -f "$COMPOSE_FILE" ps -q maxio)"
  [[ -n "$STORAGE_CONTAINER" && "$STORAGE_CONTAINER" != *$'\n'* ]] || fatal "bundled maxio container missing; use BACKUP_STORAGE=external only for external storage"
  STORAGE_PROJECT="$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$STORAGE_CONTAINER")"
  [[ "$STORAGE_PROJECT" = "$PROJECT" ]] || fatal "maxio belongs to a different Compose project"
  VOLUME="$(docker inspect --format '{{range .Mounts}}{{if and (eq .Destination "/data") (eq .Type "volume")}}{{println .Name}}{{end}}{{end}}' "$STORAGE_CONTAINER")"
  [[ "$VOLUME" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || fatal "expected a named maxio /data volume"
  [[ -z "${STORAGE_VOLUME:-}" || "$STORAGE_VOLUME" = "$VOLUME" ]] || fatal "STORAGE_VOLUME does not match the selected maxio mount"
  docker volume inspect "$VOLUME" >/dev/null || fatal "selected storage volume is missing"
fi

mkdir -p "$BACKUP_DIR"
DB_FILE="$BACKUP_DIR/nibleaf-db-$STAMP.dump"
STORAGE_FILE="$BACKUP_DIR/nibleaf-storage-$STAMP.tar.gz"
MANIFEST_FILE="$BACKUP_DIR/nibleaf-manifest-$STAMP.json"
trap 'rm -f "$DB_FILE.partial" "$STORAGE_FILE.partial" "$MANIFEST_FILE.partial"' EXIT

echo "[backup] dumping database '$PGDATABASE' from project '$PROJECT'"
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U "$PGUSER" -d "$PGDATABASE" --format=custom > "$DB_FILE.partial"
mv "$DB_FILE.partial" "$DB_FILE"

if [[ "$BACKUP_STORAGE" = bundled ]]; then
  echo "[backup] archiving project '$PROJECT' storage volume '$VOLUME'"
  # Redirect stdout on the host so the archive inherits umask 077 as well.
  docker run --rm -v "$VOLUME":/data:ro alpine:3.22 tar czf - -C /data . > "$STORAGE_FILE.partial"
  mv "$STORAGE_FILE.partial" "$STORAGE_FILE"
else
  echo "[backup] external storage explicitly selected; back up its bucket separately"
fi

printf '{"project":"%s","storageMode":"%s","storageVolume":"%s","databaseFile":"%s","storageFile":"%s"}\n' \
  "$PROJECT" "$BACKUP_STORAGE" "$VOLUME" "${DB_FILE##*/}" \
  "$(if [[ "$BACKUP_STORAGE" = bundled ]]; then printf '%s' "${STORAGE_FILE##*/}"; fi)" > "$MANIFEST_FILE.partial"
mv "$MANIFEST_FILE.partial" "$MANIFEST_FILE"

# Prune only after every requested backup step and the manifest succeeded.
echo "[backup] pruning backups older than $RETENTION_DAYS days"
find "$BACKUP_DIR" -maxdepth 1 -name 'nibleaf-*' -type f -mtime +"$RETENTION_DAYS" -print -delete
echo "[backup] complete: $STAMP (project $PROJECT)"
