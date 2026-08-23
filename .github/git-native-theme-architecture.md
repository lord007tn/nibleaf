# Git-native theme repositories

Status: accepted for repository contract v1 with independently runnable Harbor, Manuscript, and Signal implementations.

## Decision

Nibleaf exports a normal Vite application, not a JSON theme blob and not a checkout that depends on the Nibleaf monorepo. Repository contract v1 selects the project's Harbor, Manuscript, or Signal preset and exports a self-contained implementation with:

- editable React components, layout CSS, assets, a content adapter, and tests;
- Vite 8, React Compiler, TypeScript 7, ParaglideJS, Lucide, and typed `t3-env` validation;
- a vendored, versioned runtime contract so `pnpm install` never resolves `workspace:*` dependencies;
- generated project data under `.nibleaf/`, separate from customer code under `src/theme/`, `src/adapters/`, and `public/`;
- `nibleaf.theme.json` as the machine-readable ownership and compatibility boundary;
- the existing `GitConnection` / `GitFileState` common-base ledger as the only sync state.

The vendored runtime is intentional for contract v1. Publishing `@nibleaf/theme-sdk` becomes a later compatible transport for the same types; it is not a prerequisite for local development and cannot make an export uninstallable because a package is unpublished.

## Evidence from the repository audit

### JoodCMS patterns worth retaining

| Concern | Source evidence | What Nibleaf retains |
| --- | --- | --- |
| Runnable themes | `apps/theme-default-agency-b2c/package.json` and the three sibling apps expose normal `dev`, `build`, `preview`, and deploy commands. | Each export is an ordinary application with source, scripts, and environment documentation. |
| Runtime CMS boundary | `apps/theme-default-agency-b2c/server/middleware/01.website.ts` resolves request-time tenant data; `server/query/website.ts` owns the CMS API/cache boundary; `app/composables/useWebsite.ts` exposes the resolved model. | A typed `ContentAdapter` separates rendered components from snapshot or future API loading. |
| Engine and registry | `packages/themes/engine` defines typed schemas/properties; `packages/themes/registry` composes independently registered templates; app-local `app/themes/utils/block-resolver.ts` maps IDs to real lazy components. | Keep a small versioned contract and independent template implementations. Share contract primitives, not whole layouts. |
| Cloudflare deployment | Theme apps have their own `wrangler.jsonc`, Worker entry, compatibility date, and assets directory; backend-created custom hostnames keep routing outside theme code. | Deployment adapters remain outside the customer theme contract. Exported code is host-portable; a later official Cloudflare adapter can be additive. |
| Local configuration | Theme `nuxt.config.ts` supplies local API defaults and runtime configuration. | Fixture/snapshot is the zero-secret default; optional remote configuration is typed. |

The coupling not retained is visible in each JoodCMS theme app's `package.json`: theme apps consume several private `workspace:*` packages such as the Nuxt layer, design system, shared helpers, analytics, and observability. That works inside a monorepo but fails the customer clone/install requirement. Nibleaf therefore vendors the small runtime seam and uses public ecosystem packages only.

### Existing Nibleaf foundations

| Concern | Source evidence | Consequence |
| --- | --- | --- |
| Structural themes | `packages/shared/src/themes.ts` defines schema v1, Harbor/Manuscript/Signal presets, tokens, component variants, contrast checks, canonical serialization, and theme-owned config projection. | The repository manifest references a template/version; it does not replace the existing product theme config. |
| Runtime provider | `apps/app/src/components/site/documentation-theme-provider.tsx` and `apps/app/src/lib/site-theme.ts` resolve preset structure and safe CSS variables for preview/public rendering. | Exported template code must remain independently editable rather than importing this dashboard implementation. |
| Public data contract | `packages/shared/src/site.ts` defines `SiteSnapshot` and `buildSnapshot`; deployment/export/preview paths already consume it. | `.nibleaf/snapshot.json` is the first local adapter input and contains public render data, not credentials. |
| Git reconciliation | `apps/server/src/actions/git/reconcile.ts` performs pure base/ours/theirs reconciliation; `workflow.ts` persists conflict snapshots and updates `GitFileState` only after a conflict-free result. | Add ownership to each file state and layer policy on the same three inputs. Do not create a second sync engine. |
| Git provider seam | `apps/server/src/actions/git/types.ts` isolates repository operations; `github.ts` bounds recursive trees, blob size/count, concurrency, and compare-and-swap branch updates. | Theme files use a bounded allowlisted repository surface and inherit the same race protection. |
| Localization/tooling | `apps/app/vite.config.ts` already uses Paraglide, Vite 8, React Compiler, and t3-env; root packages use TypeScript 7. | Exported repositories use the same supported toolchain without private packages. |
| Export pipeline | `apps/server/src/actions/export.ts` already creates deterministic zip entries; `apps/worker/src/exports` builds immutable published artifacts. | The vertical slice adds a direct repository zip; scheduled/background repository artifacts can follow after the contract stabilizes. |
| Deployment constraint | `.github/workflows/docker.yml` is `workflow_dispatch` only. | Theme work must not add a `pull_request` Docker build. |

No design-system shadcn source component is part of this change. All exported template source is standalone and lives outside `packages/design-system/src/components`.

## Repository contract v1

```text
.
├── nibleaf.theme.json          # PLATFORM: version, hashes, ownership
├── .nibleaf/
│   ├── snapshot.json           # PLATFORM: generated public project data
│   ├── content-map.json        # PLATFORM: page IDs to editable MDX paths
│   └── README.md               # PLATFORM
├── content/**/*.mdx            # SHARED: three-way Nibleaf/Git authoring
├── src/
│   ├── nibleaf/runtime.ts      # CUSTOMER after scaffold; vendored contract entry
│   ├── adapters/content.ts     # CUSTOMER: replaceable data boundary
│   └── theme/                  # CUSTOMER: components, tests, and CSS
├── messages/                   # CUSTOMER: Paraglide messages
├── public/                     # CUSTOMER: assets
├── vite.config.ts              # CUSTOMER
└── package.json                # CUSTOMER, public dependencies only
```

The manifest carries two versions:

- `schemaVersion` versions manifest parsing and ownership semantics.
- `runtime.contractVersion` versions the snapshot-to-component API.

Template identity is independently versioned as `template.id = harbor | manuscript | signal` and `template.version = 1`. A template redesign does not silently change the runtime contract.

### Ownership

| Owner | Paths | Push behavior | Pull/import behavior |
| --- | --- | --- | --- |
| PLATFORM | `.nibleaf/**`, `nibleaf.theme.json` | Regenerate from the current Nibleaf snapshot. | Validate manifest/version/hash. A Git edit becomes a conflict; it is never interpreted as customer code or silently written into project data. |
| SHARED | configured content root `/**/*.mdx` | Three-way reconcile from the recorded common base. | Import conflict-free Git-only changes. Competing edits persist base/ours/theirs and require an explicit resolution. |
| CUSTOMER | `src/**`, adapters, assets, translations, and ordinary app configuration | Seed only when the path has no recorded base and is absent in Git. Never upgrade in place. | Git is authoritative, including deletion. Nibleaf may validate syntax/contract compatibility but never overwrites the file. |
| UNMANAGED | everything outside the manifest sync surface | Ignore. | Ignore. |

`GitFileState.ownership` records this decision next to `baseContent`, `baseExists`, page linkage, and remote blob metadata. Existing rows migrate to `SHARED`, preserving current MDX semantics.

## Reconciliation and conflicts

1. Fetch only bounded files in the declared theme/content surface.
2. Compose Nibleaf's current shared MDX and generated platform files.
3. For customer files with a recorded state, use the recorded base as “ours”; this prevents a newer Nibleaf scaffold from masquerading as a customer edit.
4. Reconcile each path:
   - `SHARED`: existing base/ours/theirs rules;
   - `CUSTOMER`: seed once, then choose Git (including deletion);
   - `PLATFORM`: choose a new Nibleaf generation only when Git still equals the base; otherwise create a conflict.
5. Apply only `SHARED` results to page records. Platform/customer files never pass through the MDX importer.
6. Persist a new common base only after the whole operation is conflict-free. Existing stale-resolution detection still invalidates a choice when any input changed.
7. Push with the existing GitHub compare-and-swap ref update. If the branch moved, refetch and reconcile.

Conflict resolution for a generated file should normally choose Nibleaf (“ours”). Choosing custom content is intentionally unavailable for platform-owned paths in the planned UI hardening phase; the v1 engine already prevents automatic import.

## Migration policy

Contract migrations are explicit and non-destructive:

- A parser supports known manifest/runtime versions and rejects unknown future versions.
- Nibleaf can regenerate `PLATFORM` files for a compatible contract.
- Customer-owned files are never rewritten by a migration. A codemod is delivered as a Git branch/PR that the customer reviews.
- A template major change is a new template version or a newly exported repository, not an implicit overwrite.
- The `GitFileState` base is advanced only after a migration commit succeeds, so retries remain idempotent.
- Rollback is a Git revert plus selection of the prior supported manifest/runtime version; Nibleaf project data remains outside customer code.

## Local development and security

Every exported repository has one setup command:

```bash
corepack pnpm install && corepack pnpm dev
```

The default adapter validates `.nibleaf/snapshot.json`, then overlays page bodies from exported MDX through `.nibleaf/content-map.json`; customer MDX edits therefore drive the local application without making generated state customer-owned. `.env` is optional. `src/env.ts` validates any future remote URL with t3-env and Zod. The snapshot uses the existing public `SiteSnapshot` projection, so provider tokens, Git credentials, webhook secrets, organization internals, and unpublished private payloads are not exported.

Import validation is fail-closed before connection state is persisted and on every later pull for unknown contract/template versions, a manifest that does not match the project's selected template, and modified platform files. Provider enumeration keeps the existing tree truncation, per-file size, file-count, cumulative 64 MiB, known-size, and bounded-concurrency limits. Unknown repository files are not fetched. Content paths reversibly encode unsafe characters and export rejects duplicate case-insensitive output paths before creating an archive.

Visible runtime chrome is loaded from `messages/en.json` and `messages/ar.json` through generated Paraglide message functions. Selecting an Arabic page switches those messages, the template root direction, and the document `lang`/`dir`. Search, external-link, book, and terminal imagery uses Lucide components rather than Unicode icon glyphs.

## Template isolation

Each template owns a separate entry component, test, and stylesheet:

- Harbor is a persistent reference shell with library navigation, reading column, and page outline.
- Manuscript is an editorial shell with a horizontal chapter deck, paper canvas, and focused long-form measure.
- Signal is a console shell with a technical rail, command index, and wide code-oriented canvas.

The only shared customer-side theme utility filters renderable pages, maps supported chrome locales, and synchronizes document language/direction. Manifest parsing, snapshot validation, path safety, and adapter interfaces are also shared. Navigation layout, typography, spacing, component structure, and CSS remain independent.

## Phased delivery

### Phase 1 — contract and three-template runnable export (this change)

- Add manifest/runtime contract v1 and ownership classifier.
- Export the selected Harbor, Manuscript, or Signal repository from `GET /api/app/projects/:id/theme-repository`.
- Include snapshot fixtures, real source, extension documentation, and build/test scripts.
- Consume Paraglide messages in visible chrome, synchronize Arabic `lang`/`dir`, and use Lucide for UI icons.
- Extend `GitFileState` ownership and GitHub's bounded file enumeration.
- Add ownership-aware reconciliation without replacing existing conflict records.
- Prove independent install/test/build, edit/rebuild, RTL rendering, and safe platform-file rejection for all three templates.

### Phase 2 — Git UX and migration tooling

- Expose repository bootstrap/contract state in the connection UI.
- Add ownership badges and disallow unsafe custom resolution for platform paths.
- Add signed migration plans/codemods and PR-based upgrades.
- Add durable export artifacts to the background export pipeline.

### Phase 3 — template evolution

- Version future structural redesigns per template without changing customer files in place.
- Deliver optional upgrades as reviewed migration branches/PRs.
- Expand accessibility and visual-regression coverage as template surfaces grow.

### Phase 4 — official SDK and deployment adapters

- Publish the stabilized runtime contract as an official versioned SDK while retaining vendored exports for offline durability.
- Add official Cloudflare and other host adapters without placing deployment credentials in the repository contract.

## Tradeoffs and rejected options

- **Vendored runtime now vs. unpublished SDK now:** vendoring makes the clone runnable today and freezes the contract with the repo. It duplicates a small file; a later SDK can remove that duplication after publication and compatibility policy exist.
- **Snapshot adapter vs. production API by default:** snapshot data is deterministic and secret-free. It is not real-time; a future remote adapter is opt-in and must use a supported SDK.
- **Seed-once customer code vs. automatic template upgrades:** seed-once guarantees ownership. Automatic upgrades look convenient but can overwrite manual work; reviewed migration PRs are safer.
- **One ownership-aware ledger vs. a theme sync table:** extending `GitFileState` keeps idempotency, stale-resolution protection, audits, and compare-and-swap behavior in one system.
- **Three real templates vs. preset-colored wrappers:** each preset exports its own component and CSS structure. This costs more implementation and visual coverage, but preserves the product's structural theme promise and keeps customer edits local to the selected template.

## Acceptance evidence required before expansion

- Archive contains no `workspace:*` dependency and no secret material.
- Harbor, Manuscript, and Signal repos each install with supported pnpm, run localized tests, typecheck, and build.
- Vite serves every fixture repository without Nibleaf services or production secrets.
- Screenshots show all three structurally distinct runtimes plus Arabic/RTL mobile chrome.
- A change to each template-owned component survives a rebuild and ownership reconciliation.
- A customer MDX edit appears in rebuilt browser output while generated manifest, snapshot, and content-map hashes remain unchanged.
- A change to `.nibleaf/snapshot.json` is rejected/conflicted.
- Shared MDX reconciliation tests remain green.
- `.github/workflows/docker.yml` remains manual-only for Docker image builds.
