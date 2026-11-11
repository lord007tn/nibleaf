# Runbook: rolling deploys for the Nibleaf app tier

**Status:** proposed, needs owner approval before any step runs. It changes production infrastructure (Coolify resources), so nobody executes it without that approval.
**Fixes:** READER-01 and PUBLIC-01 (P0). Each deploy currently takes customer docs, the dashboard and the API offline for about 85 s. On 2026-11-10 that was 20:19:12–20:20:37Z, with 503s on every custom domain.
**Companion runbook:** [`runbook-subdomain-edge-route.md`](runbook-subdomain-edge-route.md).
**Background:** [`deployment-reliability.md`](deployment-reliability.md), the "Eligible Coolify Docker Image applications" contract this runbook carries out.

## 1. Why and what

Production runs as one Coolify **Docker Compose** resource (`docker-compose.coolify.yml`). [Coolify does not do rolling updates for Compose](https://coolify.io/docs/knowledge-base/rolling-updates), so it stops every changed service and then starts the new ones. The one-shot `migrate` service sits in front of `server` and `worker` (`service_completed_successfully`), and `app` and `admin` wait for `server` to be healthy. The outage covers both the gap and the start-up time.

Coolify **Docker Image applications** do support rolling updates:
1. Start the replacement next to the running container.
2. Wait until its health check passes.
3. Only then stop the old one.

If the replacement never becomes healthy, the old container stays up. Requirements: no host port mapping, no "Consistent container name", no custom container name, no custom IP.

**Target topology.** Every new application runs the same immutable image, `ghcr.io/lord007tn/nibleaf:sha-<40 hex>`:

| Coolify resource | Kind | Role (`NIBLEAF_COMMAND`) | Port | Domain(s) | Replacement |
| --- | --- | --- | ---: | --- | --- |
| `nibleaf-data` (the existing Compose resource, slimmed down) | Docker Compose | postgres, dragonfly, qdrant, clickhouse, maxio | — | `storage.nibleaf.com:9000` (maxio, unchanged) | unchanged; rarely redeployed |
| `nibleaf-api` | Docker Image | `server` + `NIBLEAF_MIGRATE_ON_START=true` | 4311 | none (internal) | **rolling** |
| `nibleaf-web` | Docker Image | `app` | 4310 | `https://nibleaf.com:4310` + the wildcard/custom-domain routes `app` has today | **rolling** |
| `nibleaf-admin` | Docker Image | `admin` | 4315 | `https://admin.nibleaf.com:4315` | stop-then-start (see §6) |
| `nibleaf-worker` | Docker Image | `worker` | 4312 | none | stop-then-start (see §6) |

**Why migrations run in the API container.** Migrations run inside the new API container *before* it can report healthy. That container is the one-shot gate for every other role: until it is healthy, nothing new receives traffic. If a migration fails, the container is never healthy, Coolify keeps the old API, and the release stops. Prisma's `migrate deploy` takes a PostgreSQL advisory lock, so concurrent starts serialise. The roll order (API, then web, then admin, then worker) means no new code runs before its schema exists. §4 keeps every migration expand-only, so the old containers still running during the overlap keep working against the new schema.

Code support ships with this runbook's PR:
- `docker-entrypoint.sh` selects the role from `NIBLEAF_COMMAND`, because Docker Image applications have no per-service command;
- the `server` role runs `prisma migrate deploy` first when `NIBLEAF_MIGRATE_ON_START=true`;
- CI and the release workflow enforce the expand-only gate.

## 2. Health checks each application must pass before old containers stop

Set these in each application's **Health check** settings. Keep the defaults for anything not listed.

| App | Method / path / port | Healthy only when | Interval / timeout / retries | Start period | Stop grace period |
| --- | --- | --- | --- | --- | --- |
| `nibleaf-api` | GET `/health` on 4311 | the server is `ready` (Redis scheduling and startup work done, and storage if `STORAGE_REQUIRED_FOR_HEALTH`), not shutting down, and — with `NIBLEAF_MIGRATE_ON_START` — migrations applied, because the server only starts after them | 5 s / 3 s / 3 | **180 s** (migrations plus boot) | 45 s |
| `nibleaf-web` | GET `/health` on 4310 with header `Host: nibleaf.com` | the API answers `/api/app/health` 200 **through the new app container**; returns 503 once the drain file exists | 5 s / 3 s / 3 | 60 s | 45 s |
| `nibleaf-admin` | GET `/health` on 4315 | process ready | 10 s / 5 s / 5 | 30 s | 45 s |
| `nibleaf-worker` | GET `/health` on 4312 | workers ready (`deployment-reliability.md`) | 10 s / 5 s / 5 | 30 s | 45 s |

- **Header on the web check:** the image's health check can't add the `Host` header, so use the Coolify health-check form with the custom header. The equivalent is `curl -fsS -A nibleaf-healthcheck -H 'Host: nibleaf.com' http://127.0.0.1:4310/health`.
- **Drain:** on SIGTERM, the web/admin wrapper writes the drain file *before* forwarding the signal (`scripts/service-signals.test.mjs`). `/health` turns 503, so the proxy stops sending new requests while in-flight ones finish within the 45 s grace.

## 3. One-time cutover: Compose to Docker Image applications

Do this in a maintenance window. Expect one short interruption, about 5–15 s, at step 3.6, when the domains move. Every later deploy is rolling. Do not skip a verification; if one fails, stop and roll back (§7).

### 3.1 Prerequisites
- [ ] Owner approval, and the memory decision in §6 is made with live numbers.
- [ ] A fresh, verified Postgres backup and a restore test, recorded as the backup reference.
- [ ] The **current** production image tag is immutable and recorded as `ROLLBACK_TAG` (`sha-<40 hex>`, see `deployment-reliability.md`). Pin the Compose resource's `NIBLEAF_IMAGE_TAG` to it.
- [ ] Snapshot of the Compose resource's full environment, domains and labels. The new applications must use the same values.
- [ ] Host gates pass twice, 5 min apart: `load1 < 6`; `MemAvailable ≥ 1024 MiB` with swap < 75% (or ≥ 900 MiB with swap < 60%); ≥ 6 GiB free disk after the image pull.

### 3.2 Let other resources reach the data services
1. Compose resource → **Settings** → enable **Connect to Predefined Network** (the `coolify` destination). Redeploy it once. Postgres, Dragonfly, Qdrant, ClickHouse and maxio may restart (seconds), so do this inside the window.
2. On the host, record the exact hostnames other containers must use. Coolify may prefix or suffix the names, so verify them rather than guessing:
   ```sh
   docker ps --format '{{.Names}}' | grep -E 'postgres|dragonfly|qdrant|clickhouse|maxio'
   docker inspect -f '{{.Name}} {{range $k,$v := .NetworkSettings.Networks}}{{$k}}={{join $v.Aliases ","}} {{end}}' $(docker ps -q --filter name=postgres)
   ```
   Record `PG_HOST`, `REDIS_HOST`, `QDRANT_HOST`, `CLICKHOUSE_HOST` and `MAXIO_HOST` as names that resolve on the `coolify` network.

### 3.3 Create `nibleaf-api` (Docker Image application)
- **Image:** `ghcr.io/lord007tn/nibleaf`. **Tag:** `ROLLBACK_TAG`, the same revision as today.
- **Network:** destination `coolify` (default). **Ports Mappings:** *empty*. **Ports Exposes:** `4311`. **Domains:** none.
- **Container naming:** default (no Consistent name, no Custom Container Name). **Custom Docker Options:** `--init`. No `--ip`.
- **Environment:** copy `x-service-env` from the Compose snapshot, then:
  - `NIBLEAF_COMMAND=server`, `NIBLEAF_MIGRATE_ON_START=true`;
  - `POSTGRES_URL=postgresql://…@<PG_HOST>:5432/nibleaf`;
  - `REDIS_HOST=<REDIS_HOST>`, `QDRANT_URL=http://<QDRANT_HOST>:6333`, `CLICKHOUSE_URL=http://<CLICKHOUSE_HOST>:8123`, `STORAGE_ENDPOINT=http://<MAXIO_HOST>:9000`;
  - memory cap per §6.
- **Health check:** per §2. **Advanced → Stop Grace Period:** 45 s.
- Deploy. Verify that it's healthy and that its migration log says `No pending migrations to apply`, since it runs the current revision.

### 3.4 Find the API's stable internal hostname
Coolify docs don't document a stable alias for applications, so determine it:
```sh
docker inspect -f '{{.Name}} {{range $k,$v := .NetworkSettings.Networks}}{{$k}}={{join $v.Aliases ","}} {{end}}' $(docker ps -q --filter name=<api-resource-uuid>)
```
- Use an alias that is **the same for every deployment of this resource**, typically the resource UUID. Never use the timestamped container name. Record it as `API_HOST`.
- Prove it from a throwaway container on the same network: `docker run --rm --network coolify curlimages/curl:8.11.1 -fsS http://<API_HOST>:4311/health`.
- **Stop here** if no deployment-stable alias exists, and report it. Rolling replacement is not safe without one.

### 3.5 Create `nibleaf-web`, `nibleaf-admin` and `nibleaf-worker`
These have the same settings as 3.3. The differences:
- **web:** `NIBLEAF_COMMAND=app`, `PORT=4310`, `API_URL=http://<API_HOST>:4311`, `VITE_SITE_BASE_DOMAIN`. Expose `4310`. **No domains yet.** Health check per §2.
- **admin:** `NIBLEAF_COMMAND=admin`, `PORT=4315`, `VITE_API_URL=http://<API_HOST>:4311`. Expose `4315`. No domain yet. Container naming per §6.
- **worker:** `NIBLEAF_COMMAND=worker`. Expose `4312`, no domain. Basic auth for `/jobs` (`WORKBENCH_USER`/`WORKBENCH_PASS`) as today. Container naming per §6. **Leave the worker stopped** until 3.6, so two worker fleets never run against one queue during setup.

Deploy web and admin and verify both from inside the network:
```sh
docker run --rm --network coolify curlimages/curl:8.11.1 -fsS -H 'Host: nibleaf.com' http://<web-alias>:4310/health
```

### 3.6 Move traffic: the short interruption
1. Compose resource: remove the domains from `app` and `admin`. Then, **in the same minute**, add them to `nibleaf-web` (`https://nibleaf.com:4310` plus every additional domain/wildcard rule `app` carried) and `nibleaf-admin` (`https://admin.nibleaf.com:4315`). Save and redeploy the proxy configuration.
2. Stop and remove the Compose `server`, `app`, `admin`, `worker` and `migrate` services by deleting them from the Compose file in Coolify. Leave the data services and `analytics-migrate`. Redeploy the Compose resource; the data services keep running.
3. Start `nibleaf-worker`.
4. Run §5 verification **V1** (single pass) immediately.

### 3.7 Point the release workflow at the new resources
`scripts/coolify-release.mjs` currently sets `NIBLEAF_IMAGE_TAG` on one Compose resource. After cutover it must instead update the image tag of each application and deploy them **in order**, waiting for each to report healthy:
1. `nibleaf-api`
2. `nibleaf-web`
3. `nibleaf-admin`
4. `nibleaf-worker`

It must run the existing probes after each step, and restore all four on failure (§7). That change is a follow-up PR made after approval and tested against the new resources. Until it lands, deploy each application by hand in that order. Never deploy them in parallel.

## 4. Keeping migrations expand-only

**Rule:** a migration may only *add*: new tables, new nullable or defaulted columns, new indexes, and constraints on what it creates or adds. The previous release must keep working against the new schema for the whole overlap, and it remains the rollback target.

These require a **contract** migration:
- removing, renaming or retyping anything;
- `SET NOT NULL` on existing columns;
- adding a NOT NULL column without a default;
- new UNIQUE/CHECK constraints on existing data;
- deleting rows.

**How contracts ship.** A contract migration ships in a release *after* the one that stopped using the old shape, once the rollback window for that earlier release has closed.

**Enforcement (in this PR):**
1. **CI, every PR and push to main:** `scripts/migration-safety.mjs` checks each added or changed `migration.sql`. It fails on any contract statement unless the file carries `-- nibleaf-migration: contract <reason>`, so the exception gets a reviewer's explicit attention. Tests: `scripts/migration-safety.test.mjs`.
2. **Release workflow (`.github/workflows/docker.yml`):** before deploying, it runs the same check over **every migration between the rollback revision and the candidate**. It refuses any unmarked contract statement, and refuses a marked one unless the dispatch says `migration_mode=expand-contract`. `restore-required` is already refused by the automatic path.
3. **Runbook gate (manual deploys before 3.7 lands):** run `node scripts/migration-safety.mjs --base <rollback sha>` locally on the candidate and attach the output to the release record. Any `::error` means **do not deploy**.

## 5. Verification: a deploy under a continuous probe loop

**V1, after cutover:** the release probes (`scripts/coolify-release-probes.mjs`), plus one signed-out EN and one AR page on a custom domain and on a `*.nibleaf.com` site.

**V2, the proof the owner asked for.** Start the probe loop **before** triggering a normal release, keep it running until 2 minutes after the last application is replaced, and expect **zero non-2xx**:
```sh
# On any machine outside the host. Every 0.5 s, each target; logs status, time and revision.
targets='https://docs.joodbooking.com/ https://joodpms.nibleaf.com/ https://nibleaf.com/ https://nibleaf.com/health https://nibleaf.com/api/app/health https://admin.nibleaf.com/sign-in'
while true; do
  for u in $targets; do
    curl -s -o /dev/null -m 10 -A nibleaf-rolling-probe \
      -w "%{http_code} %{time_total} $u %header{x-nibleaf-revision}\n" "$u" | sed "s/^/$(date -u +%T) /"
  done
  sleep 0.5
done | tee rolling-probe.log
# Afterwards:
awk '$2 !~ /^2/' rolling-probe.log   # must print nothing
```
- **Pass:** no line outside 2xx, the revision flips from old to new on every target, p95 `time_total` stays under 2 s during the overlap, and there are 0 OOM kills (`dmesg | grep -i oom`).
- Keep the log in the release record.
- Any 5xx means the rolling claim is **not** substantiated. Investigate before the next release; don't relabel it as maintenance.

## 6. Resource budget during overlap

**Host** (audit thread, 2026-11-10): 4 CPU, 7,751 MiB RAM, 8,191 MiB swap, shared with Keenpix, Naasher and Plane. During deploy 5, MemAvailable was **683–1,266 MiB** and swap 51–69% (peaking during the image pull), with 0 OOM kills. Compose limits exist today only on `clickhouse` (1,536 MiB) and `worker` (1 GiB).

> **Decision pending live numbers.** The per-container figures below are **conservative estimates** until the audit thread's read-only `docker stats` / `docker inspect` inventory arrives. Replace the "estimate" column with the measured RSS and re-check the go/no-go rule before approval.

| Service | Estimated steady RSS | Proposed cap (Coolify memory limit / `NODE_OPTIONS`) | Overlap strategy |
| --- | ---: | --- | --- |
| api (`server`) | 350–550 MiB | 768 MiB / `--max-old-space-size=512` | **rolling**: up to 1 extra copy |
| web (`app`) | 250–450 MiB | 640 MiB / `--max-old-space-size=448` | **rolling**: up to 1 extra copy |
| admin | 150–300 MiB | 384 MiB / `--max-old-space-size=256` | **stop-then-start**: set *Consistent container name* on this app only. It is an internal staff tool, so a few seconds of downtime are acceptable and its overlap memory is saved. |
| worker | ≤ 1 GiB (existing limit) | 1 GiB | **stop-then-start**: Consistent container name. Queue jobs wait seconds; BullMQ locks and retries cover in-flight jobs. A second 1 GiB copy doesn't fit. |

**How overlap is bounded.** The release deploys applications **one at a time**, so the worst overlap is one extra copy of the largest rolling service: the api cap, **768 MiB**. A whole duplicate set (≈ 1.8–2.8 GiB with worker) would not fit on this host, and the runbook never runs one.

**Go/no-go before each application's roll:**
- `MemAvailable ≥ cap of the service being rolled + 300 MiB` (api: ≥ 1,068 MiB; web: ≥ 940 MiB);
- swap < 75%;
- load1 < 6.

Otherwise wait and re-check every 60 s for up to 15 min, then abort. The pull happens **once**, before the first roll: all four applications share the image. Run the gate *after* the pull, because the pull is the swap peak.

**Verdict from today's numbers.**
- At the high end of observed MemAvailable (1,266 MiB) the api roll fits; at the low end (683 MiB) it doesn't.
- With the caps above and staggering, rolling is feasible on most deploys, but the host has **no reliable headroom**. Some releases would wait on the gate, or abort.
- **Recommendation: +4 GiB RAM (to about 12 GiB)**, or move one of the co-tenant products off the host. Either gives a consistent ≥ 2 GiB MemAvailable, enough for any single overlap plus the image pull. Confirm or revise this with the measured numbers.

## 7. Rollback

**During cutover (§3):**
- Before 3.6, nothing serves from the new applications, so delete them.
- After 3.6: move the domains back to the Compose `app`/`admin` services, restore the Compose file from the snapshot (its `NIBLEAF_IMAGE_TAG` is still `ROLLBACK_TAG`), and redeploy the Compose resource. The schema is unchanged because cutover runs the same revision, so there is nothing to undo in the database.

**During a rolling release:**
- **A replacement fails its health check:** Coolify keeps the old container. Stop the release; the remaining applications are still on the old tag.
- **Post-deploy probes fail, or V2 shows non-2xx:** set each already-rolled application back to `ROLLBACK_TAG` and deploy them in **reverse order**: worker, admin, web, api. §4 keeps the previous release compatible with the new schema, so no database restore is involved.
- **A migration turns out not to be backward compatible despite the gates:** follow the restore path in `deployment-reliability.md`. Stop writes, restore the verified backup, and start the rollback image.

## 8. Approval checklist for the owner
- [ ] Topology in §1, including slimming the Compose resource to data services only.
- [ ] Maintenance window for the one-time cutover (§3, about 5–15 s interruption at 3.6).
- [ ] Memory: caps and staggering per §6, and the RAM increase recommendation, after the live numbers.
- [ ] Follow-up PR to make `scripts/coolify-release.mjs` deploy the four applications in order (§3.7).
