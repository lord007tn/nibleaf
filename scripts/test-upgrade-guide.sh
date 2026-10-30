#!/usr/bin/env bash
set -Eeuo pipefail
HARNESS_SOURCE="$PWD"
PUBLIC="$RUNNER_TEMP/guide-public"
PRIVATE="$RUNNER_TEMP/guide-private"
mkdir -p "$PUBLIC" "$PRIVATE"
export PUBLIC PRIVATE
CANDIDATE=sha-ddb4a384109dea7bf485f7b0ae7a3932b796cc95
if ! docker manifest inspect "ghcr.io/lord007tn/nibleaf:$CANDIDATE" > /dev/null 2>&1; then
  CANDIDATE=sha-bbef8d8e85b1250092a3fa71e99682ba2cfa613a
fi
export CANDIDATE
python3 scripts/extract-upgrade-guide.py
printf '| Step | Result | Elapsed seconds | Free MiB | Evidence |\n|---|---|---:|---:|---|\n' > "$PUBLIC/results.md"
CURRENT=bootstrap
log="$PRIVATE/bootstrap.log"
record() {
  printf '| %s | %s | %s | %s | %s |\n' "$1" "$2" "$SECONDS" "$(df -m / | awk 'NR==2 {print $4}')" "${3:-}" | tee -a "$PUBLIC/results.md"
}
safe_failure() {
  # Only deterministic operator/SQL/checksum errors, never container/env diagnostics.
  grep -E '^(ERROR:|FATAL:|queues [a-z]+:|sha256sum:|docker-compose.yml:)' "$log" | tail -12 | tee -a "$PUBLIC/failures.txt" || true
}
trap 'rc=$?; record "$CURRENT" FAIL "exit=$rc"; safe_failure; exit "$rc"' ERR
runblock() {
  local id=$1
  CURRENT="${2:-block-$id}"
  log="$PRIVATE/$CURRENT.log"
  source "$PUBLIC/block-$id.sh" > "$log" 2>&1
  record "$CURRENT" PASS "extracted block $id"
}
quiet() { "$@" > "$PRIVATE/fixture.log" 2>&1; }
healthy() {
  for attempt in $(seq 1 90); do
    good=true
    for svc in server worker app; do
      id=$(docker compose ps -q "$svc")
      if [ -z "$id" ] || [ "$(docker inspect -f '{{.State.Health.Status}}' "$id")" != healthy ]; then good=false; fi
    done
    if "$good"; then return; fi
    sleep 3
  done
  return 1
}
# Bootstrap is deliberately the old published installer, not guide command text.
INSTALL="$RUNNER_TEMP/guide-install"
mkdir -p "$INSTALL"
export NIBLEAF_INSTALL_DIR="$INSTALL" NIBLEAF_APP_URL=http://127.0.0.1:4310 NIBLEAF_STORAGE_PUBLIC_ENDPOINT=http://127.0.0.1:9300
export COMPOSE_PROJECT_NAME=nibleaf
curl -fsSL https://github.com/lord007tn/nibleaf/releases/download/v0.1.2/nibleaf-install.sh -o "$RUNNER_TEMP/nibleaf-install.sh"
curl -fsSL https://github.com/lord007tn/nibleaf/releases/download/v0.1.2/SHA256SUMS -o "$RUNNER_TEMP/SHA256SUMS"
(cd "$RUNNER_TEMP"; grep '  nibleaf-install.sh$' SHA256SUMS | sha256sum -c --status)
cat > "$PRIVATE/install.exp" <<'EXPECT'
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
expect "$PRIVATE/install.exp"
cd "$INSTALL"
printf '\nEMAIL_DELIVERY_REQUIRED=false\n' >> .env
quiet docker compose up -d
healthy
record bootstrap PASS 'healthy v0.1.2; synthetic no-email readiness override'
quiet docker compose exec -T postgres psql -U nibleaf -d nibleaf -c "CREATE TABLE rehearsal_marker (value text); INSERT INTO rehearsal_marker VALUES ('before-upgrade');"
quiet docker run --rm -v nibleaf_nibleaf-maxio:/data alpine:3.22 sh -c 'echo before-upgrade > /data/rehearsal-marker'
# The duplicate-account query is independent and may fail without preventing other coverage.
log="$PRIVATE/duplicates.log"
if bash -e "$PUBLIC/block-0.sh" > "$log" 2>&1; then
  grep -q '(0 rows)' "$log"
  record duplicate-query PASS '(0 rows)'
else
  record duplicate-query FAIL 'exact SQL output in failures.txt'
  safe_failure
fi
# Block 1 explicitly says to skip it in an installer directory.
record block-1 NOT-RUN 'guide says skip COMPOSE_FILE export for installer layout'
runblock 2
runblock 3
runblock 4 inline-helper
export -f operator
runblock 5
runblock 6 staged-image-and-legacy
grep '^\["ghcr.io/lord007tn/nibleaf@sha256:' "$log" > "$PUBLIC/staged-digest.txt"
grep -q 'sha256:880938a6ab865487f0b85733eeb2c20da06de34dcce1bdb5a8f35f694e4a3da8' "$PUBLIC/staged-digest.txt"
record staged-digest PASS 'RepoDigests matches the exact guide digest' 
if [ "$MODE" = recovery ]; then
  # Deliberately skip stage migration, then execute the guide candidate setup.
  runblock 14 recovery-compose
  STAMP=skipped-stage
  mkdir -m 700 -p backups
  runblock 15 recovery-pin
  # Direct startup is expected to refuse; preserve private output.
  if bash -e "$PUBLIC/block-16.sh" > "$PRIVATE/direct-start.log" 2>&1; then :; fi
  sleep 15
  if docker compose logs server worker 2>/dev/null | grep -q 'Unknown recurring configuration'; then
    record direct-refusal PASS 'Unknown recurring configuration observed'
  else
    record direct-refusal FAIL 'expected refusal missing'; exit 1
  fi
  runblock 3 recovery-shell
  runblock 4 recovery-helper
  runblock 22 recovery-stop
  for id in 8 10 11 12 13; do runblock "$id" "recovery-$id"; done
  # Literal prose says skip 9/10 and finish 11. Capture its selected image first.
  docker compose config --images | grep nibleaf > "$PUBLIC/recovery-selected-images.txt"
  if grep -q ":$STAGED" "$PUBLIC/recovery-selected-images.txt"; then
    record recovery-literal FAIL 'step 6 leaves staged export; step 11 would start staged services'
    printf '%s\n' 'REPLACEMENT: After recovery steps 4–8, run `unset NIBLEAF_VERSION` before step 11. Confirm `docker compose config --images` selects the .env candidate.' >> "$PUBLIC/fixes.txt"
    # Honour the guide prohibition against running staged services. Test repair separately.
    record recovery-literal-start NOT-RUN 'guard: guide forbids staged image as a service'
    unset NIBLEAF_VERSION
  fi
  runblock 16 recovery-repaired-start
  healthy
  runblock 17 recovery-repaired-health-migrations
  runblock 18 recovery-repaired-inventory-http
  runblock 19 recovery-repaired-resume
  test "$(docker compose exec -T postgres psql -U nibleaf -d nibleaf -Atc 'SELECT value FROM rehearsal_marker')" = before-upgrade
  record recovery-repaired PASS 'healthy candidate and original marker preserved'
  exit 0
fi
runblock 7 stop-producers
# Real waiting job; the old worker is stopped so it cannot race the refusal probe.
quiet docker compose stop worker
cat > queue-fixture.ts <<'TS'
import { Queue } from 'bullmq';
import { producerConnectionConfig } from '../src/redis';
import { getQueueName } from '../src/utils/queue';
const queue = new Queue(getQueueName('export'), { connection: producerConnectionConfig, skipMetasUpdate: true });
try {
  if (process.argv[2] === 'add') await queue.add('cleanup-exports', {requestedAt: new Date().toISOString()}, {jobId:'guide-waiting-fixture',removeOnComplete:false});
  else {
    let done=false;
    for(let i=0;i<60;i++) { if(await (await queue.getJob('guide-waiting-fixture'))?.getState()==='completed') {done=true;break;} await new Promise(r=>setTimeout(r,1000)); }
    if(!done) throw new Error('Synthetic maintenance job did not finish');
  }
  console.log('synthetic queue fixture: PASS');
} finally {await queue.close();}
TS
fixture() { NIBLEAF_VERSION="$STAGED" docker compose run --rm --no-deps -T -v "$PWD/queue-fixture.ts:/app/packages/bullmq/scripts/queue-fixture.ts:ro" worker node --import tsx packages/bullmq/scripts/queue-fixture.ts "$1"; }
quiet fixture add
log="$PRIVATE/pause-refusal.log"
if bash -e "$PUBLIC/block-8.sh" > "$log" 2>&1; then
  record pause-with-waiting-job FAIL 'unexpected success'; exit 1
else
  grep -q 'queues pause: FAIL' "$log"
  record pause-with-waiting-job PASS 'refused with queues pause: FAIL'
  safe_failure
fi
runblock 9 pause-retry-resume
quiet fixture wait
record waiting-work-completed PASS 'real cleanup-exports job completed without drain/delete'
runblock 8 pause-retry-second-pause
runblock 10 backup
for f in "backups/env-$STAMP" "backups/compose-$STAMP.yml" "backups/nibleaf-db-$STAMP.dump" "backups/nibleaf-storage-$STAMP.tar.gz"; do test -s "$f"; done
cp -p "backups/env-$STAMP" "$PRIVATE/env-backup-copy"
quiet docker compose exec -T postgres pg_restore --list < "backups/nibleaf-db-$STAMP.dump"
quiet docker run --rm -v "$PWD/backups":/backup alpine:3.22 tar tzf "/backup/nibleaf-storage-$STAMP.tar.gz"
record backup-validation PASS 'four nonempty files; archive/dump readable'
for id in 11 12 13; do runblock "$id"; done
runblock 14 verified-compose-download
# Re-run the guide's exact checksum command on a deliberately modified fixture.
printf '\n# tampered\n' >> "$d/docker-compose.yml"
log="$PRIVATE/tamper.log"
if (cd "$d" && grep '  docker-compose.yml$' SHA256SUMS | sha256sum -c -) > "$log" 2>&1; then
  record checksum-tamper FAIL 'tamper accepted'; exit 1
else
  record checksum-tamper PASS 'tampered fixture rejected'; safe_failure
fi
runblock 15 env-pin-and-unset
if env -u NIBLEAF_VERSION bash -c 'docker compose config --images' | grep 'ghcr.io/lord007tn/nibleaf:' | grep -v ":$CANDIDATE"; then
  record fresh-shell-tag FAIL 'unexpected image'; exit 1
fi
record fresh-shell-tag PASS '.env selects candidate with no exported tag'
runblock 16 start-candidate
healthy
runblock 17 health-and-migrations
# Assert the guide's query really returns the documented seven names, not merely exit zero.
grep -E '^202[0-9]{11}_' "$log" | sort > "$PUBLIC/migrations.txt"
test "$(wc -l < "$PUBLIC/migrations.txt")" = 7
cmp -s "$PUBLIC/migrations.txt" "$PUBLIC/expected-migrations.txt"
record migration-list PASS 'exact seven documented migration names' 
runblock 18 inventory-http
runblock 19 resume
runblock 20 digest
cp "$log" "$PUBLIC/candidate-digest.txt"
# Test the exact key command, then actual crypto module roundtrip in candidate runtime.
runblock 29 integration-key-missing
crypto_probe() {
  docker compose run --rm --no-deps -T server sh -c 'cd apps/server && node --import tsx --input-type=module -e '\''try { const {encryptIntegrationSecret,decryptIntegrationSecret}=await import("./src/actions/integrations/crypto.ts"); const value=encryptIntegrationSecret("synthetic-guide-check"); if(decryptIntegrationSecret(value)!=="synthetic-guide-check") process.exit(1); console.log("crypto roundtrip: PASS"); } catch(error) {const allowed=["Integration credential encryption is not configured.","Integration credential encryption requires a base64-encoded 32-byte key."]; console.log(allowed.includes(error?.message)?error.message:"crypto roundtrip: FAIL (private diagnostic withheld)");process.exit(1)}'\'''
}
quiet crypto_probe
record integration-key-format PASS 'candidate crypto module encrypt/decrypt roundtrip'
cp .env "$PRIVATE/env-with-valid-key"
runblock 29 integration-key-preserve
cmp -s .env "$PRIVATE/env-with-valid-key"
record integration-key-preserved PASS 'valid existing key unchanged'
# Common quoted-empty setting: test same command, do not manufacture a replacement key silently.
sed -i "s/^INTEGRATION_CREDENTIAL_ENCRYPTION_KEY=.*/INTEGRATION_CREDENTIAL_ENCRYPTION_KEY=''/" .env
runblock 29 integration-key-quoted-empty
log="$PRIVATE/crypto-empty.log"
if crypto_probe > "$log" 2>&1; then record integration-empty-behavior PASS 'key accepted'; else
  record integration-empty-behavior FAIL 'quoted empty value prevents generation; crypto rejects key';
  grep -E '^crypto roundtrip:|^Integration credential encryption' "$log" >> "$PUBLIC/failures.txt" || true
fi
# Test proposed replacement separately, without editing the pinned MDX.
CURRENT=integration-key-proposed-repair
log="$PRIVATE/key-repair.log"
source "$HARNESS_SOURCE/scripts/proposed-integration-key.sh" > "$log" 2>&1
quiet crypto_probe
record integration-key-proposed-repair PASS 'quoted-empty field repaired; actual crypto roundtrip passes'
cp .env "$PRIVATE/env-repaired-key"
source "$HARNESS_SOURCE/scripts/proposed-integration-key.sh" > "$PRIVATE/key-repair-preserve.log" 2>&1
cmp -s .env "$PRIVATE/env-repaired-key"
record integration-key-proposed-preserve PASS 'valid key preserved byte-for-byte'
cp "$HARNESS_SOURCE/scripts/proposed-integration-key.sh" "$PUBLIC/proposed-integration-key.sh"
cp "$PRIVATE/env-with-valid-key" .env
quiet docker compose up -d
healthy
# Add post-backup changes to prove both rollback restore and retained failed-upgrade DB.
quiet docker compose exec -T postgres psql -U nibleaf -d nibleaf -c "INSERT INTO rehearsal_marker VALUES ('after-upgrade');"
quiet docker run --rm -v nibleaf_nibleaf-maxio:/data alpine:3.22 sh -c 'echo after-upgrade > /data/rehearsal-after'
# Rollback prose: recreate helper, clear shell tag, keep original STAMP.
runblock 3 rollback-shell
runblock 4 rollback-helper
unset NIBLEAF_VERSION
for id in 23 24 25 26 27 28; do runblock "$id" "rollback-$id"; done
healthy
record rollback-health PASS 'v0.1.2 server/worker/app healthy'
test "$(docker compose exec -T postgres psql -U nibleaf -d nibleaf -Atc 'SELECT value FROM rehearsal_marker')" = before-upgrade
test "$(docker compose exec -T postgres psql -U nibleaf -d nibleaf_failed_upgrade -Atc 'SELECT count(*) FROM rehearsal_marker')" = 2
quiet docker run --rm -v nibleaf_nibleaf-maxio:/data:ro alpine:3.22 sh -c 'test "$(cat /data/rehearsal-marker)" = before-upgrade && test ! -e /data/rehearsal-after'
cmp -s .env "$PRIVATE/env-backup-copy"
record rollback-preservation PASS 'marker restored; upgraded DB retained; storage restored; original env identical'
record product-journey NOT-RUN 'no email/OAuth provider; no real sign-in, image upload, publish, search, export journey'
record complete PASS 'literal failures reported separately; no docs modified'
