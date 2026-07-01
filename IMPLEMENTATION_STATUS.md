# Midad Implementation Status

Last updated: 2026-07-01

## Target

Midad is tracking the practical feature set of Mintlify's free documentation
product, but as a self-hostable app:

- docs dashboard, editor, publish pipeline, activity, analytics, and settings
- project subdomains and custom domains
- git-style branch workflow plus public GitHub/GitLab Markdown import
- multilingual documentation
- Docker Compose / Coolify deployment without the marketing site

Out of scope for parity: agents, AI products, MCP products, and advanced hosted
search integrations.

## Mintlify Free-Version Study

Observed with Chrome on the `private-product/private-product` Mintlify workspace:

- Dashboard shows project status, preview, live custom domain, activity, deploy
  history, and an editor entry point.
- Site settings include Domain setup, Authentication, Add-ons, General, Search,
  Git settings, API keys, Members, Billing, Usage, Notifications, My profile,
  Exports, and Danger zone.
- General settings include project name and deployment name.
- Authentication on the free project is public docs access.
- Git settings offer GitHub and GitLab connection flows.
- Add-ons include feedback widgets, edit suggestions, issue links, CI checks,
  preview deployments, and noindex visibility controls.
- Search settings expose result-count configuration.
- Exports are shown as Enterprise-only.

## Implemented

- Dashboard/editor shell, project settings, per-site members, API keys, analytics,
  page tree editing, publish modal with pending-change diff, deployment pipeline,
  changelog, rollback, and published-site rendering.
- Custom domains with add/list/verify/remove/primary APIs, TXT ownership checks,
  persistent DNS instruction records, copy-ready DNS rows, stricter hostname
  validation, and custom-domain root serving through the app server.
- Custom-domain navigation keeps reader URLs at the domain root instead of
  leaking the internal `/sites/:projectId` route.
- Custom-domain primary selection in project settings.
- Custom-domain primary selection is enforced server-side: a domain must be
  verified before it can become primary.
- Configurable custom-domain CNAME target via `CUSTOM_DOMAIN_CNAME_TARGET`.
- Free project subdomains through `SITE_BASE_DOMAIN`; requests to
  `<project-slug>.<SITE_BASE_DOMAIN>` resolve to the published project without a
  redirect.
- Editable deployment names in General settings. The deployment name is the
  project's free subdomain slug, is DNS-label validated, and is globally unique
  at the database layer so wildcard subdomain routing is deterministic.
- Project overview live-domain and recent deployment activity panel.
- Project overview "View site" and live-domain links open the configured
  custom/free subdomain host when available, with the internal `/sites/:id`
  route only as a fallback.
- API key settings UI for create/copy/revoke using the existing scoped key API.
- Danger-zone project deletion and ownership transfer to another accepted
  project member. Ownership transfer promotes the target member and demotes the
  current owner to admin atomically.
- Usage settings for local site counts, languages, members, custom domains,
  deployments, and 30-day built-in analytics.
- Exports settings surface that mirrors Mintlify free behavior: visible but
  Enterprise-only, with PDF/static export jobs intentionally unavailable in the
  free self-hosted build.
- Integrations settings are present for parity, but the self-hosted build keeps
  external Slack/Discord/Zapier/GitHub/GitLab integration cards read-only until
  backing workers are implemented; Git repository imports live in the dedicated
  Git settings tab.
- Add-ons settings for feedback, edit suggestions, issue links, CI checks,
  broken-link checks, grammar linting, preview deployments, and search indexing.
  Search indexing reuses the existing live `seo.allowIndex` behavior.
- Published-site add-ons for reader feedback, edit links, and issue links.
  Feedback is stored as public analytics events; edit/issue actions use
  configurable URL templates with `{path}`, `{encodedPath}`, and `{url}` tokens.
- Published-site external analytics for configured GA4 and Plausible IDs. When
  cookie consent is disabled, validated third-party scripts are emitted in the
  SSR head; when consent is enabled, scripts are withheld until the reader
  accepts the localized consent prompt.
- Publish-time add-on checks: when CI checks and broken-link checks are enabled,
  the worker blocks deployments with broken internal docs links.
- Publish-time grammar linting: when CI checks and the grammar linter are
  enabled, the worker blocks common documentation typos while ignoring code
  blocks and inline code.
- Authentication settings for public/private docs access, backed by the existing
  live-site visibility gate.
- Git-style DB branches with create/fork/merge/delete and versioned published
  snapshots.
- Published branch/version snapshots use unique URL slugs even when branch names
  normalize to the same slug, and public version filtering prefers exact branch
  version IDs so pages from colliding branches are not mixed.
- One-way public GitHub, GitLab, and generic http(s) Git Markdown/MDX import.
  Imports can target the default branch/language or a selected Midad
  branch/language. Saved Git import settings hydrate correctly after an async
  settings load.
- Page creation, listing, moving, and reordering validate branch/language scope
  server-side, so Git-style branches and multilingual trees cannot be crossed by
  submitting IDs from another project, branch, or language.
- Page moves and batched reorders reject self/descendant parent cycles and
  duplicate reorder entries before materialized paths are recomputed.
- Multilingual docs with language CRUD, RTL/LTR direction, language-specific
  page trees, fallback, language switcher, and hreflang alternates. The server
  enforces that a project cannot directly unset its current default language;
  another language must be promoted instead.
- The published-site language switcher uses each page's translated alternate
  path when a `translationKey` sibling exists, so switching languages can move
  from `/introduction` to `/ar/introduction`-style translated slugs instead of
  only changing `?lang=`.
- Published-site version switching uses domain-aware site URLs, so switching
  versions on a custom/free subdomain stays at the domain root instead of
  navigating to the internal `/sites/:projectId` route.
- Authenticated draft preview route for branches/languages before publish, gated
  by the Add-ons preview deployments toggle.
- Self-host Docker image and Compose stack for local/standard deployment.
- Coolify-specific Compose stack in `docker-compose.coolify.yml` that excludes
  the marketing app and exposes only the docs platform services.
- Self-hosting docs for Coolify and Cloudflare DNS, including app service host
  bindings, wildcard project subdomains, custom-domain CNAME/TXT verification,
  apex-domain handling, and the Coolify-specific environment variable names.
- Production deployment docs and Compose config document the browser-reachable
  storage endpoint required for presigned upload/download URLs, and the
  Dockerfile now honors `--build-arg VITE_API_URL=...` for non-Compose
  topologies while standard Compose bakes the internal `server:4311` URL.
- Standard Docker Compose storage settings are overridable for R2/S3-compatible
  production deployments while keeping maxio as the default local bundled
  object store.
- Coolify Compose storage settings are also overridable for R2/S3-compatible
  deployments while keeping bundled maxio as the default.
- Standard and Coolify app containers no longer gate server/worker startup on
  bundled maxio health; bucket creation and CORS remain best-effort on API boot,
  so external object-storage deployments can start without local maxio.
- The per-site Plan and workspace Billing surfaces reflect the self-hosted free
  target: there are no visible hosted Pro/Team tiers, upgrade/cancel actions, or
  billing-portal controls in the self-hosted build.
- Coolify deployment config now follows the working Keenpix-style pattern:
  Coolify-generated service URLs, users, passwords, and hex secrets feed the
  source Docker build and runtime environment; bundled datastores stay private;
  optional resource caps are exposed; and the repo includes a Docker image build
  workflow for `main` and release tags.

## Partial / Deliberate Limits

- Git integration is currently one-way import from public GitHub, GitLab, or
  generic http(s) Git repositories. There is no OAuth/private-repo sync, webhook
  sync, or two-way push yet.
- Multilingual authoring is manual/structural. There is no automatic translation
  workflow.
- TLS certificates and wildcard/custom-domain ingress are handled by Coolify or
  the operator's reverse proxy. The app resolves hosts and serves content once
  traffic reaches it.
- Export-to-PDF remains out of scope for the free self-hostable target.
- Advanced hosted search providers are not prioritized; built-in published-site
  search is implemented, including configurable result count.
- The preview deployments add-on is implemented as an authenticated live draft
  preview route, not as immutable public/shareable preview deployment artifacts.

## Deployment Notes

For Coolify:

- Use `docker-compose.coolify.yml`.
- Point the dashboard/docs domain and wildcard docs domain at the `app` service
  on port `4310`.
- Set `SITE_BASE_DOMAIN`, for example `docs.example.com`.
- Create wildcard DNS for `*.docs.example.com` to the Coolify app ingress.
- Set `CUSTOM_DOMAIN_CNAME_TARGET` to the host customers should CNAME to, for
  example `cname.docs.example.com`.
- Add a DNS record for that CNAME target to the same Coolify app ingress.

## Verification

Completed on 2026-06-30:

- `pnpm typecheck`.
- `docker compose -f docker-compose.coolify.yml config` with sample env values.
- `pnpm --filter @midad/shared test`.
- `pnpm --filter @midad/validators test`.
- `pnpm exec biome check` on the files changed for this status pass.
- Local dev stack dogfood with seeded demo data:
  - `pnpm exec dotenv -e .env -- pnpm db:deploy`.
  - `pnpm exec dotenv -e .env -- pnpm db:seed`.
  - `pnpm dev` with Postgres, Dragonfly, and maxio already running.
  - Chrome rendered the authenticated project overview, domain settings, API key
    settings, search settings, and published docs site.
  - Public resolver returned the seeded project for `docs.midad.app` when
    `SITE_BASE_DOMAIN=midad.app` was injected.
  - Public resolver returned the seeded project for a local verified custom
    domain row `docs.raedbahri.test`, including a `:443` host header.
  - Public resolver returned `null` for nested and unrelated subdomain hosts.
- Chrome rendered the Git settings provider form with GitHub and GitLab
  options, including GitLab instance URL and group/project fields.
- Playwright rendered the Add-ons settings section and successfully saved an
  add-on toggle through the authenticated local app.
- Playwright rendered the Authentication settings section and successfully saved
  the current docs access mode through the authenticated local app.
- Playwright rendered published-site feedback/edit/issue add-ons from a seeded
  snapshot, clicked reader feedback, and verified a `feedback` analytics event
  was recorded.
- Worker publish checks were exercised directly with valid internal docs links
  and a failing broken-link case.
- Worker grammar linting was exercised directly with valid docs, a failing typo
  case, and typo text inside code blocks to confirm code is ignored.
- Live public GitLab import was dogfooded against
  `raytio/documentation/api-docs` on GitLab (`master` branch): 8 Markdown files
  imported, 0 skipped, and imported pages were verified in the local database.
- Generic public Git URL import was dogfooded against
  `https://gitlab.com/raytio/documentation/api-docs.git` using the local Git
  CLI path: 8 Markdown files imported into a selected Midad branch and Arabic
  language, and imported pages were verified in the local database before the
  throwaway project was cleaned up.
- Playwright rendered the Git settings tab with GitHub, GitLab, and Public Git
  URL provider choices, clone URL input, and branch/language import target
  selectors, with no console errors or warnings.
- Playwright rendered the authenticated draft preview route with the draft
  page tree and selected document content, with no console errors.

Completed on 2026-07-01:

- `pnpm --filter @midad/validators test`.
- `pnpm --filter @midad/server typecheck`.
- `pnpm --filter @midad/app typecheck`.
- Direct server dogfood for deployment-name/subdomain behavior:
  - Creating two projects with the same name produced unique slugs
    (`temporary-docs`, `temporary-docs-2`).
  - Creating a project with a long name produced a DNS-safe 63-character slug.
  - Updating a project's deployment name persisted the new slug.
  - Updating another project to that same slug was rejected with a conflict.
  - The public host resolver returned the project for
    `<updated-slug>.dogfood.test:443`.
- Playwright rendered the authenticated Usage settings tab with local usage
  counts and 30-day top-page analytics.
- Playwright rendered the authenticated Exports settings tab as an
  Enterprise-only surface, with no console errors beyond the React DevTools
  development info line.
- `pnpm --filter @midad/docs typecheck`.
- `docker compose -f docker-compose.coolify.yml config` with sample Coolify
  production values for dashboard, wildcard docs, custom-domain CNAME target,
  storage, auth, Postgres, and CORS origins.
- Multi-agent self-review of the self-hosting docs found Coolify env/routing,
  TXT verification, and Cloudflare DNS/TLS documentation gaps; those gaps were
  addressed in the self-hosting and publishing docs.
- Direct server dogfood for Danger-zone ownership transfer:
  - Created a throwaway project with owner and target member.
  - Transferred ownership atomically; the original owner became admin and the
    target member became owner.
  - Verified self-transfer is rejected.
  - Confirmed no throwaway transfer users/projects remained in the database.
- Custom-domain DNS setup verification:
  - `pnpm exec biome check --write apps/server/src/actions/domains.ts
    packages/validators/src/index.ts packages/validators/src/schema.test.ts
    apps/app/src/components/project-settings/domain-section.tsx
    apps/app/src/lib/i18n/messages.ts`.
  - `pnpm --filter @midad/validators test`.
  - `pnpm --filter @midad/server typecheck`.
  - `pnpm --filter @midad/app typecheck`.
  - Direct server dogfood created a throwaway project/domain, confirmed
    `addDomain` and refetched `listDomains` both return `CNAME` and `TXT`
    setup records, confirmed hostname normalization, rejected invalid DNS
    labels and wildcard input, and cleaned up the throwaway organization.
- Multi-agent parity/readiness follow-up:
  - Git settings async hydration issue fixed so saved provider, repo/clone URL,
    branch/path, and import target fields render after settings load.
  - Plan tab custom-domain copy moved from placeholder Pro to Free to match the
    implemented free/self-hosted domain feature.
  - Overview live-site links now target the custom/free subdomain host shown in
    the dashboard.
  - `Dockerfile` build-arg handling, `docker-compose.yml` build args, production
    storage endpoint docs, and stale maxio credential wording were corrected.
  - Verified with `pnpm --filter @midad/app typecheck`,
    `pnpm --filter @midad/docs typecheck`, focused Biome checks, and
    `docker compose -f docker-compose.yml config` with representative
    production domain/storage values.
- Standard Compose object-storage override verification:
  - `docker compose -f docker-compose.yml config` confirmed the default maxio
    topology still resolves.
  - The same config command with R2-style environment overrides confirmed
    `STORAGE_PROVIDER`, `STORAGE_ENDPOINT`, `STORAGE_PUBLIC_ENDPOINT`,
    `STORAGE_PUBLIC_URL`, `STORAGE_BUCKET`, credentials, path style, and storage
    CORS origins flow into the app/server/worker containers.
- Coolify object-storage override verification:
  - `docker compose -f docker-compose.coolify.yml config` confirmed explicit
    maxio values render into the app/server/worker containers.
  - The same config command with R2-style environment overrides confirmed
    provider, endpoint, public endpoint, public URL, bucket, credentials, path
    style, and storage CORS origins flow into the Coolify app/server/worker
    containers.
- Storage startup dependency verification:
  - Rendered standard and Coolify Compose configs confirmed `server` and
    `worker` depend on Postgres/Dragonfly/migrations but not on `maxio`.
  - `pnpm --filter @midad/docs typecheck` passed after documenting the
    best-effort storage bootstrap behavior.
- Custom-domain primary invariant verification:
  - `pnpm --filter @midad/server typecheck`.
  - `pnpm exec biome check --write apps/server/src/actions/domains.ts`.
  - Direct server dogfood created a throwaway project/domain, confirmed an
    unverified domain is rejected as primary, verified the same domain, then
    confirmed it can become primary before cleanup.
- Multilingual default-language invariant verification:
  - `pnpm --filter @midad/server typecheck`.
  - `pnpm exec biome check --write apps/server/src/actions/languages.ts`.
  - Direct server dogfood created a throwaway project with English and Arabic,
    confirmed the current default cannot be unset directly, promoted Arabic to
    default, and verified exactly one default language remained before cleanup.
- Page branch/language scope verification:
  - `pnpm exec biome check --write apps/server/src/actions/pages.ts`.
  - `pnpm --filter @midad/server typecheck`.
  - Direct server dogfood created two throwaway projects, confirmed page create
    and list reject another project's branch/language IDs, confirmed moving or
    reordering an English page under an Arabic parent is rejected, and verified
    the page kept its original branch/language/parent before cleanup.
- Page cycle and published-version invariant verification:
  - `pnpm exec biome check --write packages/shared/src/site.ts
    packages/shared/src/site.test.ts apps/server/src/actions/sites.ts
    apps/server/src/actions/pages.ts apps/app/src/lib/site-paths.ts
    apps/app/src/routes/sites/$projectId/route.tsx`.
  - `pnpm --filter @midad/shared test`.
  - `pnpm --filter @midad/server typecheck`.
  - `pnpm --filter @midad/app typecheck`.
  - Direct server dogfood rejected page moves/reorders that would place a page
    under itself or a descendant and verified the original tree remained intact.
  - Direct snapshot dogfood confirmed branch names that both normalize to
    `foo-bar` publish as distinct version slugs tied to exact branch IDs.
- Multi-agent follow-up review:
  - Settings parity review found unwired external analytics scripts, connected
    integration metadata without notification behavior, and mixed self-hosted
    free vs. hosted-tier Plan/Billing copy; the external analytics/runtime
    consent gap, read-only integrations behavior, and Plan/Billing copy were
    addressed.
  - Published-site review found the version-switcher internal-route leak,
    branch version-slug collision risk, and translated-page language-switcher
    alternate-path gap; all three were addressed in this pass.
- Translated-page language switcher verification:
  - `pnpm exec biome check --write
    apps/app/src/components/site/page-alternates-context.tsx
    apps/app/src/components/site/site-page-view.tsx
    apps/app/src/routes/sites/$projectId/route.tsx`.
  - `pnpm --filter @midad/app typecheck`.
  - Code inspection confirmed page alternates returned by the public page API
    are published from `SitePageView` to the site chrome, and `changeLanguage`
    uses `siteHref` with the translated alternate path before falling back to
    query-only language switching.
- Published-site analytics consent verification:
  - `pnpm exec biome check --write apps/app/src/lib/site-seo.ts
    apps/app/src/lib/site-seo.test.ts
    apps/app/src/components/site/site-analytics-consent.tsx
    apps/app/src/lib/site-i18n.ts apps/app/src/routes/sites/$projectId/route.tsx`.
  - `pnpm --filter @midad/app test`.
  - `pnpm --filter @midad/app typecheck`.
  - `siteHead` regression tests confirm GA4/Plausible scripts are emitted when
    consent is not required and withheld from the initial head when cookie
    consent is enabled; the published-site chrome now renders a localized
    consent prompt that injects the same validated scripts only after acceptance.
- Self-hosted Plan/Billing copy verification:
  - `pnpm exec biome check --write apps/app/src/components/project-settings/plan-section.tsx
    apps/app/src/components/settings/billing-tab.tsx
    apps/app/src/components/settings/workspace-tab.tsx apps/app/src/lib/i18n/messages.ts
    IMPLEMENTATION_STATUS.md`.
  - `pnpm --filter @midad/app typecheck`.
  - `pnpm --filter @midad/app test`.
  - Code inspection confirmed the per-site Plan tab now renders a single
    self-hosted free plan, the Billing tab has no upgrade/cancel controls, and
    the workspace plan summary no longer exposes a nonfunctional billing portal
    action.
- Self-hosted integrations honesty verification:
  - `pnpm exec biome check --write
    apps/app/src/components/settings/integrations-tab.tsx
    apps/app/src/lib/i18n/messages.ts IMPLEMENTATION_STATUS.md`.
  - `pnpm --filter @midad/app typecheck`.
  - `pnpm --filter @midad/app test`.
  - Code inspection confirmed integrations no longer persist connected-looking
    states or expose connect/save controls in the self-hosted build; existing
    metadata is displayed read-only and users are directed to the Git settings
    tab for public repository imports.

## Pending / External

- GitHub push target is `lord007tn/midad` on branch `main`.
- Coolify repo readiness is implemented; creating the live Coolify app, assigning
  domains, and setting DNS records remain external deployment steps.
- Cloudflare DNS setup remains out of the active work target unless requested.

Known verification caveat:

- Full `pnpm lint` currently fails on broad pre-existing formatting/import
  diagnostics across the dirty worktree; touched files pass focused Biome checks.
- Chrome profile extensions can block direct navigation to some local settings
  URLs or add hydration warnings; authenticated in-app settings screens were
  still verified after a clean dev-server restart.
