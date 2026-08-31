# Nibleaf deployment reliability contract

This is the operator contract for Nibleaf Cloud releases. It separates what the
repository can prove from what the hosting platform must prove. A healthy image
or a completed provider job is not, by itself, a healthy production release.

## Current Coolify Compose resource

The current full-stack resource is a Docker Compose application. [Coolify does
not support application-level rolling updates for Docker Compose applications;
Compose reconciles and replaces the services](https://coolify.io/docs/knowledge-base/rolling-updates). Health checks prevent dependent
services from starting too early, but they do not keep the previous public
container routed while its replacement starts. An observed 503 window is
therefore a real availability failure, not proof that a health check was wrong.

Every Compose deployment must use the manual Docker workflow and must:

1. serialize against every other production release without cancellation;
2. resolve current `main` to one full Git SHA and publish `sha-<SHA>` plus an OCI
   digest, SBOM, source revision label, and GitHub build-provenance attestation;
3. record a privacy-safe migration inventory/dry run, a verified backup and
   restore-test reference, and the exact currently deployed rollback image;
4. allow only no-schema-change or backward-compatible expand/contract
   migrations in the automatic path;
5. atomically change Coolify's `NIBLEAF_IMAGE_TAG` from the known rollback tag
   to the exact candidate tag, then run the one-shot migrations before services;
6. wait for the provider deployment to finish, then prove the image-backed app,
   API readiness, admin on port 4315, and app sitemap expose the exact revision
   while the separately published docs and docs sitemap are HTTP 200 for at
   least three consecutive probe rounds; and
7. restore the previous tag, trigger a compensation deployment, and re-probe
   that exact previous revision when deployment or verification fails.

The workflow intentionally refuses `restore-required` migrations. Those need a
write freeze, a separately rehearsed restore, and an operator-controlled window.
Never infer that a Redis queue is empty. Queue metadata migrations require a
tenant-aware inventory, backup, dry run, and rollback proof before deployment.

The Compose path still has a replacement window. Schedule it as maintenance and
do not call it zero downtime.

## Eligible Coolify Docker Image applications

Near-zero-downtime rolling replacement requires moving public processes from
the Compose resource into separate Coolify Docker Image applications. The
shared Postgres, Dragonfly, Qdrant, ClickHouse, and object storage must remain
external services; migrations remain a separate one-shot release job.

Configure these image applications from the same immutable digest:

| Resource | Command | Internal port | Readiness | Shutdown |
| --- | --- | ---: | --- | --- |
| API | `server` | 4311 | `/health` is 200 only after Redis scheduling and required startup work | stops accepting requests, drains HTTP, closes queues and analytics clients |
| Dashboard/docs | `app` | 4310 | `/health` checks the API and becomes 503 before drain | readiness is disabled for 15 seconds before termination; grace period is at least 45 seconds |
| Admin | `admin` | 4315 | `/health`; preserve the explicit 4315 route | readiness is disabled for 15 seconds before termination; grace period is at least 45 seconds |
| Worker | `worker` | 4312 | `/health` only after workers are ready | marks unready, stops polling, closes workers, queue clients, and analytics clients |

Do not publish host ports, set custom/consistent container names, or assign a
custom container IP: old and new containers must overlap. [Enable the image or
Coolify health check](https://coolify.io/docs/knowledge-base/health-checks), use the default container name, and configure an adequate
stop grace period. The worker is rolled last so old and new API processes can
enqueue work against a compatible worker and schema.

The release order is:

1. verify artifact digest, provenance, source revision, migration evidence,
   backup/restore evidence, and the previous immutable digest;
2. run backward-compatible expand migrations once under a deployment lock;
3. roll API, then dashboard/docs, then admin, proving the new revision after
   each resource while the old resource still serves traffic;
4. roll workers last, with concurrency and repeatable-job ownership unchanged;
5. continuously request representative signed-out EN/AR marketing and docs
   pages during the transition, then run the complete post-deploy gate; and
6. contract old schema only in a later release after the rollback window closes.

Before the first release through this contract, publish an immutable tag for
the currently deployed revision, pin the Compose resource's
`NIBLEAF_IMAGE_TAG` to it, and verify that no-op baseline deployment. The
automatic path refuses an absent or mutable rollback tag.

If a new container is unhealthy, Coolify must keep the old container. If public
proof fails after a provider reports success, redeploy the previous immutable
digest. If a migration is not backward compatible, stop writes and restore the
verified recovery set instead of starting old code against new state.

## Required production evidence

Keep one release record containing the source SHA, image digest, attestation,
provider application UUIDs and deployment UUIDs, configured image references,
migration output, backup/restore reference, health-check transition logs,
graceful shutdown logs, and rollback or compensation result.

After the final default-branch deployment independently verify:

- exact revision headers and API readiness body;
- app, admin, docs, API health, and both sitemaps over public HTTPS;
- signed-out English/LTR and Arabic/RTL marketing and docs, including canonical
  and hreflang relationships and zero literal `/sites/$projectId` placeholders;
- desktop and mobile rendering, hydration, console, and horizontal overflow;
- tenant-isolated authenticated publish/search behavior and preserved queue
  schedules; and
- no unexplained 5xx responses during the measured transition.

Only the Docker Image architecture can attempt a rolling availability claim,
and only continuous production-like request evidence can substantiate it.
