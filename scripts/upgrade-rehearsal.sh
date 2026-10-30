#!/usr/bin/env bash
set -euo pipefail
STATUS="$RUNNER_TEMP/upgrade-status.txt"
exec > >(tee -a "$STATUS") 2>&1
checkpoint() { printf 'STATUS %s elapsed=%ss free=%sMiB\n' "$1" "$((SECONDS))" "$(df -m / | awk 'NR==2 {print $4}')"; }
INSTALL="$RUNNER_TEMP/nibleaf-upgrade"
SOURCE="$PWD"
mkdir -p "$INSTALL"
export NIBLEAF_INSTALL_DIR="$INSTALL" NIBLEAF_APP_URL=http://127.0.0.1:4310 NIBLEAF_STORAGE_PUBLIC_ENDPOINT=http://127.0.0.1:9300
export COMPOSE_PROJECT_NAME=nibleaf
checkpoint start
curl -fsSL https://github.com/lord007tn/nibleaf/releases/download/v0.1.2/nibleaf-install.sh -o "$RUNNER_TEMP/nibleaf-install.sh"
curl -fsSL https://github.com/lord007tn/nibleaf/releases/download/v0.1.2/SHA256SUMS -o "$RUNNER_TEMP/SHA256SUMS"
(cd "$RUNNER_TEMP"; grep '  nibleaf-install.sh$' SHA256SUMS | sha256sum -c --status)
# The old installer starts the stack. Capture its output privately: never upload logs.
cat > "$RUNNER_TEMP/install.exp" <<'EXPECT'
set timeout 1500
log_user 0
spawn sh $env(RUNNER_TEMP)/nibleaf-install.sh
expect "Install directory"; send "\r"
expect "Base domain for published sites (optional)"; send "\r"
expect "CNAME target for customer domains (optional)"; send "\r"
expect "Nibleaf image tag"; send "v0.1.2\r"
expect "Enable transactional email delivery for sign-in codes and invitations?"; send "n\r"
expect eof
catch wait result
exit [lindex $result 3]
EXPECT
expect "$RUNNER_TEMP/install.exp"
cd "$INSTALL"
printf "\nEMAIL_DELIVERY_REQUIRED=false\nINTEGRATION_CREDENTIAL_ENCRYPTION_KEY='%s'\n" "$(openssl rand -base64 32)" >> .env
cp .env "$RUNNER_TEMP/preserved.env"
dc() { docker compose "$@"; }
quiet() { "$@" > "$RUNNER_TEMP/private-command.log" 2>&1 || { checkpoint command-failed; return 1; }; }
healthy() {
  for attempt in $(seq 1 90); do
    good=true
    for svc in server worker app; do
      id=$(dc ps -q "$svc")
      if [ -z "$id" ] || [ "$(docker inspect -f '{{.State.Health.Status}}' "$id")" != healthy ]; then good=false; fi
    done
    if "$good"; then return; fi
    sleep 5
  done
  checkpoint health-timeout; return 1
}
quiet dc up -d
healthy
checkpoint installed-v0.1.2
quiet dc exec -T postgres psql -U nibleaf -d nibleaf -c "CREATE TABLE rehearsal_marker (value text); INSERT INTO rehearsal_marker VALUES ('synthetic-upgrade');"
# Scripts resolve dependencies within the image, not from the host checkout.
operator() {
  dc run --rm --no-deps -T -v "$SOURCE/scripts/rehearsal-queues.ts:/app/packages/bullmq/scripts/rehearsal-queues.ts:ro" worker node --import tsx packages/bullmq/scripts/rehearsal-queues.ts "$1"
}
# Read legacy inventory using staged v5, without starting staged services.
NIBLEAF_VERSION="$STAGED" quiet dc pull worker
NIBLEAF_VERSION="$STAGED" operator legacy
checkpoint legacy-confirmed
quiet dc --profile admin stop app admin server
NIBLEAF_VERSION="$STAGED" operator pause
quiet dc stop worker
if [ "$MODE" = staged ]; then
  export NIBLEAF_VERSION="$STAGED"
  dc run --rm --no-deps -T worker pnpm exec tsx packages/bullmq/scripts/migrate-schedules.ts > "$RUNNER_TEMP/before.json"
  jq -e '.schedules | length == 4 and all(.legacy == true and .scheduler == false)' "$RUNNER_TEMP/before.json" >/dev/null
  dc run --rm --no-deps -T worker pnpm exec tsx packages/bullmq/scripts/migrate-schedules.ts --apply > "$RUNNER_TEMP/applied.json"
  dc run --rm --no-deps -T worker pnpm exec tsx packages/bullmq/scripts/migrate-schedules.ts > "$RUNNER_TEMP/after.json"
  for file in applied after; do jq -e '.schedules | length == 4 and all(.scheduler == true and .legacy == false)' "$RUNNER_TEMP/$file.json" >/dev/null; done
  checkpoint migrated-four-schedulers
fi
# Keep .env, volumes and Compose project; only replace the Compose definition.
cp "$SOURCE/docker-compose.prod.yml" docker-compose.yml
export NIBLEAF_VERSION="$CANDIDATE"
quiet dc pull
checkpoint candidate-pulled
# Release old image space only after its stopped containers are removed on this disposable runner.
quiet dc run --rm --no-deps -T migrate
checkpoint candidate-migrations
if [ "$MODE" = direct ]; then
  dc up -d > "$RUNNER_TEMP/private-start.log" 2>&1 || true
  sleep 60
  refused=false
  for svc in worker server; do
    if dc logs "$svc" 2>/dev/null | grep -q 'Unknown recurring configuration'; then refused=true; fi
  done
  "$refused" || { checkpoint direct-refusal-not-observed; exit 1; }
  checkpoint direct-upgrade-refused-unknown-recurring-configuration
else
  quiet dc up -d
  healthy
  operator inventory
  curl -fsS http://127.0.0.1:4310/sign-in >/dev/null
  dc exec -T server curl -fsS http://127.0.0.1:4311/health >/dev/null
  test "$(dc exec -T postgres psql -U nibleaf -d nibleaf -Atc 'SELECT value FROM rehearsal_marker')" = synthetic-upgrade
  cmp -s .env "$RUNNER_TEMP/preserved.env"
  operator resume
  checkpoint candidate-healthy-state-preserved-queues-resumed
fi
checkpoint complete
