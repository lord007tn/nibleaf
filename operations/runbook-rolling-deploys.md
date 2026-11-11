# Runbook: rolling deploys for the Nibleaf app tier

**Status:** proposed. It changes production infrastructure (Coolify resources and the proxy), so no step runs until the owner approves.
**Fixes:** READER-01 and PUBLIC-01 (P0). Every deploy takes customer docs, the dashboard and the API offline for about 85 s; on 2026-11-10 that was 20:19:12–20:20:37Z, with 503s on every custom domain.
**Companion:** [`runbook-subdomain-edge-route.md`](runbook-subdomain-edge-route.md).
**Background:** [`deployment-reliability.md`](deployment-reliability.md) ("Eligible Coolify Docker Image applications").

## 1. Why and what

Production runs as one Coolify **Docker Compose** resource, `docker-compose.coolify.yml`. Coolify can't do rolling updates for Compose (see [rolling updates](https://coolify.io/docs/knowledge-base/rolling-updates)): it stops the changed services and then starts them. The gate in front of `server` and `worker` is a one-shot `migrate`, and `app` and `admin` wait for `server`. The outage lasts as long as all of that takes.

Coolify **Docker Image applications** do support rolling updates:
1. Coolify starts the replacement next to the running container.
2. It waits until the replacement's health check passes.
3. Only then does it stop the old container. If the replacement never becomes healthy, the old one keeps serving.

This only works when the application has no host port mapping, no "Consistent container name", no custom container name and no custom IP.

### Target topology

Every new application runs the same immutable image, `ghcr.io/lord007tn/nibleaf:sha-<40 hex>`:

| Coolify resource | Kind | Role | Port | Reached at | Replacement |
| --- | --- | --- | ---: | --- | --- |
| `nibleaf-data` (today's Compose resource, slimmed) | Docker Compose | postgres, dragonfly, qdrant, clickhouse, maxio | — | maxio keeps `storage.nibleaf.com:9000` | unchanged |
| `nibleaf-api` | Docker Image | `NIBLEAF_COMMAND=server`, `NIBLEAF_MIGRATE_ON_START=true` | 4311 | **internal Traefik route** `http://api.nibleaf.internal` (§3) | **rolling** |
| `nibleaf-web` | Docker Image | `NIBLEAF_COMMAND=app` | 4310 | `https://nibleaf.com:4310` plus every domain/wildcard `app` has today | **rolling** |
| `nibleaf-admin` | Docker Image | `NIBLEAF_COMMAND=admin` | 4315 | `https://admin.nibleaf.com:4315` | stop-then-start (§8) |
| `nibleaf-worker` | Docker Image | `NIBLEAF_COMMAND=worker` | 4312 | none | stop-then-start (§8) |

### Why migrations run inside the new API container

The new API container applies migrations before it can report healthy, so it acts as the one-shot gate. Until it is healthy nothing new receives traffic, and the roll order (API, web, admin, worker) keeps new code from running ahead of its schema.

- **Concurrency.** `prisma migrate deploy` takes a PostgreSQL advisory lock. Prisma waits **at most 10 s** for it, then fails. So the entrypoint retries a bounded number of times: `NIBLEAF_MIGRATE_ATTEMPTS`, default 5, with `NIBLEAF_MIGRATE_RETRY_DELAY_S`, default 10 s. It **refuses to start** when `PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK` is set. That variable must never be set on any Nibleaf resource.
- **Compatibility during the overlap.** §5 keeps every migration expand-only, so the old containers still serving during the overlap keep working.
- **Failure.** A failed migration leaves the container unhealthy and the old container serving. Recovery is in §10.2.

**Code support** ships with this runbook's PR and stays inert unless the variables are set:
- `docker-entrypoint.sh`: `NIBLEAF_COMMAND`, `NIBLEAF_MIGRATE_ON_START`, and the bounded migrate retry.
- `apps/server`: `API_DRAIN_DELAY_MS`.
- The expand-only gate, in CI and in the release workflow.

## 2. Health checks and drain timers

These settings decide when the old container stops. Set them in each application's **Health check** and **Advanced → Operations** settings.

| App | Health check (GET) | Healthy only when | Interval / timeout / retries | Start period | Stop grace |
| --- | --- | --- | --- | --- | --- |
| `nibleaf-api` | `/health` on 4311 | the server is ready (Redis scheduling and startup work done, plus storage if required); it can only start after its migrations are applied; it is not draining | 5 s / 3 s / 3 | **240 s** (migrate retries plus boot) | **60 s** |
| `nibleaf-web` | `/health` on 4310, header `Host: nibleaf.com` | `/api/app/health` returns 200 through `API_URL`; it is not draining | 5 s / 3 s / 3 | 60 s | **60 s** |
| `nibleaf-admin` | `/health` on 4315 | process ready | 10 s / 5 s / 5 | 30 s | 60 s |
| `nibleaf-worker` | `/health` on 4312 | workers ready | 10 s / 5 s / 5 | 30 s | 60 s |

**Why the drain timers matter.** Docker sends SIGTERM to the old container, and the proxy keeps routing to it until Docker marks it unhealthy. That takes up to interval × retries = **15 s**, plus the proxy's event latency. The defaults close far too early:
- the API closes its listener immediately;
- the web wrapper (`scripts/graceful-web-service.mjs`) drains for **1 s** and force-kills after another **8 s**;
- Docker's stop grace period changes neither of those.

So every rolling application **must** set these explicitly:

| Variable | Value | Effect |
| --- | --- | --- |
| `API_DRAIN_DELAY_MS` (api) | `20000` | `/health` returns 503 at once; requests are still accepted for 20 s, then the listener closes |
| `SERVER_SHUTDOWN_TIMEOUT_MS` (api) | `30000` | in-flight requests finish, then the remaining connections are closed |
| `NIBLEAF_DRAIN_DELAY_MS` (web, admin) | `20000` | the drain file turns `/health` to 503; the server keeps running for 20 s, then gets SIGTERM |
| `NIBLEAF_WEB_FORCE_EXIT_MS` (web, admin) | `30000` | in-flight requests, including streamed AI answers, get 30 s before SIGKILL |

Total: 20 s + 30 s = 50 s, which is under the 60 s stop grace. §7 **V3** proves this with a request that is still streaming while its container is replaced.

## 3. A health-aware internal API endpoint

`nibleaf-web` and `nibleaf-admin` must reach the API **only through something that skips unhealthy or still-migrating containers**.

**Why not a Docker alias.** A Docker DNS alias resolves to every container that carries it, the starting replacement included. Docker DNS doesn't know about health, so web and admin would hit an API that is still migrating.

**Use Coolify's Traefik.** Its Docker provider only adds a container as a load-balancer server once it is healthy, unless `allowEmptyServices` is set ([Traefik Docker provider](https://doc.traefik.io/traefik/reference/install-configuration/providers/docker/)). This is the same mechanism that makes public domains switch safely during a rolling update.

### Setup
1. **Proxy alias.** In Coolify → **Servers → Proxy → Configuration**, under the `coolify-proxy` service, add a network alias so the name resolves to Traefik inside the destination network:
   ```yaml
   networks:
     coolify:
       aliases:
         - api.nibleaf.internal
   ```
   Save and restart the proxy. It's a few seconds of proxy restart, so do it inside the cutover window (§4).
2. **API domain.** Give `nibleaf-api` the domain `http://api.nibleaf.internal:4311`. It must be plain `http`, because Traefik can't obtain a certificate for a `.internal` name.
3. **Web and admin settings.** Set `API_URL=http://api.nibleaf.internal` on **both** `nibleaf-web` **and** `nibleaf-admin`. Admin reads **`API_URL`**: `scripts/configure-web-runtime.mjs` rewrites the image's API origin from `API_URL` and falls back to `http://server:4311`. Setting `VITE_API_URL` alone leaves admin pointing at the removed Compose `server`, while admin's own `/health` stays green.

### Proof, before cutover
1. From inside the web container, run a continuous loop: `while true; do curl -s -o /dev/null -w '%{http_code}\n' http://api.nibleaf.internal/health; sleep 0.2; done`.
2. While it runs, deploy a **deliberately failing** API replacement: same tag, but `NIBLEAF_MIGRATE_ATTEMPTS=1` and `POSTGRES_URL` pointing at a nonexistent host.
3. Expect only `200` throughout. Coolify must keep the old container, and the failing one must never receive a request (check its logs).
4. Then deploy a healthy replacement under the same loop. Again expect only `200`.

**If the alias or the health filtering can't be confirmed, stop and report.** Rolling replacement is not safe without it.

## 4. One-time cutover: Compose to Docker Image applications

Plan B below is a short, planned interruption for this one-time move only. Every later deploy is rolling.

### 4.1 Prerequisites (all of them)
- [ ] Owner approval, including the memory decision in §8 based on **measured** numbers.
- [ ] A fresh, verified Postgres backup, with a restore test, recorded as the backup reference.
- [ ] The current production image tag is immutable, recorded as `ROLLBACK_TAG` (`sha-<40 hex>`), and the Compose resource's `NIBLEAF_IMAGE_TAG` is pinned to it.
- [ ] A snapshot of the Compose resource: environment, domains, labels and Compose file.
- [ ] Host gates pass twice, 5 min apart: `load1 < 6`, `MemAvailable ≥ 1024 MiB` with swap < 75% (or ≥ 900 MiB with swap < 60%), and ≥ 6 GiB free disk after the pull.

### 4.2 Data services reachable from the destination network
1. On the Compose resource, enable **Connect to Predefined Network** and redeploy it once. The data services may restart for a few seconds.
2. On the host, record the exact names that resolve on the `coolify` network. Data services don't roll, so their aliases are safe to use.
   ```sh
   docker ps --format '{{.Names}}' | grep -E 'postgres|dragonfly|qdrant|clickhouse|maxio'
   docker inspect -f '{{.Name}} {{range $k,$v := .NetworkSettings.Networks}}{{$k}}={{join $v.Aliases ","}} {{end}}' <container>
   ```

### 4.3 Create the applications (none of them takes public traffic yet)
Every application:
- uses image `ghcr.io/lord007tn/nibleaf:<ROLLBACK_TAG>`, the same revision as today, so no migration runs;
- runs on destination `coolify`;
- has **Ports Mappings** empty and **Ports Exposes** set to the port in §1;
- keeps the default container naming, except admin and worker (§8);
- uses Custom Docker Options `--init`;
- copies the environment from the Compose snapshot (`x-service-env`), with data-service hosts from 4.2;
- adds the role variables from §1, the timers from §2, the memory caps from §8, and the health checks from §2.

### 4.4 Move traffic: pick a plan using the §8 cutover budget

**Plan A: staged, no interruption.** Only allowed when the **measured** cutover budget in §8 fits.
1. Stop the Compose `admin` and `worker` services. Admin is down until step 5 and queue jobs wait; both are acceptable in the window.
2. Start `nibleaf-api` (healthy), apply §3 (proxy alias and API domain), and run the §3 proof.
3. Start `nibleaf-web` with **no domain** and verify it from inside the network: `curl -fsS -H 'Host: nibleaf.com' http://<web-alias>:4310/health`.
4. Move the `app` domains from the Compose resource to `nibleaf-web` in the same minute. Coolify regenerates the routers, so expect at most seconds of 404/502 while Traefik reloads.
5. Start `nibleaf-admin` and move `admin.nibleaf.com` to it. **Sign in to admin and open the Sites list and one site detail page**, which proves admin's `API_URL` reaches the new API.
6. Start `nibleaf-worker`. Confirm that `/health` is 200 and that a queued job (for example a test publish on the QA site) completes.
7. Only now remove `server`, `app`, `admin`, `worker` and `migrate` from the Compose file and redeploy it. Data services keep running.

**Plan B: a short stop-then-start window (recommended unless the RAM increase happens first).**
1. Announce a maintenance window. The edge maintenance page (#433) covers custom domains during it.
2. Stop the Compose `server`, `app`, `admin` and `worker` services. The window starts here.
3. Start `nibleaf-api`, apply §3 and wait until it is healthy.
4. Start `nibleaf-web`, `nibleaf-admin` and `nibleaf-worker`, and move the domains as in Plan A steps 4–5, including the admin sign-in check.
5. Remove the app services from the Compose file and redeploy it.

Expected window: the start-up time, about 60–90 s, like today's deploys. It happens once. Memory never exceeds today's peak.

### 4.5 After either plan
1. Run §7 **V1** immediately.
2. Then run one rolling release of the same tag under the **V2**/**V3** loops. That proves rolling before any real release depends on it.

### 4.6 Release automation
`scripts/coolify-release.mjs` updates one Compose resource. After cutover it must:
- update the image tag on each application and deploy them **one at a time, in order**: api, web, admin, worker;
- probe after each one;
- restore all of them on failure (§10).

This is a follow-up PR made after approval and tested against the real resources. Until it lands, deploy by hand in that order, and never in parallel.

## 5. Keeping migrations expand-only

**The rule.** A migration only adds, and it must be **provably** safe for the previous release. That covers:
- new tables;
- new nullable or defaulted columns;
- new non-unique indexes;
- constraints only on what it creates;
- unique keys only when one key column is newly added as nullable with no default.

**What needs a reasoned opt-out.** Everything else:
- drops of any kind, including constraint and index drops;
- renames and retypes;
- `SET NOT NULL` and `DROP DEFAULT`;
- new foreign keys, checks or unique constraints on existing data. `NOT VALID` still applies to new writes, so it doesn't make these safe.
- `UPDATE`, `DELETE`, `TRUNCATE`, data-modifying CTEs, and `INSERT` into existing tables;
- any DO block, function, trigger or query, because they can't be analysed statically.

A contract change ships in a release *after* the one that stopped using the old shape, once that release's rollback window has closed.

**Enforcement.** `scripts/migration-safety.mjs` parses each migration with the real PostgreSQL 17 parser (`libpg-query`) and checks it against an allowlist. It fails closed: SQL it can't parse fails even with an opt-out.
1. **CI.** Every PR and every push to main checks changed `migration.sql` files. A file passes only if it is expand-only or carries `-- nibleaf-migration: contract <reason>`. Tests: `scripts/migration-safety.test.mjs`.
2. **Release workflow** (`.github/workflows/docker.yml`). It checks **every migration between the rollback revision and the candidate**. Any unmarked statement stops the release. Any marked one stops it unless the dispatch says `migration_mode=expand-contract`, which in turn requires `migration_evidence` and `backup_reference`. `restore-required` is refused outright.
3. **Manual deploys before 4.6 lands.** Run `node scripts/migration-safety.mjs --base <rollback sha>` on the candidate and attach the output to the release record.
   - `::error` means **do not deploy**.
   - Any `CONTRACT` line means do not deploy unless the release record carries the same approval the automated path requires:
     - the named approver;
     - a migration inventory or dry-run reference;
     - the backup and restore-test reference;
     - a statement that the rollback target no longer reads the removed shape.

## 6. Queue job compatibility (api ↔ worker)

During a release, the **new API enqueues jobs that the old worker processes** until the worker rolls last. After a rollback, jobs enqueued by the new release are retried by the old worker, and the same can happen in the other direction. BullMQ's locks and retries prove that jobs are delivered. They don't prove the payload is understood.

**Gate for every release:**
```sh
git diff --stat <rollback sha>..<candidate sha> -- packages/bullmq/src apps/worker/src/processors
```
If this lists **any** change to a job payload type (`packages/bullmq/src/jobs/*`, `packages/bullmq/src/types.ts`) or to how a processor reads one, the release record must contain **compatibility evidence** for all three directions:
1. **New API → old worker:** new fields are optional, and the old processor ignores them or handles their absence.
2. **Queued or retried jobs → new worker:** the new processor accepts payloads written by the old API, so no field becomes required.
3. **Rollback:** jobs written by the new release are still processed correctly by the old worker, or are drained first.

Acceptable evidence: a test, or a reviewed note that cites the processor code. Without that evidence, **do not deploy**. Instead, split the change: make the processor tolerant first, and change the payload in a later release.

## 7. Verification

- **V1, after cutover:**
  - `scripts/coolify-release-probes.mjs`;
  - signed-out EN and AR pages on a custom domain and on a `*.nibleaf.com` site;
  - the admin journey from 4.4.
- **V2, the owner's proof.** Start this loop on a machine outside the host before triggering a release, and keep it running until 2 minutes after the last application is replaced. It must show **zero non-2xx**:
  ```sh
  targets='https://docs.joodbooking.com/ https://joodpms.nibleaf.com/ https://nibleaf.com/ https://nibleaf.com/health https://nibleaf.com/api/app/health https://admin.nibleaf.com/sign-in'
  while true; do
    for u in $targets; do
      curl -s -o /dev/null -m 10 -A nibleaf-rolling-probe \
        -w "%{http_code} %{time_total} $u %header{x-nibleaf-revision}\n" "$u" | sed "s/^/$(date -u +%T) /"
    done
    sleep 0.5
  done | tee rolling-probe.log
  awk '$2 !~ /^2/' rolling-probe.log   # must print nothing
  ```
  **Pass** means all of:
  - no non-2xx line;
  - the revision flips from old to new on every target;
  - p95 `time_total` under 2 s during the overlap;
  - 0 OOM kills (`dmesg | grep -i oom`);
  - the internal loop from §3 also shows only 200.
- **V3, a streaming request across a replacement.** Start an AI chat answer on a docs site, or any long download, then trigger the web roll. The stream must complete without truncation, which proves the §2 timers.
- **Any failure** means the rolling claim is **not** substantiated. Fix it before the next release, and don't relabel the outage as maintenance.

## 8. Resource budget

Host data from the audit thread, 2026-11-10:
- 4 CPU, 7,751 MiB RAM, 8,191 MiB swap, shared with Keenpix, Naasher and Plane;
- during deploy 5: MemAvailable 683–1,266 MiB and swap 51–69% (the peak was during the image pull), with 0 OOM kills;
- Compose memory limits exist today only on clickhouse (1,536 MiB) and worker (1 GiB).

> **Decision pending live numbers.** The figures below are conservative estimates until the audit thread's read-only `docker stats` / `docker inspect` inventory arrives. Replace them with the measured RSS and re-check both budgets before approval.

| Service | Estimated steady RSS | Cap (Coolify memory limit / `NODE_OPTIONS`) | During releases |
| --- | ---: | --- | --- |
| api | 350–550 MiB | 768 MiB / `--max-old-space-size=512` | rolling: at most 1 extra copy |
| web | 250–450 MiB | 640 MiB / `--max-old-space-size=448` | rolling: at most 1 extra copy |
| admin | 150–300 MiB | 384 MiB / `--max-old-space-size=256` | **stop-then-start**: set "Consistent container name" on this app. It's an internal tool, so seconds of downtime are acceptable. |
| worker | ≤ 1 GiB | 1 GiB | **stop-then-start**: set "Consistent container name". A second 1 GiB copy doesn't fit, and jobs wait seconds (§6 covers compatibility). |

**Release budget (steady state).** Applications deploy one at a time, so the worst overlap is one extra api copy, the **768 MiB** cap.
- **Go/no-go before each roll:**
  - `MemAvailable ≥ cap of the app being rolled + 300 MiB` (api ≥ 1,068 MiB, web ≥ 940 MiB);
  - swap < 75%;
  - load1 < 6.
- If the gate fails, re-check every 60 s for 15 min, then abort.
- The image is pulled once, before the first roll, and the gate runs after the pull.

**Cutover budget (one time).**
- Plan A runs new api and web **while** the Compose `server` and `app` still serve, so the extra memory is ≈ RSS(api) + RSS(web) = 0.6–1.0 GiB, minus what stopping Compose admin and worker frees.
- **Plan A is allowed only if** `MemAvailable` after stopping admin and worker ≥ the caps of api + web (1,408 MiB) + 300 MiB.
- Otherwise use **Plan B**, which never exceeds today's footprint.

**Verdict from today's numbers.**
- The 768 MiB release overlap fits at the high end of observed MemAvailable (1,266 MiB) and **not** at the low end (683 MiB).
- The cutover budget doesn't fit Plan A.
- **Recommendation:** use **Plan B** for the cutover. Add **4 GiB RAM** (to about 12 GiB), or move a co-tenant product off the host, so rolling releases don't regularly wait on, or abort at, the gate.
- Confirm or revise all of this once the measured numbers arrive.

## 9. Approval checklist for the owner
- [ ] The topology in §1, including slimming the Compose resource and the proxy alias in §3.
- [ ] Cutover with Plan B in a maintenance window (or Plan A if the measured budget fits).
- [ ] Memory caps, staggering and the RAM decision (§8), based on measured numbers.
- [ ] The follow-up PR for ordered release automation (4.6).

## 10. Rollback and recovery

### 10.1 Rollback
- **During cutover, before traffic moves:** delete the new applications.
- **During cutover, after traffic moves:** move the domains back to the Compose `app`/`admin`, restore the Compose file from the snapshot (it is still on `ROLLBACK_TAG`), and redeploy. No schema changed, because cutover runs the same revision.
- **During a release, when a replacement fails its health check:** Coolify keeps the old container. Stop the release; the remaining applications are still on the old tag. If the failure is a migration, go to 10.2 **before** anything else.
- **Post-deploy probes fail, or V2/V3 fail:** set each rolled application back to `ROLLBACK_TAG` and deploy in **reverse order**: worker, admin, web, api.
  - **Rolling the containers back does not undo schema changes.** The old release keeps working only because §5 kept the schema change expand-only.
  - If the API's migration record isn't clean (10.2), set `NIBLEAF_MIGRATE_ON_START=false` on `nibleaf-api` **before** redeploying it, so the rollback API can't get stuck on the failed record.

### 10.2 A migration fails part-way
Prisma does not wrap a PostgreSQL migration in a transaction unless the file does. A failed migration can therefore leave **partial** changes behind, plus a failed row in `_prisma_migrations`. Every later `migrate deploy` then refuses to run (P3009), including the one in the rollback image.

1. **Contain.** The failed replacement is unhealthy, and the old API keeps serving. Pause releases. Set `NIBLEAF_MIGRATE_ON_START=false` on `nibleaf-api`, so no restart or rollback re-attempts the migration.
2. **Inventory.** From a running API container, check the migration state:
   ```sh
   docker exec <api-container> sh -c 'cd packages/database && node ../../node_modules/prisma/build/index.js migrate status'
   ```
   Then list what the failed migration's statements actually changed (`\d` the affected tables in `psql`), compared with the migration file.
3. **Reconcile.** Make a reviewed decision, written into the release record:
   - **Roll back:** write and review SQL that removes the partial expand changes, run it, then mark the migration with `migrate resolve --rolled-back <migration_name>`.
   - **Complete:** apply the remaining statements by hand, after review, then run `migrate resolve --applied <migration_name>`.
4. **Verify.** `migrate status` is clean. Re-enable `NIBLEAF_MIGRATE_ON_START=true`, and release again with a fixed migration in a new release.
5. **Escalate** if a partial change already broke the old release, which only happens if the expand-only gates were bypassed. In that case, follow the restore path in `deployment-reliability.md`: stop writes, restore the verified backup, and start the rollback image.
