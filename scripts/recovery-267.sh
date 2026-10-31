#!/usr/bin/env bash
# Fixtures for direct-upgrade refusal; all application processes run only on this runner.
run upgrade 14 recovery-compose
run upgrade 15 recovery-pin
# Pull/migrate first using exact lines extracted from step 11, then observe startup promptly.
python3 - "$PUBLIC" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]);s=(p/'upgrade-en-16.sh').read_text();parts=s.splitlines(True)
(p/'recovery-pull-migrate.sh').write_text(''.join(parts[:-1]))
(p/'recovery-up.sh').write_text(parts[-1])
PY
CURRENT=direct-pull-migrate;log="$PRIVATE/direct-pull.log";source "$PUBLIC/recovery-pull-migrate.sh" > "$log" 2>&1
# Start just after a minute tick; stop the failed worker promptly on its refusal,
# so this quiet fixture has no due maintenance occurrences promoted by a restarting worker.
# The quiet fixture was aligned while the old worker was still running.
# Do not wait for another minute after pausing: that would make a repeat overdue.
bash -e "$PUBLIC/recovery-up.sh" > "$PRIVATE/direct-up.log" 2>&1 & up_pid=$!
refused=false
for attempt in $(seq 1 45);do
 docker compose logs server worker > "$PRIVATE/direct-logs.txt" 2>&1 || true
 if grep -q 'Unknown recurring configuration' "$PRIVATE/direct-logs.txt";then refused=true;break;fi
 sleep 1
done
"$refused"
grep -o 'Unknown recurring configuration in [a-z]*; complete the migration using the retained staged v5 image' "$PRIVATE/direct-logs.txt" | sort -u > "$PUBLIC/direct-refusals.txt"
run upgrade 22 recovery-stop
wait "$up_pid" || true
run upgrade 3 recovery-shell;run upgrade 4 recovery-helper
check_stamp;check_stamp_negative
test "$STAMP" = "$ORIGINAL_STAMP"
if [ "$MODE" = recovery-busy ];then
 # Inject a real waiting job after failed v6 processes are stopped. No worker runs it.
 cat > queue-busy.ts <<'TS'
import {Queue} from 'bullmq';
import {producerConnectionConfig} from '../src/redis';
import {getQueueName} from '../src/utils/queue';
const q=new Queue(getQueueName('export'),{connection:producerConnectionConfig,skipMetasUpdate:true});
try {await q.add('cleanup-exports',{requestedAt:new Date().toISOString()},{jobId:'busy-recovery-fixture'});}finally{await q.close();}
TS
 quiet env NIBLEAF_VERSION="$STAGED" docker compose run --rm --no-deps -T -v "$PWD/queue-busy.ts:/app/packages/bullmq/scripts/queue-busy.ts:ro" worker node --import tsx packages/bullmq/scripts/queue-busy.ts
 log="$PRIVATE/busy-pause.log"
 if source "$PUBLIC/recovery-pause-only.sh" > "$log" 2>&1;then record recovery-busy FAIL 'unexpected pause success';exit 1;fi
 grep -q 'queues pause: FAIL' "$log";safe_errors;stopped
 test "$STAMP" = "$ORIGINAL_STAMP";cmp -s "$PRIVATE/pre-upgrade.env" "backups/env-$STAMP"
 record recovery-busy-stop PASS 'expected refusal; all app services stopped; queues not resumed; original STAMP retained'
 record recovery-busy-continuation NOT-RUN 'guide explicitly stops here; no destructive queue intervention'
else
 CURRENT=recovery-pause;log="$PRIVATE/recovery-pause.log"
 source "$PUBLIC/recovery-pause-only.sh" > "$log" 2>&1
 record recovery-quiet-pause PASS 'both queues quiescent'
 for b in 11 12 13;do run upgrade "$b" "recovery-$b";done;schedule_assert new
 # Revised prose says skip step 5 and preserve the original pre-upgrade backup.
 test "$STAMP" = "$ORIGINAL_STAMP";check_stamp
 run upgrade 15 recovery-repin-and-unset
 test -z "${NIBLEAF_VERSION+x}"
 run upgrade 16 recovery-start;healthy
 run upgrade 17 recovery-eight-migrations
 grep -E '^202[0-9]{11}_' "$log" | sort > "$PUBLIC/recovery-migrations.txt";cmp -s "$PUBLIC/recovery-migrations.txt" "$PUBLIC/expected-migrations.txt"
 run upgrade 18 recovery-inventory-http
 run upgrade 19 recovery-resume
 marker
 record recovery-final PASS 'quiet recovery healthy; candidate pinned; original backup and marker preserved'
fi
