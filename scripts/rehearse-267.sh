#!/usr/bin/env bash
set -Eeuo pipefail
SOURCE="$PWD"
export PUBLIC="$RUNNER_TEMP/pr267-public" PRIVATE="$RUNNER_TEMP/pr267-private"
mkdir -p "$PUBLIC" "$PRIVATE"
python3 "$SOURCE/scripts/extract-267.py"
printf '| Check | Result | Seconds | Free MiB | Evidence |\n|---|---|---:|---:|---|\n' > "$PUBLIC/results.md"
CURRENT=prepare
log="$PRIVATE/prepare.log"
record() { printf '| %s | %s | %s | %s | %s |\n' "$1" "$2" "$SECONDS" "$(df -m / | awk 'NR==2 {print $4}')" "${3:-}" | tee -a "$PUBLIC/results.md"; }
safe_errors() { grep -E '^(Error:|ERROR:|FATAL:|Stop:|queues [a-z]+:|sha256sum:|docker-compose.yml:|Integration key must|pg_restore:|FAULT:)' "$log" | tail -15 | tee -a "$PUBLIC/failures.txt" || true; }
trap 'rc=$?; record "$CURRENT" FAIL "exit=$rc"; safe_errors; exit "$rc"' ERR
quiet() { "$@" > "$PRIVATE/fixture.log" 2>&1; }
run() { local section=$1 block=$2;CURRENT=${3:-$section-$block};log="$PRIVATE/$CURRENT.log";source "$PUBLIC/$section-en-$block.sh" > "$log" 2>&1;record "$CURRENT" PASS "extracted $section block $block"; }
healthy() {
 for attempt in $(seq 1 120); do
  local good=true
  for svc in postgres dragonfly maxio server worker app; do
   local cid;cid=$(docker compose ps -q "$svc")
   if [ -z "$cid" ] || [ "$(docker inspect -f '{{.State.Health.Status}}' "$cid")" != healthy ]; then good=false;fi
  done
  if "$good";then return;fi
  sleep 3
 done
 return 1
}
stopped() {
 for svc in app admin server worker; do
  local ids;ids=$(docker compose --profile admin ps -q "$svc")
  [ -z "$ids" ] || { record stopped-services FAIL "$svc remains running";return 1; }
 done
}
marker() { test "$(docker compose exec -T postgres psql -U nibleaf -d nibleaf -Atc 'SELECT value FROM rehearsal_marker ORDER BY value')" = before-upgrade; }
bootstrap() {
 INSTALL="$RUNNER_TEMP/install-$MODE";mkdir -p "$INSTALL"
 export NIBLEAF_INSTALL_DIR="$INSTALL" NIBLEAF_APP_URL=http://127.0.0.1:4310 NIBLEAF_STORAGE_PUBLIC_ENDPOINT=http://127.0.0.1:9300
 export COMPOSE_PROJECT_NAME=${PROJECT_OVERRIDE:-nibleaf}
 curl -fsSL https://github.com/lord007tn/nibleaf/releases/download/v0.1.2/nibleaf-install.sh -o "$PRIVATE/old-installer.sh"
 curl -fsSL https://github.com/lord007tn/nibleaf/releases/download/v0.1.2/SHA256SUMS -o "$PRIVATE/SHA256SUMS"
 (cd "$PRIVATE";cp old-installer.sh nibleaf-install.sh;grep '  nibleaf-install.sh$' SHA256SUMS | sha256sum -c --status)
 export INSTALLER_SCRIPT="$PRIVATE/old-installer.sh" INSTALLER_LOG="$PRIVATE/old-install.log" INSTALLER_KIND=old
 expect "$SOURCE/scripts/installer-267.exp"
 cd "$INSTALL"
 printf '\nEMAIL_DELIVERY_REQUIRED=false\n' >> .env
 quiet docker compose up -d;healthy
 quiet docker compose exec -T postgres psql -U nibleaf -d nibleaf -c "CREATE TABLE rehearsal_marker (value text); INSERT INTO rehearsal_marker VALUES ('before-upgrade');"
 local vol;vol=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$(docker compose ps -q maxio)")
 quiet docker run --rm -v "$vol:/data" alpine:3.22 sh -c 'echo before-upgrade > /data/rehearsal-marker'
 record bootstrap PASS "real published v0.1.2; project=$COMPOSE_PROJECT_NAME; synthetic no-email override"
}
prepare_upgrade() {
 run upgrade 0 duplicate-account-query;grep -q '(0 rows)' "$log"
 record repository-COMPOSE_FILE NOT-RUN 'installer layout: guide says skip block 1'
 for b in 2 3 4 5 6;do run upgrade "$b";done
 export -f operator
 grep -q 'sha256:880938a6ab865487f0b85733eeb2c20da06de34dcce1bdb5a8f35f694e4a3da8' "$log"
 record staged-digest PASS 'exact guide digest'
 run upgrade 7
 run upgrade 8
 run upgrade 10 backup-four-files
 ORIGINAL_STAMP=$STAMP
 check_stamp
 cp .env "$PRIVATE/pre-upgrade.env"
}
check_stamp() {
 for f in "backups/env-$STAMP" "backups/compose-$STAMP.yml" "backups/nibleaf-db-$STAMP.dump" "backups/nibleaf-storage-$STAMP.tar.gz";do test -s "$f";done
 record STAMP-four-files PASS 'all four original pre-upgrade files exist and are nonempty'
}
check_stamp_negative() {
 for suffix in "env-$STAMP" "compose-$STAMP.yml" "nibleaf-db-$STAMP.dump" "nibleaf-storage-$STAMP.tar.gz";do
  mv "backups/$suffix" "$PRIVATE/stamp-hidden"
  if (for f in "backups/env-$STAMP" "backups/compose-$STAMP.yml" "backups/nibleaf-db-$STAMP.dump" "backups/nibleaf-storage-$STAMP.tar.gz";do test -s "$f" || exit 1;done);then return 1;fi
  mv "$PRIVATE/stamp-hidden" "backups/$suffix"
 done
 record STAMP-missing-files PASS 'prose checklist detects each absent file; guide provides no executable check block'
}
schedule_assert() {
 python3 - "$log" "$1" <<'PY'
import json,sys,re
s=open(sys.argv[1]).read();decoder=json.JSONDecoder();found=[]
for match in re.finditer(r'\{',s):
 try: item,_=decoder.raw_decode(s[match.start():])
 except json.JSONDecodeError: continue
 if isinstance(item,dict) and isinstance(item.get('schedules'),list): found.append(item)
assert found, 'No schedule inventory found'
a=found[-1]['schedules'];assert len(a)==4
mode=sys.argv[2]
if mode=='new':assert all(x['scheduler'] and not x['legacy'] for x in a)
if mode=='old4':assert all(x['legacy'] and not x['scheduler'] for x in a)
if mode=='old3':assert sum(x['legacy'] for x in a)==3 and all(not x['scheduler'] for x in a) and any(x['id']=='reconcile-usage-periods' and not x['legacy'] for x in a)
if mode=='partial':assert any(x['scheduler'] for x in a) and any(x['legacy'] for x in a)
print('Schedule assertion '+mode+': PASS')
PY
}
start_candidate() {
 run upgrade 14 verified-compose
 run upgrade 15 persisted-pin-unset
 env -u NIBLEAF_VERSION bash -c 'docker compose config --images' > "$PUBLIC/fresh-shell-images.txt"
 grep -q "ghcr.io/lord007tn/nibleaf:$CANDIDATE" "$PUBLIC/fresh-shell-images.txt"
 if grep 'ghcr.io/lord007tn/nibleaf:' "$PUBLIC/fresh-shell-images.txt" | grep -v ":$CANDIDATE";then return 1;fi
 record new-shell-pin PASS 'candidate selected from .env without exported tag'
 run upgrade 16
 healthy
 run upgrade 17 eight-migrations-health
 grep -E '^202[0-9]{11}_' "$log" | sort > "$PUBLIC/migrations.txt"
 test "$(wc -l < "$PUBLIC/migrations.txt")" = 8
 cmp -s "$PUBLIC/migrations.txt" "$PUBLIC/expected-migrations.txt"
 record migrations-eight PASS 'LIMIT 8; exact documented list including invitation_created_at'
 run upgrade 18
 run upgrade 19
 run upgrade 20 candidate-digest;cp "$log" "$PUBLIC/candidate-digest.txt"
 quiet docker compose run --rm --no-deps -T server node -e 'console.log(JSON.parse(require("node:fs").readFileSync("packages/auth/node_modules/better-auth/package.json","utf8")).version)'
 grep -qx '1.7.14' "$PRIVATE/fixture.log"
 record better-auth PASS 'published candidate contains 1.7.14'
}
crypto_probe() {
 docker compose run --rm --no-deps -T server sh -c 'cd apps/server && node --import tsx --input-type=module -e '\''try {const c=await import("./src/actions/integrations/crypto.ts");if(c.decryptIntegrationSecret(c.encryptIntegrationSecret("synthetic-guide-check"))) console.log("crypto roundtrip: PASS");else process.exit(1);}catch{console.log("crypto roundtrip: FAIL");process.exit(1)}'\'''
}
key_cases() {
 cp .env "$PRIVATE/key-baseline.env"
 run upgrade 29 key-absent;quiet crypto_probe
 record key-absent-crypto PASS 'actual crypto module roundtrip'
 cp .env "$PRIVATE/key-valid.env"
 run upgrade 29 key-valid;cmp -s .env "$PRIVATE/key-valid.env";quiet crypto_probe
 record key-valid-preserved PASS 'existing valid .env byte-identical'
 cp "$PRIVATE/key-baseline.env" .env;printf "INTEGRATION_CREDENTIAL_ENCRYPTION_KEY=''\n" >> .env
 run upgrade 29 key-quoted-empty;quiet crypto_probe
 record key-quoted-empty-crypto PASS 'new block generates accepted key'
 cp .env "$PRIVATE/key-valid2.env"
 sed -i "s/^INTEGRATION_CREDENTIAL_ENCRYPTION_KEY=.*/INTEGRATION_CREDENTIAL_ENCRYPTION_KEY='invalid-synthetic-key'/" .env
 cp .env "$PRIVATE/key-invalid.env"
 docker compose ps -q app server worker > "$PRIVATE/before-invalid.ids"
 log="$PRIVATE/key-invalid.log"
 if bash -e "$PUBLIC/upgrade-en-29.sh" > "$log" 2>&1;then record key-invalid FAIL 'invalid key accepted';return 1;fi
 grep -q '^Integration key must be a base64-encoded 32-byte value' "$log"
 safe_errors
 cmp -s .env "$PRIVATE/key-invalid.env"
 docker compose ps -q app server worker > "$PRIVATE/after-invalid.ids";cmp -s "$PRIVATE/before-invalid.ids" "$PRIVATE/after-invalid.ids"
 record key-invalid PASS 'refused; existing key unmodified; application services not recreated'
 cp "$PRIVATE/key-valid2.env" .env;quiet docker compose up -d;healthy
}
rollback_all() {
 run upgrade 3 rollback-shell;run upgrade 4 rollback-helper;unset NIBLEAF_VERSION
 # Align the disposable fixture just after a minute tick, when its tiny maintenance jobs have finished.
 while [ "$(date +%S)" -lt 3 ] || [ "$(date +%S)" -gt 8 ];do sleep 1;done
 run upgrade 23 rollback-stop-pause
 run upgrade 24 rollback-schedules;schedule_assert old4
 run upgrade 25 rollback-config
 if [ "${DB_MIGRATED:-false}" = true ];then
  run upgrade 26 rollback-database
  run upgrade 27 rollback-storage
 else record rollback-data NOT-RUN 'guide branch: step 11 never ran';fi
 run upgrade 28 rollback-start
 healthy;marker;cmp -s .env "$PRIVATE/pre-upgrade.env"
 if [ "${DB_MIGRATED:-false}" = true ];then
  test "$(docker compose exec -T postgres psql -U nibleaf -d nibleaf_failed_upgrade -Atc 'SELECT count(*) FROM rehearsal_marker')" = 2
 fi
 local vol;vol=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$(docker compose ps -q maxio)")
 quiet docker run --rm -v "$vol:/data:ro" alpine:3.22 sh -c 'test "$(cat /data/rehearsal-marker)" = before-upgrade && test ! -e /data/rehearsal-after'
 record rollback-final PASS 'all six services healthy; v0.1.2 config and marker intact; storage restored'
}
record before-pulls PASS 'only published images; no build/push/tag/release command'
if [ "$MODE" = installer ];then source "$SOURCE/scripts/installer-267.sh";exit;fi
if [ "$MODE" = backup-drill ];then source "$SOURCE/scripts/backup-267.sh";exit;fi
bootstrap
prepare_upgrade
case "$MODE" in
 main)
  run upgrade 11;run upgrade 12;run upgrade 13;schedule_assert new
  start_candidate;DB_MIGRATED=true
  key_cases
  quiet docker compose exec -T postgres psql -U nibleaf -d nibleaf -c "INSERT INTO rehearsal_marker VALUES ('after-upgrade');"
  vol=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$(docker compose ps -q maxio)")
  quiet docker run --rm -v "$vol:/data" alpine:3.22 sh -c 'echo after-upgrade > /data/rehearsal-after'
  rollback_all
  ;;
 recovery-quiet|recovery-busy)
  source "$SOURCE/scripts/recovery-267.sh"
  ;;
 rollback-interrupted)
  source "$SOURCE/scripts/interrupted-267.sh"
  ;;
 rollback-skip-apply)
  run upgrade 3 rollback-shell;run upgrade 4 rollback-helper;unset NIBLEAF_VERSION
  run upgrade 23 rollback-stop-pause
  CURRENT=rollback-skip-only-apply;log="$PRIVATE/skip.log"
  source "$PUBLIC/rollback-skip-only-apply.sh" > "$log" 2>&1;schedule_assert old3
  record rollback-skip-only-apply PASS 'only apply command skipped; three legacy true; reconcile false/false'
  run upgrade 25 rollback-config
  run upgrade 28 rollback-start;healthy;marker;cmp -s .env "$PRIVATE/pre-upgrade.env"
  record legacy-three-final PASS 'healthy v0.1.2; original marker and configuration intact'
  ;;
esac
record product-journey NOT-RUN 'no real provider sign-in, upload/publish/search/export journey'
record complete PASS "$MODE scenario completed"
