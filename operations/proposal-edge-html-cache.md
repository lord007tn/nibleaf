# Proposal (parked): shared edge caching of published docs HTML

**Status:** parked. It is design only, and nothing is built.
- The deploy-outage P0 is solved without it, by rolling deploys plus the maintenance page.
- This proposal keeps the performance win from READER-04 (TTFB on public docs is 0.65–1.1 s today) and better outage coverage, for a later project.
- Two adversarial reviews rejected earlier versions:
  - v1 had no revocation during outages, and its tenant binding was weak.
  - v2 relied on eventually consistent Workers KV, and stale writers could restore a revoked permission.

This v3 answers both.

## 1. Goal and non-negotiables
**Goal:** serve public published-docs HTML from the custom-domain Worker. Hits stay under 100 ms, and a stale copy may be served while the origin fails, without weakening privacy.

**Never:**
- cache a WORKSPACE, READERS (including JWT), taken-down, legacy `config.visibility=private`, or unpublished page;
- cache any reader-specific variant;
- serve one tenant's entry to another host;
- serve anything after a takedown or an access-mode downgrade has been **acknowledged**, even while the origin is down.

## 2. What the HTML depends on (verified in code, 2026-11-11)
**Inputs to the HTML:**
- **Effective host**, proven by the edge secret. It selects the project and becomes `x-nibleaf-site-origin` (canonical, og and hreflang URLs).
- **Path**, including the version segment and `.md` aliases.
- **`?lang`**.
- **Accept**, in html, markdown or 406 buckets.
- **User-Agent**: a bot gets a complete render, a human gets a streamed one. The fix is to use the complete render for every request.
- **`?ask`**, which goes into dehydrated state.
- **The footer year**, which reads the clock.
- **For PUBLIC sites, no credentials:** `resolveViewerAccess` returns early.

**Live overlay on top of the immutable deployment** (`apps/server/src/actions/sites.ts`):
- name and **description**;
- icon and config (branding, navbar, footer, banner, analytics, variables, seo);
- language enablement and order, and translations;
- the add-on and entitlement projection, **including entitlements that take effect or expire on a schedule** (`packages/shared/src/addons.ts:254–265`);
- **AI capability readiness** (`sites.ts:566`, `lib/ai-search/runtime.ts:108–127`);
- the **primary-host role** (`sites.ts:460`).

**Per-request noise that must go:**
- the CSP nonce (the csp-nonce meta, `nonce=` attributes, ScriptOnce) in favour of per-response script hashes;
- the consent-deferred GA inline init (`site-analytics-consent.tsx`), which moves to an external module;
- dehydrated `updatedAt` timestamps.

## 3. Design v3

### 3.1 Authority: one Durable Object per site, the only source of serve permission
- **What it is.** A `SiteDelivery` Durable Object keyed by projectId. Durable Objects are single-threaded and strongly consistent per id. It stores:
  - `revision` (monotonic);
  - `servable`;
  - `deploymentId`;
  - `liveHash`;
  - `hosts`: a host → `{ role: primary|secondary|subdomain, assignmentGeneration }` map;
  - `contentYear`.
- **How the Worker asks.** Before **any** cached serve, fresh or stale, the Worker asks the object for a **lease**: `{ revision, servable, deploymentId, liveHash, hostRole, assignmentGeneration, leaseExpiresAt = now + 10 s }`.
  - It may cache that lease in the isolate until `leaseExpiresAt` and never beyond.
  - If the object is unreachable, or the lease has expired: **fail closed**. That means origin only, or the maintenance page.
- **What gets served.** An entry is served only if its `(projectId, deploymentId, liveHash, assignmentGeneration)` equals the lease, and the request host is in the lease with that generation.
- **Revocation bound.** It is at most **10 s** (the lease TTL) from the object's write, with no eventual-consistency gap.

### 3.2 Ordered, durable mutation delivery
- **`project.deliveryRevision`** (`BIGINT`): incremented in the **same transaction** as every mutation that can change a render or its permission (§3.3).
- **Transactional outbox.** Each mutation writes a `delivery_outbox(projectId, revision, createdAt)` row in the same transaction.
- **Delivery.**
  - A worker job reads the latest state, stamps it with that revision, and POSTs it to the Worker's control endpoint.
  - The control endpoint (`edge-control.nibleaf.com`, HMAC-authenticated with a key separate from the edge secret, and replay-protected) forwards it to the object.
  - The object **rejects anything older than or equal to its stored revision**: compare-and-set on a monotonic counter.
  - A reconciler that read stale data therefore can never restore a revoked permission. Its revision is older.
- **Revocations wait for acknowledgement.** A takedown, an access-mode downgrade, a domain removal or a host reassignment calls the control endpoint **synchronously** and reports success only after the object acknowledges. If the acknowledgement fails, the admin or owner action still commits, which is required for abuse response, but it reports "edge revocation pending, retrying". The outbox retries with backoff and alerts.
- **Remaining exposure.** Only if the origin goes down after the database commit but before the first acknowledgement. Even then the 10 s lease, followed by fail-closed, bounds it.
- **Deletion and erasure** write a tombstone revision (`servable=false`, empty hosts) that reconciliation never overwrites with a positive state. Snapshots are purged as part of erasure (§3.5).

### 3.3 Mutation coverage (integration inventory to hook)

| Mutation | Code path |
| --- | --- |
| Publish READY, a READY retry, rollback activation | `apps/worker/src/processors/publish.ts` (≈ 368, 434, 484), `apps/server/src/actions/deployments.ts` (≈ 545) |
| Access mode | `apps/server/src/actions/reader-access.ts` (≈ 253) |
| Takedown and restore | `apps/server/src/actions/admin.ts` (≈ 837, 847) |
| Slug and live config branches | `apps/server/src/actions/projects.ts` (≈ 237, 244) |
| Domain add, verify (including primary demotion on the failure paths), primary change, delete | `apps/server/src/actions/domains.ts` (≈ 307, 388, 408, 449, 475) |
| Project deletion and tenant erasure | `packages/auth/src/tenant-erasure.ts` (≈ 57), plus every caller |
| Org merge **and restore** (raw writes; fan out to affected projects) | `apps/server/src/scripts/org-merge.ts` (≈ 244, 267, 655, 761) |
| Languages, translations, add-ons and entitlements | their actions, plus a **scheduler** that bumps the revision at every entitlement's effective and expiry time |
| AI readiness changes | the index-run completion and runtime-config change |

Ownership transfer only changes membership roles and needs no bump. CI asserts the inventory: a test enumerates the Prisma models and fields that feed the render and fails when a writer of those fields doesn't call `bumpDelivery()`.

### 3.4 Origin: shareable render
The design reviewed in v1/v2 still applies:
- **Eligibility:** edge requests on rewritten site paths only. Never `/sites/*`, `/_*`, `/api/*` or `/__nibleaf_edge/*`.
- **The render itself:**
  - anonymous;
  - complete;
  - hash CSP;
  - external GA init;
  - zeroed timestamps;
  - the footer year frozen to `contentYear` from the delivery state.
- **Guard:** one delivery token per render, `(revision, deploymentId, liveHash)`, read before rendering, carried by every SSR API response and re-read after rendering. Any mismatch, or any non-public or non-2xx response, downgrades the result to `private, no-store`.
- **Validator:** a weak `ETag` over `(schema, appRevision, projectId, host, assignmentGeneration, repr, canonical path, lang, deploymentId, liveHash)`. A cheap 304 is computed from the delivery state.
- **HEAD:** never fills the cache.
- **Headers:** stored and outgoing headers are kept separate, and every outgoing response gets an explicit downstream policy, including misses and 304s.

### 3.5 Storage
- **L1: the Cache API.** Per colo and ephemeral. Keys are per host:
  `https://<host>/__nibleaf_edge/v3/doc/<repr>/<path>?lang=<l>`
  The metadata carries projectId, deploymentId, liveHash, assignmentGeneration, revision and validatedAt.
- **L2: R2 `nibleaf-edge-snapshots`**, private, served only through the §3.1 gate:
  - **Key:** `doc/<projectId>/<assignmentGeneration>/<host>/<repr>/<path>?lang=<l>/<deploymentId>.<liveHash>.<appRevision>`. The key is complete, so a stale writer can't collide with a current one.
  - **Eligibility:** enforced in code as `validatedAt ≥ now − 24 h`. Lifecycle deletion is asynchronous, so it is never relied on for eligibility.
  - **Freshness:** snapshots of unchanged sites are **renewed** on each successful revalidation (a metadata touch), so they don't expire away.
  - **Erasure:** deletes the `doc/<projectId>/` prefix.
- **App assets:** the shared, content-addressed `/assets` cache from #433, plus an R2 archive written once, so chunks referenced by old HTML outlive deploys.
- **Coalescing and load.** Coalescing inside one isolate is only a local optimisation. Global load is bounded by a per-colo cap on concurrent fills, and by origin-side request admission for shareable renders.

### 3.6 Rollout and infrastructure
**Modes:** `off` (the default), `stale-only`, then `on`. Each step needs the owner's approval.

**New infrastructure:**
- the Durable Object namespace on the Worker;
- the `edge-control.nibleaf.com` route;
- the R2 bucket and a token scoped to it;
- an HMAC control key in server and worker.

The release gate in `.github/custom-domain-edge-release.md` already refuses any accidental enablement.

## 4. Test plan (required before any rollout)
- **Privacy matrix:** WORKSPACE, READERS, JWT, taken-down, legacy-private and unpublished sites, a missing secret, `?ask`, and `/sites/<other>` on a host. None of them produces a shareable response or an entry.
- **Downgrade:** PUBLIC to private mid-render downgrades the response. The next lease refuses the cached entry within 10 s, in both modes.
- **Takedown during an outage** (control endpoint acknowledged, origin down) means no stale serve.
- **Stale writer:** a reconciler holding an old revision can't re-enable a site.
- **Host reassignment** from A to B: A's entries are never served on B, and B's are never served before its new generation.
- **Entitlement expiry** with no mutation still changes the delivery revision.
- **HEAD-first then GET**, encodings, and headers on hit, stale and miss.

Tracking issue: https://github.com/lord007tn/nibleaf/issues/438
