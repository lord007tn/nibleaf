#!/usr/bin/env bash
run upgrade 11 initial-dry-run
cat > interrupt.mjs <<'JS'
import {Queue} from 'bullmq';
const original=Queue.prototype.upsertJobScheduler;
Queue.prototype.upsertJobScheduler=async function(...args){
 const result=await original.apply(this,args);
 console.log('FAULT: SIGKILL after first durable destination scheduler');
 process.kill(process.pid,'SIGKILL');
 return result;
};
JS
# Preserve the exact extracted step-7 text. The fixture adds a preload only to
# this disposable migration process, killing it after its first durable mutation.
docker() {
 if [ "${INJECT_INTERRUPT:-false}" = true ] && [ "$1 $2 $3" = 'compose run --rm' ];then
  shift 3
  command docker compose run --rm -v "$PWD/interrupt.mjs:/app/packages/bullmq/scripts/interrupt.mjs:ro" -e NODE_OPTIONS=--import=/app/packages/bullmq/scripts/interrupt.mjs "$@"
 else command docker "$@";fi
}
export -f docker
log="$PRIVATE/interrupted-step7.log"
export INJECT_INTERRUPT=true
if bash -e "$PUBLIC/upgrade-en-12.sh" > "$log" 2>&1;then record interrupted-step7 FAIL 'injection did not interrupt';exit 1;fi
unset INJECT_INTERRUPT
safe_errors
record interrupted-step7 PASS 'actual published operator interrupted after first destination'
# Assert partial persisted state before the guide rollback, then use every rollback block.
CURRENT=partial-inventory;log="$PRIVATE/partial.json"
source "$PUBLIC/upgrade-en-13.sh" > "$log" 2>&1
schedule_assert partial
cp "$log" "$PUBLIC/partial-schedule-inventory.json"
record partial-state PASS 'mixed scheduler and legacy definitions actually persisted'
rollback_all
