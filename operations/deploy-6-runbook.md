# Deploy 6 runbook: organizations PR 2 + PR 3 on Nibleaf Cloud

**Status:** ready to run. Written on 2026-11-11 as the hand-over from the audit thread, which ran deploys 3–5.
**Scope:** one maintenance window. It ships organizations PR 2 (#418) and PR 3 (#441) together. In the same window it runs the
`org:merge` **plan only**, and optionally the edge Worker (#433) and the keys stage.
**Rollback floor:** `sha-0a18349c9855fa9dc6961e0f28bffe1be20febe3` (PR 1, deploy 5). **Never** roll back to anything
older (for example `8a3ce217`). See [`scripts/organizations-merge.md`](../scripts/organizations-merge.md#rollback-floor-release-rule).

This file contains no secrets, values, hostnames of private consoles, resource UUIDs or account IDs. Where an
identifier is needed, it says how to look it up. Placeholders look like `<RESOURCE_UUID>`.

Related: [rolling deploys](runbook-rolling-deploys.md) (§4 migration gate, §6 queue gate),
[deployment reliability](deployment-reliability.md) (release record), [org merge tools](../scripts/organizations-merge.md),
[edge release](../.github/custom-domain-edge-release.md), [ClickHouse analytics](../docs/self-hosting/clickhouse-analytics.mdx).

---

## 0. Facts you need

| Item | Value or where to find it |
| --- | --- |
| Platform | The owner's Coolify (v4.5.x): project **Raed**, environment **production**, Docker Compose resource **nibleaf** |
| Host | Coolify server `joodlab-internal-coolify-management`: 4 CPU, 7,751 MiB RAM, 8,191 MiB swap. Shared with other products, so watch memory |
| Compose source | Coolify reads `docker-compose.coolify.yml` from **git `main` at `HEAD` at Redeploy time**. Only the image is pinned |
| Image pin | Environment variable **`NIBLEAF_IMAGE_TAG`**. It has two rows; the **first row (Production)** is the deploy pin, the second is Preview deployments |
| Image registry | `ghcr.io/lord007tn/nibleaf:sha-<40 hex>` (immutable; `latest`/`main` are stale and never used) |
| Container names | `<service>-<RESOURCE_UUID>-<timestamp>`. `<RESOURCE_UUID>` is the Coolify resource id; read it from the resource URL or `docker ps` |
| Shell access | Coolify **Terminal** → the management server. Send each multi-line script as one line: `echo <base64> \| base64 -d > /root/x.sh; bash /root/x.sh` |
| Runtime image | Has **no pnpm/npm/corepack**. Run TypeScript with `node --import tsx` inside a container. In-container scripts that use top-level await need `.mts` |
| Downtime | Stop-then-start: about 85 s of 503s (deploy 5: 20:19:12 → 20:20:37 UTC, 2026-11-10) |

### Topology during a deploy (stop-then-start)
- One `server` and one `worker`. Both depend on the one-shot **`migrate`** service with `condition: service_completed_successfully`.
  `migrate` runs `prisma migrate deploy` **from the image**, once, before any new server or worker starts.
- Coolify pulls the new image while the old containers keep serving. It then removes the old containers and starts the new ones.
- `docker-entrypoint.sh` has opt-in `NIBLEAF_COMMAND` and `NIBLEAF_MIGRATE_ON_START` (rolling-deploy support, #439). The Coolify
  compose sets **neither**, so deploy 6 is still stop-then-start. Don't set them for this window.

---

## 1. Pre-flight (read-only)

### 1.1 Pick the target
1. `git fetch origin && git rev-parse origin/main` → `<TARGET_SHA>`. It must contain both `a0ba692e` (#418) and `3e86776d` (#441):
   `git merge-base --is-ancestor a0ba692e <TARGET_SHA> && git merge-base --is-ancestor 3e86776d <TARGET_SHA>`.
2. CI, CodeQL and secret scanning must be green on `<TARGET_SHA>`:
   `gh run list --repo lord007tn/nibleaf --commit <TARGET_SHA> --json workflowName,status,conclusion`.
   A `cancelled` CI run means a newer push superseded it. Move the target to the newer HEAD.
3. Deploy files: `git diff --stat 0a18349c <TARGET_SHA> -- docker-compose.coolify.yml Dockerfile docker-entrypoint.sh`.
   As of `8ff9dd1c`, only `docker-entrypoint.sh` changed (opt-in rolling-deploy code; see §0). Re-check right before
   Redeploy that `docker-compose.coolify.yml` on `main` HEAD is identical to the one at `<TARGET_SHA>`.

### 1.2 Migration gate (runbook-rolling-deploys.md §4.3)
Run the target's script with its pinned parser over every migration added since the floor:

```sh
git diff --name-only 0a18349c <TARGET_SHA> -- packages/database/prisma/migrations
node scripts/migration-safety.mjs --base 0a18349c   # from a checkout of <TARGET_SHA>, after pnpm install
```

Expected result, as of `8ff9dd1c`:

```
ok       20261111060000_record_terms_acceptance/migration.sql (expand-only)   # 2 nullable user columns (#459)
::error  20261111120000_project_organization_restrict/migration.sql           # drop-constraint + tighten-constraint
ok       20261111130000_organization_deletion_manifest/migration.sql (expand-only)
ok       20261112090000_join_link_tombstone/migration.sql (expand-only)
```

`project_organization_restrict` replaces `project_organizationId_fkey` (`ON DELETE CASCADE` → `ON DELETE RESTRICT ON UPDATE
CASCADE`) in one transaction. It carries **no** `-- nibleaf-migration: contract` marker, because #418 merged before #439 introduced the
gate. Don't add the marker now: editing the file changes its Prisma checksum on any database that already applied it.

**CONTRACT approval (recorded, manual override for this file only):**
> Approved by master 2026-11-11: FK CASCADE→RESTRICT on project.organizationId; PR 1 floor deletes orgs only when empty; no data change.

Evidence, checked against `0a18349c`:
- `packages/auth/src/tenant-erasure.ts` deletes organizations only with `projects: { none: {} }`, after erasing each website.
- The only other organization delete, `apps/server/src/actions/admin.ts` (failed bootstrap invite), deletes the project first in the same transaction.
- The same FK already existed with CASCADE, so every row already satisfies it. Validation is trivial (about 56 projects). No data is rewritten.

Any **other** `::error`, or a new `CONTRACT` line, means **stop**: get a new approval with the same four items (approver,
migration inventory, backup reference, statement that the floor no longer uses the old shape).

Note: the `docker.yml` release path runs this gate only with `deploy=true`. An unmarked statement refuses the release there even
with `migration_mode=expand-contract`. That's why deploy 6 uses the manual Coolify path with `deploy=false`.

### 1.3 Queue-payload gate (runbook-rolling-deploys.md §6)

```sh
git diff --stat 0a18349c <TARGET_SHA> -- packages/bullmq/src apps/worker/src/processors
```

As of `8ff9dd1c`, two payload-relevant changes. The evidence for both:
- `packages/bullmq/src/jobs/email.ts` (#459) adds optional `auth.existingUserOnly`. It's set only when `DISABLE_SIGNUP` is on
  (`packages/auth/src/server.ts`) and read by `apps/worker/src/processors/email.ts`.
  1. New API → old worker: the old worker ignores the field. This matters only on a closed instance.
  2. Old jobs → new worker: the field is optional, so absent means the old behaviour.
  3. Rollback: if `DISABLE_SIGNUP` is on, drain the `{email}` queue (wait for 0 waiting/delayed) before rolling back.
- `apps/worker/src/processors/publish.ts` (#447) reads more database fields (`deliveryPlanSelect`) and looks up the `free` usage plan
  (`loadDefaultDeliveryPlan`). `PublishDeploymentJobData` is unchanged. If no `free` row exists, the lookup returns null and
  publishing continues.

Re-run the diff for any newer target. Any other payload change needs the same three-direction evidence, or **don't deploy**.

### 1.4 Read-only production inventory
Run [Appendix A](#appendix-a-read-only-inventory-script) as one Terminal command. It prints only `SET`/`EMPTY`/`ABSENT` and
the decoded byte length for secrets, never values. It covers:
- environment presence for the analytics, AI, integration, Git and MCP variables, plus non-secret values
  (`WORKER_QUEUES`, `ANALYTICS_MODE`, `MCP_*`, `CLICKHOUSE_*` names, URLs);
- worker analytics health, ClickHouse tables, rows, memory and disk, and recent inserts;
- relational `analytics_event` activity;
- whether the backfill tooling (`/app/scripts/analytics-migration.ts`, tsx) ships in the image;
- duplicate primary custom domains (the race fixed in #430);
- organizations without an active usage-plan assignment (rule from `getEffectivePlanConfiguration` in `apps/server/src/actions/usage.ts`);
- sites whose slug is a reserved hostname or an `xn--` label (#442; runs in `BEGIN READ ONLY … ROLLBACK`);
- the memory budget: `docker stats`, `free -m`, `nproc`, MemTotal/SwapTotal, and every Nibleaf container's memory limit.

Send the memory section to the rolling-deploy runbook owner (§8 of `runbook-rolling-deploys.md` waits on measured numbers).
Report duplicates, unplanned orgs and reserved slugs to the master. **Change nothing.**

### 1.5 Host memory gate
Two consecutive passes, 5 minutes apart ([Appendix B](#appendix-b-host-poll)):
- `load1 < 6`;
- **and** at least 6 GiB free on `/` after subtracting about 4.2 GiB for the pull;
- **and** either `MemAvailable ≥ 1,024 MiB` with swap < 75%, or `MemAvailable ≥ 900 MiB` with swap < 60%.

Deploy 5 for reference: 683–1,266 MiB available, swap 51–69% (peak during the pull), load ≤ 5.77, 0 OOM kills.

### 1.6 Publish queue
The `{publish}` and `{search}` queues (`QUEUE_CLUSTER=true`, so the names carry braces) must show 0 active, 0 waiting and 0 delayed
([Appendix C](#appendix-c-queue-check)). Wait if they don't.

---

## 2. Backup (verified)

Run this **after §3 (build) and immediately before §4 (deploy)**; see "Writes after the snapshot" below. On the host, inside the
Postgres container:

```sh
P=$(docker ps --format '{{.Names}}' | grep "^postgres-<RESOURCE_UUID>-" | head -1)
F=/root/nibleaf-pre-deploy6-$(date -u +%Y%m%dT%H%M%SZ).dump
docker exec $P sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > $F; echo "pg_dump exit=$?"
ls -la $F; sha256sum $F
docker exec -i $P pg_restore -l < $F > /root/deploy6-restore-list.txt
echo "pg_restore -l exit=$? entries=$(wc -l < /root/deploy6-restore-list.txt) tabledata=$(grep -c 'TABLE DATA' /root/deploy6-restore-list.txt)"
```

Pass: both exits are 0, and the TABLE DATA count is at least deploy 5's (80). The listing only proves the archive is readable, so
also **test a restore** into a throwaway database in the same container, compare counts with the live database, then drop it:

```sh
C='select count(*) from project; select count(*) from "user"; select count(*) from _prisma_migrations'
docker exec $P sh -c 'dropdb -U "$POSTGRES_USER" --if-exists nibleaf_restore_test && createdb -U "$POSTGRES_USER" nibleaf_restore_test'
docker exec -i $P sh -c 'pg_restore -U "$POSTGRES_USER" -d nibleaf_restore_test --no-owner --exit-on-error' < $F; echo "restore exit=$?"
echo "restored: $(docker exec -e C="$C" $P sh -c 'psql -U "$POSTGRES_USER" -d nibleaf_restore_test -tA -c "$C"' | tr '\n' ' ')"
echo "live:     $(docker exec -e C="$C" $P sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -c "$C"' | tr '\n' ' ')"
docker exec $P sh -c 'dropdb -U "$POSTGRES_USER" nibleaf_restore_test'
```

Pass: restore exit 0, and the restored project, user and migration counts equal the live ones (live counts may only be higher
from writes since the dump). Record the dump path, size, sha256 **and** the restore-test result (exit code, both count lines,
UTC time) in the release record. Never prune or delete older dumps.

**Writes after the snapshot.** Coolify's stop-then-start gives no window to dump with the app stopped, so writes made between
the dump and the old containers stopping are not in it. Keep that window to about a minute: take the dump **last**, after the
image is built (§3) and immediately before Redeploy (§4). The dump is only restored for a failed, partially applied migration
(§4 Rollback). In that case, before restoring, export anything written after the dump's timestamp from the failed database
(`pg_dump --data-only` of the affected tables, or rows with `"updatedAt"`/`"createdAt"` after it), restore, then re-apply those
rows. Record in the release record whether any such writes existed.

---

## 3. Build the image

```sh
gh workflow run docker.yml --repo lord007tn/nibleaf --ref main \
  -f ref=<TARGET_SHA> -f image_tag=sha-<TARGET_SHA> -f platforms=linux/amd64 \
  -f publish=true -f deploy=false -f compose_replacement_ack=false -f migration_mode=none
```

- It refuses to publish until `ci.yml` on that exact SHA is green. It refuses an existing tag. It takes about 15 minutes.
- From the run log, confirm `HEAD is now at <TARGET_SHA>` (checkout) and `REVISION=<TARGET_SHA>` (runtime revision), and copy the
  `subject-digest` from "Attest published image provenance".
- Before #436, a run dispatched with `--ref main` for an older SHA got the wrong `org.opencontainers.image.revision` label. The
  `REVISION` build arg was always correct.

---

## 4. Deploy (stop-then-start)

1. Start a watcher in one Terminal ([Appendix D](#appendix-d-oom-and-container-watcher), 40 × 30 s). Use a second Terminal tab for
   checks; idle Terminal sessions drop, and a second tab can silently lose typed input, so reconnect if needed.
2. Coolify → resource **nibleaf** → **Environment Variables**. Type `NIBLEAF_IMAGE_TAG` into the search box (setting it from JS
   doesn't filter), open the **first (Production)** row's edit dialog, and check the current value is the floor
   (`sha-0a18349c…`). Replace it with `sha-<TARGET_SHA>`, then **Update Variable**. Change nothing else.
3. Check the "Active deployments" badge: it can list other resources (on other servers), which isn't a clash.
4. Click **Redeploy**. The deployment log shows "Importing lord007tn/nibleaf:main (commit sha …)". That's the compose
   source; check it matches §1.1.3.
5. Track health from outside until both report the new revision:
   `curl -s https://api.nibleaf.com/health` and `curl -s https://nibleaf.com/health` → `"revision":"<TARGET_SHA>"`.
6. Then require **three consecutive passing rounds**, 10 s apart, over every public target: both health endpoints (revision =
   `<TARGET_SHA>`), one published custom-domain docs page, one `*.nibleaf.com` docs page, and the admin login page, each HTTP 200.
   `scripts/coolify-release-probes.mjs` implements the same probes. A failed round restarts the count. If three passing rounds
   don't happen within 10 minutes, roll back (below), then re-run the same probes expecting the **previous** revision, and stop.

**Rollback:** set the Production `NIBLEAF_IMAGE_TAG` back to `sha-0a18349c9855fa9dc6961e0f28bffe1be20febe3` and Redeploy.
PR 1 ignores PR 2/3's expand-only columns, and RESTRICT only refuses deletions PR 1 never attempts. Drain `{email}` first if
`DISABLE_SIGNUP` is on (§1.3). Restoring the dump is only for a failed, partially applied migration, with the app stopped.

---

## 5. Post-deploy checks

- **Host** ([Appendix E](#appendix-e-post-deploy-checks)):
  - `migrate` exited 0, and `_prisma_migrations` has 0 unfinished or rolled-back rows;
  - the latest migration is the newest folder;
  - server, worker, app and admin run `sha-<TARGET_SHA>` and are healthy with 0 restarts;
  - Node is v26;
  - no new OOM kills (`dmesg` baseline was 6) for at least 10 minutes after the switch.
- **Logs** ([Appendix F](#appendix-f-error-logs)): 0 error lines from real traffic. Your own probes may log known, expected lines
  (for example `AI answers are not ready for this workspace` on a workspace with answers off).
- **Public:**
  - response headers match a pre-deploy snapshot;
  - `/install.sh` reports the current release;
  - docs EN/AR return 200 (Arabic `dir=rtl`, `/ar/<path>` → 308 → `<path>?lang=ar`);
  - hybrid search returns hits for EN and AR queries.
- **Signed-in smoke test** on a throwaway QA site owned by the account signed in to the shared browser (never sign the owner out;
  read-only on every other site):
  - the sites list, the editor, and Settings → Members (list, invite a `+alias` address as Viewer, open the accept page signed in as
    a different account, then revoke);
  - join links (create Viewer, max 1, a single email domain; open `/join/<token>` without joining; disable);
  - the People page;
  - publish (add a temporary page, publish, check the reader, delete it, publish again, and confirm `reviewedStateHash` is back to its
    pre-test value);
  - **new in deploy 6:** the `/app/o/<slug>` organization shell and the organization switcher (#418/#441), and the people
    management pages (members, access, invitations, join links).

---

## 6. Optional, same window, after §5

### 6.1 Edge Worker release (#433 maintenance page), following `.github/custom-domain-edge-release.md`
- Use the **existing** authorized `cf` profile on the release machine (`pnpm --filter @nibleaf/custom-domain-edge exec cf auth whoami`).
  Never create credentials. If none exists, the edge release waits for the owner.
- The profile may see several Cloudflare accounts. Pin **every** command to the account that owns the `nibleaf.com` zone:
  `cf zones list --name nibleaf.com` shows the owning account, then `export CLOUDFLARE_ACCOUNT_ID=<that account id>`.
  Without it, non-interactive commands refuse to pick an account.
- Baseline, read-only, kept privately: `cf workers deployments list --worker nibleaf-custom-domain-edge`,
  `cf workers get nibleaf-custom-domain-edge`, and `cf workers versions get <active-version> --worker-id nibleaf-custom-domain-edge --include modules`.
  As of 2026-11-11 the active version was deployed on 2026-09-30, with bindings `APP_ORIGIN` (plain text) and `EDGE_SECRET` (secret) and
  **no `EDGE_CACHE_MODE`**.
- Then test, typecheck, build, `upload --dry-run`, upload, and inspect the uploaded version's modules and bindings.
- **EDGE_CACHE_MODE gate:** read the bindings of both the active and the uploaded version. If it's absent or `off` on both, continue.
  Any other value in either version means **stop**: the owner must clear it through the edge-cache runbook, then re-upload.
- Deploy with `run deploy --versions '[{"version_id":"<uploaded>","percentage":100}]'`. Never use `cf deploy` or `triggers deploy`.
- Verify with the runbook's hashed-asset probe on a known custom host. `x-nibleaf-edge: hit|miss` means caching is on: roll back.
- Rollback: deploy the previous version id at 100%.

### 6.2 Keys stage 1 (only if the owner has put the values in)
See [§8](#8-keys-and-analytics-enablement-plan). It's its own verification step, after §5 and before §7.

---

## 7. `org:merge`: PLAN only, then wait for the master

Runbook: [`scripts/organizations-merge.md`](../scripts/organizations-merge.md). The image has no pnpm, so run the script directly in
the server container:

```sh
S=$(docker ps --format '{{.Names}}' | grep "^server-<RESOURCE_UUID>-" | head -1)
TS=$(date -u +%Y%m%dT%H%M%SZ)
docker exec -w /app/apps/server $S node --import tsx src/scripts/org-merge.ts plan --out /tmp/org-merge-plan-$TS.json
docker cp $S:/tmp/org-merge-plan-$TS.json /root/org-merge-plan-$TS.json
docker exec -u 0 $S rm -f /tmp/org-merge-plan-$TS.json
```

- `plan` is a PostgreSQL read-only, repeatable-read transaction. It writes the JSON and prints a human report.
- **The plan file stays on the host** (`/root/org-merge-plan-<ts>.json`). It contains member ids and owner email addresses,
  so never paste it into a thread or a PR. Send the master the human report:
  - the groups (starting with the owner the master names);
  - the organization name and slug each group keeps;
  - members and roles before and after;
  - any "privilege change" or drift warning.
- If plan assignments differ, edit only that group's `decision` as the runbook describes.
- **Apply only after the master approves the reviewed plan.** It needs at least two DB connections, and Redis via the existing BullMQ
  settings (set `ORG_MERGE_DRAFT_AI_DISABLED=1` only if drafting is disabled):
  ```sh
  docker cp /root/org-merge-plan-<ts>.json $S:/tmp/reviewed-plan.json
  docker exec -w /app/apps/server $S node --import tsx src/scripts/org-merge.ts apply /tmp/reviewed-plan.json
  docker exec -w /app/apps/server $S node --import tsx src/scripts/org-merge.ts verify <runId>
  ```
  Read each group's `applied`/`skipped`/`failed` result. Then the master runs the 17-step test from #441's description.
- **Restore** (`ORG_MERGE_OFFLINE=1 … restore <runId>`) requires the app to be **stopped**. A restored run can't be applied again.

---

## 8. Keys and analytics enablement plan

Accepted by the master on 2026-11-11. The **owner** generates every value on their own machine, stores it in their password
manager (plus one offline copy), and pastes it into Coolify. **No value ever appears in a thread, PR, log or this file.**
To verify, check presence and decoded byte length only (Appendix A), or compare a `sha256sum` fingerprint of the stored copy.

**Never replace an existing value.** Run Appendix A first. A variable that is already SET keeps its value: replacing an
encryption key makes stored ciphertext unreadable, and replacing `ANALYTICS_HASH_SALT` splits visitor identities. Generate a value
only for a variable that is ABSENT or EMPTY, and only after confirming nothing depends on an earlier value (no stored integration
credentials or webhook secrets for the integration key, no Git connections for the Git key, no ClickHouse events for the salt).
If something does, recover the earlier value from the owner's password manager instead. Rotation goes through the `_PREVIOUS`
variables (`AI_CONVERSATION_ENCRYPTION_KEY_PREVIOUS`, `INTEGRATION_CREDENTIAL_PREVIOUS_KEYS`), never a plain replacement.

| Variable | Generate | Unlocks | Depends on |
| --- | --- | --- | --- |
| `INTEGRATION_CREDENTIAL_ENCRYPTION_KEY` | `openssl rand -base64 32` (44 chars, 32 bytes) | Smart AI connections with the site's own keys, and project webhooks | — |
| `AI_CONVERSATION_ENCRYPTION_KEY` | `openssl rand -base64 32` | AI conversation text capture. Set it explicitly so it doesn't derive from the integration key | `ANALYTICS_MODE` ≠ disabled **and** `ANALYTICS_HASH_SALT` |
| `ANALYTICS_HASH_SALT` | `openssl rand -hex 32` | ClickHouse ingestion. Without it events are **dropped** | — |
| `GIT_CREDENTIAL_ENCRYPTION_KEY` | `openssl rand -base64 32`, **different** from the integration key | Two-way Git (tokens, webhook secrets) | `GIT_WORKER_SECRET` |
| `GIT_WORKER_SECRET` | `openssl rand -hex 32` | Two-way Git callbacks | — |
| `ANALYTICS_MODE` | `dual_write` → `shadow_read` → `clickhouse` | The insights dashboard needs `shadow_read` or later | salt |
| `MCP_ENABLED` | `true` | `/api/mcp`, personal keys, OAuth "connect an AI app" | HTTPS `BETTER_AUTH_URL`; migration `20261106120000_mcp_oauth` |

`MCP_ALLOWED_HOSTS` can stay empty: the `API_URL` and `APP_URL` hosts are always allowed.
`WORKER_QUEUES` isn't passed by the Coolify compose, so all queues (including `git`) run. Confirm it with Appendix A.

**Order** (each step is a Coolify env change plus a Redeploy, about 85 s of 503s; batch steps and use quiet hours):
0. Take a verified backup (§2). The owner stores all values before applying.
1. **Keys and salt, one Redeploy** (`ANALYTICS_MODE` stays disabled).
   - Verify each variable is present with the right byte length.
   - Smart AI settings no longer say "ask your operator".
   - A test connection saved on the QA site survives a restart.
   - 0 decrypt errors in the logs.
2. **`dual_write`, one Redeploy (master go-ahead).**
   - The worker's `/health` shows `analytics.status: ok` after the boot migration.
   - The `nibleaf_analytics` tables exist.
   - A consented test visit, a search, a crawler hit and an AI turn land in ClickHouse, while Postgres `analytics_event` keeps growing.
   - Watch memory for 24–48 h.
3. **Backfill and reconcile per project (master go-ahead):**
   `docker exec -w /app <server> node --import tsx scripts/analytics-migration.ts backfill --project=<id>`, then `reconcile` (exit 0 required).
   Appendix A shows whether the script and tsx ship in the image. If not, add an entrypoint subcommand first.
4. **`shadow_read` (master go-ahead).** Compare the insights dashboard with the legacy numbers on 2–3 sites over 7 days.
5. **`clickhouse`: the owner's decision.** It stops relational writes. Going back to `dual_write` can't restore events missed in between.
6. **`MCP_ENABLED=true`, its own Redeploy (master go-ahead).**
   - Sign-in still works, both password and Google: with MCP on, Better Auth validates its OAuth tables on every sign-in.
   - `tools/list` works with a personal key.
   - The OAuth discovery endpoints answer.
   - One client connects end to end.

**Abort gates for every analytics stage:** `MemAvailable < 600 MiB` for 10 min, swap > 75%, any new OOM, or a ClickHouse restart.
Go back one stage if any trips. ClickHouse already runs idle, capped at `mem_limit: 1536m` with a 1 GiB server budget.

**Rollback per item:**
- **Keys:** remove the variable to switch the feature off. Ciphertext stays and works again only with the **same** key. Never
  "roll back" to a different key. Losing the integration key means re-entering every Smart AI credential and webhook secret; losing
  the Git key means reconnecting every Git connection.
- **Salt:** never change it. A new salt splits visit identities.
- **`ANALYTICS_MODE`:** step back one stage. To delete only backfilled rows for one project:
  `analytics-migration.ts rollback --project=X --confirm-project=X`.
- **MCP:** `MCP_ENABLED=false` plus a Redeploy. Never run the MCP `rollback.sql` after a successful migration.

---

## 9. Release record

[`deployment-reliability.md`](deployment-reliability.md#required-production-evidence) asks for one release record per deploy.
For deploy 6 it must include:
- the target SHA, image digest, attestation and Coolify deployment id;
- the full `migration-safety.mjs` output (§1.2) and the CONTRACT approval quote above;
- the queue-gate evidence (§1.3);
- the dump path, size, sha256 and `pg_restore -l` counts (§2);
- the health transition times and the post-deploy results (§5);
- the edge baseline and version ids (§6.1, kept privately where it contains account data);
- the `org:merge` run id and results (§7).

Production artifacts left by earlier deploys, all kept on purpose (never prune):
- `/root/nibleaf-pre-deploy1-*.dump` through `/root/nibleaf-pre-deploy5-20261110T201454Z.dump`. Deploy 5's is 4,880,559 bytes and
  starts with sha256 `8fbc7cc1…`.
- `/root/deploy5-restore-list.txt`, `/root/deploy5-poll.log`, `/root/deploy5-watch.log`.

---

## Appendix A: read-only inventory script

Replace `<RESOURCE_UUID>`. Run it as one line: `echo <base64 of this file> | base64 -d > /root/inv.sh; bash /root/inv.sh 2>&1 | tee /root/inv-out.txt; rm -f /root/inv.sh`.
Delete `/root/inv-out.txt` after reading it.

```bash
#!/bin/bash
# READ-ONLY. Secrets: SET/EMPTY/ABSENT + decoded byte length only. Values only for non-secret variables.
R=<RESOURCE_UUID>
pick() { docker ps --format '{{.Names}}' | grep -E "^$1-$R-" | sort | tail -1; }
SECRETS="ANALYTICS_HASH_SALT AI_CONVERSATION_ENCRYPTION_KEY AI_CONVERSATION_ENCRYPTION_KEY_PREVIOUS INTEGRATION_CREDENTIAL_ENCRYPTION_KEY INTEGRATION_CREDENTIAL_PREVIOUS_KEYS GIT_CREDENTIAL_ENCRYPTION_KEY GIT_WORKER_SECRET INTERNAL_API_SECRET BETTER_AUTH_SECRET CLICKHOUSE_WRITER_PASSWORD CLICKHOUSE_READER_PASSWORD"
PUBLIC="WORKER_QUEUES ANALYTICS_MODE MCP_ENABLED MCP_ALLOWED_HOSTS MCP_RATE_LIMIT_PER_MIN CLICKHOUSE_URL CLICKHOUSE_DATABASE CLICKHOUSE_WRITER_USERNAME CLICKHOUSE_READER_USERNAME CLICKHOUSE_MIGRATE_ON_BOOT AI_CONVERSATION_RETENTION_DAYS BETTER_AUTH_URL APP_URL API_URL DISABLE_SIGNUP"
for svc in server worker app; do
  C=$(pick $svc); ENVS=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' $C)
  echo "== $svc ($(docker inspect -f '{{.Config.Image}}' $C | sed 's#.*:##' | cut -c1-12))"
  for n in $PUBLIC; do l=$(printf '%s\n' "$ENVS" | grep -m1 "^$n="); if [ -z "$l" ]; then echo "  $n ABSENT"; else echo "  $n = ${l#*=}"; fi; done
  for n in $SECRETS; do l=$(printf '%s\n' "$ENVS" | grep -m1 "^$n="); if [ -z "$l" ]; then echo "  $n ABSENT"; else v=${l#*=}; if [ -z "$v" ]; then echo "  $n EMPTY"; else
    case $n in
      ANALYTICS_HASH_SALT|GIT_WORKER_SECRET)
        if printf '%s' "$v" | grep -Eq '^([0-9a-fA-F]{2})+$'; then echo "  $n SET (chars=${#v}, hex-decoded-bytes=$((${#v} / 2)))"; else echo "  $n SET (chars=${#v}, INVALID HEX)"; fi ;;
      *) b=$(printf '%s' "$v" | base64 -d 2>/dev/null | wc -c); echo "  $n SET (chars=${#v}, base64-decoded-bytes=$b)" ;;
    esac; fi; fi; unset v l; done
done
W=$(pick worker); S=$(pick server); CH=$(pick clickhouse); P=$(pick postgres)
echo "== worker /health analytics: $(docker exec $W node -e "fetch('http://127.0.0.1:'+(process.env.WORKER_PORT||3001)+'/health').then(r=>r.text()).then(console.log)" | grep -o '"analytics":{[^}]*}')"
echo "== clickhouse: $CH image=$(docker inspect -f '{{.Config.Image}}' $CH) memLimit=$(docker inspect -f '{{.HostConfig.Memory}}' $CH)"
docker stats --no-stream --format '  stats: mem={{.MemUsage}} ({{.MemPerc}}) cpu={{.CPUPerc}}' $CH
chq() { docker exec $CH sh -c "clickhouse-client --user \"\$CLICKHOUSE_USER\" --password \"\$CLICKHOUSE_PASSWORD\" -q \"$1\"" 2>&1 | head -40; }
chq "SELECT database, name, total_rows, formatReadableSize(total_bytes) FROM system.tables WHERE database NOT IN ('system','INFORMATION_SCHEMA','information_schema') ORDER BY total_rows DESC FORMAT TSV" | sed 's/^/  /'
echo "  MemoryTracking: $(chq "SELECT formatReadableSize(value) FROM system.metrics WHERE metric='MemoryTracking' FORMAT TSV")  parts disk: $(chq "SELECT formatReadableSize(sum(bytes_on_disk)) FROM system.parts WHERE active FORMAT TSV")"
echo "  inserts into nibleaf_analytics, last 7 days: $(chq "SELECT count() FROM system.query_log WHERE type='QueryFinish' AND query_kind='Insert' AND event_time > now() - INTERVAL 7 DAY AND has(databases,'nibleaf_analytics') FORMAT TSV")"
q() { docker exec $P sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -At -F ' ' -c \"$1\""; }
echo "== analytics_event: total=$(q 'SELECT count(*) FROM analytics_event') last24h=$(q "SELECT count(*) FROM analytics_event WHERE \\\"createdAt\\\" > now() - interval '24 hours'")"
echo "== backfill tooling: $(docker exec $S sh -c 'ls /app/scripts/analytics-migration.ts 2>&1; test -x /app/node_modules/.bin/tsx && echo tsx-ok || echo tsx-missing' | tr '\n' ' ')"
echo "== duplicate primary domains (projects with >1 primary): $(q 'SELECT count(*) FROM (SELECT \"projectId\" FROM domain WHERE \"isPrimary\" GROUP BY 1 HAVING count(*) > 1) x')"
q 'SELECT d.\"projectId\", d.domain, d.verified, d.\"dnsStatus\", d.\"sslStatus\" FROM domain d WHERE d.\"isPrimary\" AND d.\"projectId\" IN (SELECT \"projectId\" FROM domain WHERE \"isPrimary\" GROUP BY 1 HAVING count(*) > 1) ORDER BY 1' | sed 's/^/  DUP /'
echo "== memory budget"
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}' | grep -Ei 'NAME|server|app|admin|worker|migrate|postgres|dragonfly|qdrant|clickhouse|maxio|traefik|coolify' | sed 's/^/  /'
free -m | sed 's/^/  /'; echo "  nproc=$(nproc) MemTotal=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)MiB SwapTotal=$(awk '/SwapTotal/ {print int($2/1024)}' /proc/meminfo)MiB"
docker ps -a --filter name=$R --format '{{.Names}}' | xargs -r docker inspect --format '  {{.Name}} mem={{.HostConfig.Memory}} memswap={{.HostConfig.MemorySwap}} reservation={{.HostConfig.MemoryReservation}}'
```

Two further read-only queries run as SQL files copied into the Postgres container
(`docker cp file $P:/tmp/x.sql; docker exec $P sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F " | " -f /tmp/x.sql'`; remove the file after):

```sql
-- Organizations WITHOUT an active usage-plan assignment (usage.ts getEffectivePlanConfiguration):
-- active = row exists AND status='active' AND plan.active AND effectiveAt <= now() AND (expiresAt IS NULL OR expiresAt > now())
SELECT o.id, to_char(o."createdAt", 'YYYY-MM-DD HH24:MI'),
       CASE WHEN oup."organizationId" IS NULL THEN 'missing' WHEN oup.status <> 'active' THEN 'status=' || oup.status
            WHEN NOT up.active THEN 'plan-inactive:' || up.key WHEN oup."effectiveAt" > now() THEN 'not-yet-effective' ELSE 'expired' END,
       (SELECT count(*) FROM project p WHERE p."organizationId" = o.id) AS websites
FROM organization o
LEFT JOIN organization_usage_plan oup ON oup."organizationId" = o.id
LEFT JOIN usage_plan up ON up.id = oup."planId"
WHERE oup."organizationId" IS NULL OR oup.status <> 'active' OR NOT up.active OR oup."effectiveAt" > now()
   OR (oup."expiresAt" IS NOT NULL AND oup."expiresAt" <= now())
ORDER BY o."createdAt";
```

```sql
-- Sites whose slug is a reserved hostname or an xn-- label (#442). Run with
-- psql -v labels='{<first labels of the public *_URL hosts>}' ; '{}' when there are none.
BEGIN READ ONLY;
WITH reserved(slug) AS (
  SELECT unnest(ARRAY['www','admin','api','app','docs','storage','cname','status','mail']::text[]
                || COALESCE(NULLIF(:'labels', '')::text[], '{}'::text[]))
)
SELECT p.id, p."organizationId", p.slug FROM project AS p
WHERE lower(p.slug) IN (SELECT lower(slug) FROM reserved) OR lower(p.slug) LIKE 'xn--%'
ORDER BY p.slug, p.id;
ROLLBACK;
```

## Appendix B: host poll

```bash
pass=0
for i in $(seq 1 13); do
  load1=$(cut -d' ' -f1 /proc/loadavg); mem=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
  swap=$(awk '/SwapTotal/ {t=$2} /SwapFree/ {f=$2} END {print (t>0)?int((t-f)*100/t):0}' /proc/meminfo)
  after=$(( $(df -k --output=avail / | tail -1 | tr -d ' ') - 4404019 ))
  ok=0; awk -v l=$load1 'BEGIN{exit !(l<6)}' && [ $after -ge 6291456 ] && { [ $mem -ge 1024 ] && [ $swap -lt 75 ] || { [ $mem -ge 900 ] && [ $swap -lt 60 ]; }; } && ok=1
  [ $ok = 1 ] && pass=$((pass+1)) || pass=0
  echo "POLL $(date -u +%H:%M:%S) load1=$load1 memAvail=${mem}MiB swap=${swap}% diskAfterPull=$((after/1048576))GiB ok=$ok streak=$pass"
  [ $pass -ge 2 ] && { echo ==READY==; exit 0; }; [ $i -lt 13 ] && sleep 300
done; echo ==TIMEOUT==
```

## Appendix C: queue check

Copy this into the server container as `/app/apps/server/queue-check.mts`, run
`docker exec -w /app/apps/server <server> node --import tsx ./queue-check.mts`, then remove it with `docker exec -u 0 … rm -f`.

```ts
import { Queue } from 'bullmq';
const connection = { host: process.env.REDIS_HOST ?? 'localhost', port: Number(process.env.REDIS_PORT ?? 6379), password: process.env.REDIS_PASSWORD || undefined, db: Number(process.env.REDIS_DB ?? 0) };
for (const name of ['{publish}', '{search}', '{email}']) {
  const queue = new Queue(name, { connection });
  console.log(`QUEUE ${name} ${JSON.stringify(await queue.getJobCounts())}`);
  await queue.close();
}
process.exit(0);
```

## Appendix D: OOM and container watcher

```bash
R=<RESOURCE_UUID>; B=$(dmesg | grep -ciE 'oom-kill|out of memory|killed process')
for i in $(seq 1 ${1:-40}); do
  o=$(dmesg | grep -ciE 'oom-kill|out of memory|killed process')
  bad=$(docker ps -a --filter name=$R --format '{{.Names}}|{{.Status}}' | grep -iE 'restarting|exited|unhealthy|dead' | grep -vE '^(analytics-)?migrate-' | tr '\n' ' ')
  echo "W $(date -u +%H:%M:%S) mem=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)MiB load=$(cut -d' ' -f1 /proc/loadavg) oom=$o(+$((o-B))) bad=[$bad]"
  sleep 30
done
```

## Appendix E: post-deploy checks

```bash
R=<RESOURCE_UUID>; pick() { docker ps -a --format '{{.Names}}' | grep -E "^$1-$R-" | sort | tail -1; }
S=$(pick server); W=$(pick worker); M=$(pick migrate); P=$(pick postgres)
docker ps -a --format '{{.Names}}|{{.Status}}|{{.Image}}' | grep $R | sort
echo "migrate exit=$(docker inspect -f '{{.State.ExitCode}}' $M)"; docker logs --tail 3 $M
docker exec $P sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL"'
docker exec $P sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "SELECT migration_name FROM _prisma_migrations ORDER BY started_at DESC LIMIT 5"'
for s in server worker app admin; do C=$(pick $s); echo "$s restarts=$(docker inspect -f '{{.RestartCount}}' $C) started=$(docker inspect -f '{{.State.StartedAt}}' $C)"; done
echo "node $(docker exec $S node --version) revision=$(docker exec $S sh -c 'echo $NIBLEAF_REVISION')"
```

## Appendix F: error logs

```bash
R=<RESOURCE_UUID>; pick() { docker ps -a --format '{{.Names}}' | grep -E "^$1-$R-" | sort | tail -1; }
for s in server worker app admin maxio postgres dragonfly qdrant; do C=$(pick $s)
  n=$(docker logs $C 2>&1 | grep -ciE '"level":(50|60)|"level":"(error|fatal)"|\berror\b|fatal|unhandled|panic')
  echo "$s errorish=$n restarts=$(docker inspect -f '{{.RestartCount}}' $C)"
  [ "$n" -gt 0 ] && docker logs $C 2>&1 | grep -iE '"level":(50|60)|"level":"(error|fatal)"|\berror\b|fatal|unhandled|panic' | tail -3 | cut -c1-220
done
```
