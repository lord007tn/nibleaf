#!/usr/bin/env bash
PROJECT_OVERRIDE=guide-source-custom
bootstrap
SOURCE_INSTALL=$INSTALL
SOURCE_PROJECT=$COMPOSE_PROJECT_NAME
run backup 0 backup-custom-project
SOURCE_STAMP=$STAMP
SOURCE_VOLUME=$MAXIO_VOLUME
export STAMP
for f in "backups/nibleaf-db-$STAMP.dump" "backups/nibleaf-storage-$STAMP.tar.gz";do test -s "$f";done
case $MAXIO_VOLUME in guide-source-custom_*) ;;*)record backup-custom-project FAIL 'wrong volume selected';exit 1;;esac
record backup-volume-identity PASS 'actual mounted volume found for custom Compose project'
TARGET="$RUNNER_TEMP/isolated-restore"
mkdir -p "$TARGET/backups"
cp docker-compose.yml "$TARGET/docker-compose.yml"
cp .env "$TARGET/.env"
cp "backups/nibleaf-db-$STAMP.dump" "$TARGET/backups/"
cp "backups/nibleaf-storage-$STAMP.tar.gz" "$TARGET/backups/"
cd "$TARGET"
# Different project, network, named volumes and application origin on this disposable host.
export COMPOSE_PROJECT_NAME=guide-target-custom
printf '\nAPP_PORT=4320\nAPP_URL=http://127.0.0.1:4320\n' >> .env
quiet docker compose up -d;healthy
run backup 1 isolated-restore
healthy;marker
TARGET_VOL=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$(docker compose ps -q maxio)")
case $TARGET_VOL in guide-target-custom_*) ;;*)return 1;;esac
test "$TARGET_VOL" != "$SOURCE_VOLUME"
quiet docker run --rm -v "$TARGET_VOL:/data:ro" alpine:3.22 sh -c 'test "$(cat /data/rehearsal-marker)" = before-upgrade'
record isolated-restore-marker PASS 'database and object marker restored on separate custom project/origin/volumes'
cp "backups/nibleaf-db-$STAMP.dump" "$PRIVATE/good.dump"
printf 'invalid disposable archive\n' > "backups/nibleaf-db-$STAMP.dump"
log="$PRIVATE/restore-corrupt.log"
bash -e "$PUBLIC/backup-en-1.sh" > "$log" 2>&1
# The literal guard echoes Stop and returns zero; assert behavior, not just exit code.
grep -q '^Stop: restore failed; do not start application services.' "$log"
grep -q '^pg_restore: error:' "$log"
safe_errors;stopped
record pg-restore-failure PASS 'Stop message printed; all app services stay stopped'
cp "$PRIVATE/good.dump" "backups/nibleaf-db-$STAMP.dump"
quiet docker compose up -d;healthy
# Remove only this disposable target container, retaining its named volume.
quiet docker compose stop maxio
quiet docker compose rm -f maxio
log="$PRIVATE/restore-volume-missing.log"
bash -e "$PUBLIC/backup-en-1.sh" > "$log" 2>&1
grep -q '^Stop: restore failed; do not start application services.' "$log"
safe_errors;stopped
record volume-lookup-failure PASS 'Stop message printed; no app restart and no replacement volume'
quiet docker compose up -d;healthy
run backup 1 restore-after-negative-cases
healthy;marker
# Source stack remains independently live and untouched.
cd "$SOURCE_INSTALL";export COMPOSE_PROJECT_NAME=$SOURCE_PROJECT
healthy;marker
record separate-source-preserved PASS 'original stack and source marker still healthy'
record off-host-copy NOT-RUN 'same runner, fully isolated stack; no backups or credentials uploaded'
record complete PASS 'backup/restore/negative guards/custom project completed'
