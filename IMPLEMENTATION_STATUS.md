# Nibleaf Implementation Status

Last updated: 2026-07-18

## Target

Nibleaf is tracking the practical feature set of Mintlify's free documentation
product, but as a self-hostable app:

- docs dashboard, editor, publish pipeline, activity, analytics, and settings
- project subdomains and custom domains
- git-style branch workflow plus public GitHub/GitLab Markdown import
- multilingual documentation
- Docker Compose / Coolify deployment without the marketing site

Out of scope for parity: agents, AI products, MCP products, and advanced hosted
search integrations.

## Mintlify Free-Version Study

Observed during private product research in a Mintlify workspace:

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
  Imports can target the default branch/language or a selected Nibleaf
  branch/language. Saved Git import settings hydrate correctly after an async
  settings load.
- Signed GitHub/GitLab push webhooks for configured public repositories. A
  verified push to the configured branch re-runs the one-way import and can
  optionally publish automatically; the Git settings surface exposes secret
  rotation and the last synchronization result.
- Ghost JSON import with HTML-to-Markdown conversion, idempotent page updates,
  and language-aware routing. Ghost `en`, `ar`, or other locale tag slugs map to
  project languages through proper `Language` records; imports stop before
  writing when a tagged language is missing, and the UI explains the required
  one-language-tag-per-article convention. Remote Ghost images are validated,
  copied into project object storage, rewritten to stable asset URLs, and reused
  idempotently on repeated imports.
- Localized project name and description use an explicit `ProjectTranslation`
  table with foreign keys to `Project` and `Language` plus a unique
  `(projectId, languageId)` constraint. Legacy values are migrated out of the
  language JSON config.
- Page creation, listing, moving, and reordering validate branch/language scope
  server-side, so Git-style branches and multilingual trees cannot be crossed by
  submitting IDs from another project, branch, or language.
- Page moves and batched reorders reject self/descendant parent cycles and
  duplicate reorder entries before materialized paths are recomputed.
- Multilingual docs with language CRUD, RTL/LTR direction, language-specific
  page trees, fallback, language switcher, and hreflang alternates. The server
  enforces that a project cannot directly unset its current default language;
  another language must be promoted instead.
- Published navigation supports URL-safe virtual categories: flat imported page
  collections can be grouped, ordered, and icon-labelled without re-parenting
  content or breaking existing links. Inactive imported categories start
  collapsed while the active category stays open.
- Page settings expose imported article tags plus sidebar category, icon, and
  order metadata. Saving unrelated settings preserves that taxonomy.
- Article headers show localized reading time, screenshot count, and last-updated
  metadata, while category-aware breadcrumbs link to each section's first guide.
- The visual editor's slash palette includes dedicated callout variants,
  standalone cards and buttons, 2/3/4-card grids, and responsive 2/3/4-column
  layouts, based on the component patterns observed in Mintlify's editor.
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
  and the repo includes Docker image and changelogithub release workflows for
  `main` and release tags.

## Partial / Deliberate Limits

- Git content remains import-based and public-repository-only. Signed push
  webhooks can repeat the import automatically, but private-repository OAuth,
  two-way push, and source-level import rollback are not implemented.
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

## Next Work Queue

1. Normalize every translatable persisted aggregate into an explicit
   `<Entity>Translation` table with a required foreign key to `Language` and a
   unique `(entityId, languageId)` constraint. `ProjectTranslation` is complete;
   next is a carefully staged `PageTranslation` migration. Today's
   `Page.languageId` trees are already language-safe, so the page migration must
   preserve independent localized hierarchy, paths, branches, and
   `translationKey` alternates without duplicating content.
2. Add private-repository OAuth for GitHub/GitLab and source-level rollback for
   imports. The signed push webhook and optional auto-publish path are complete;
   two-way repository writes remain out of scope until conflict semantics are
   designed.
3. Keep Slack, Discord, and Zapier cards as intentional placeholders until
   their delivery workers and credential lifecycle exist.
4. Keep API-key settings hidden until API-key-authenticated content routes are
   implemented and covered by scope/rotation/revocation tests.
5. Split the remaining large frontend chunks by route/editor capability and
   track the resulting bundle budget in CI.

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
- `pnpm --filter @nibleaf/shared test`.
- `pnpm --filter @nibleaf/validators test`.
- `pnpm exec biome check` on the files changed for this status pass.
- Local dev stack dogfood with seeded demo data:
  - `pnpm exec dotenv -e .env -- pnpm db:deploy`.
  - `pnpm exec dotenv -e .env -- pnpm db:seed`.
  - `pnpm dev` with Postgres, Dragonfly, and maxio already running.
  - Chrome rendered the authenticated project overview, domain settings, API key
    settings, search settings, and published docs site.
  - Public resolver returned the seeded project for `docs.nibleaf.test` when
    `SITE_BASE_DOMAIN=nibleaf.test` was injected.
  - Public resolver returned the seeded project for a local verified custom
    domain row `docs.example.test`, including a `:443` host header.
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
  CLI path: 8 Markdown files imported into a selected Nibleaf branch and Arabic
  language, and imported pages were verified in the local database before the
  throwaway project was cleaned up.
- Playwright rendered the Git settings tab with GitHub, GitLab, and Public Git
  URL provider choices, clone URL input, and branch/language import target
  selectors, with no console errors or warnings.
- Playwright rendered the authenticated draft preview route with the draft
  page tree and selected document content, with no console errors.

Completed on 2026-07-01:

- `pnpm --filter @nibleaf/validators test`.
- `pnpm --filter @nibleaf/server typecheck`.
- `pnpm --filter @nibleaf/app typecheck`.
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
- `pnpm --filter @nibleaf/docs typecheck`.
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
  - `pnpm --filter @nibleaf/validators test`.
  - `pnpm --filter @nibleaf/server typecheck`.
  - `pnpm --filter @nibleaf/app typecheck`.
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
  - Verified with `pnpm --filter @nibleaf/app typecheck`,
    `pnpm --filter @nibleaf/docs typecheck`, focused Biome checks, and
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
  - `pnpm --filter @nibleaf/docs typecheck` passed after documenting the
    best-effort storage bootstrap behavior.
- Dragonfly/BullMQ grouping:
  - BullMQ queue names default to Redis hash tags (`{publish}`, `{search}`,
    etc.) through `QUEUE_CLUSTER=true`.
  - Standard, dev, and Coolify Dragonfly services now use
    `--cluster_mode=emulated --lock_on_hashtags` instead of
    `--default_lua_flags=allow-undeclared-keys`.
  - Coolify app images default to `ghcr.io/lord007tn/nibleaf:latest`; `NIBLEAF_IMAGE`
    remains only as an optional pin/override.
- Custom-domain primary invariant verification:
  - `pnpm --filter @nibleaf/server typecheck`.
  - `pnpm exec biome check --write apps/server/src/actions/domains.ts`.
  - Direct server dogfood created a throwaway project/domain, confirmed an
    unverified domain is rejected as primary, verified the same domain, then
    confirmed it can become primary before cleanup.
- Multilingual default-language invariant verification:
  - `pnpm --filter @nibleaf/server typecheck`.
  - `pnpm exec biome check --write apps/server/src/actions/languages.ts`.
  - Direct server dogfood created a throwaway project with English and Arabic,
    confirmed the current default cannot be unset directly, promoted Arabic to
    default, and verified exactly one default language remained before cleanup.
- Page branch/language scope verification:
  - `pnpm exec biome check --write apps/server/src/actions/pages.ts`.
  - `pnpm --filter @nibleaf/server typecheck`.
  - Direct server dogfood created two throwaway projects, confirmed page create
    and list reject another project's branch/language IDs, confirmed moving or
    reordering an English page under an Arabic parent is rejected, and verified
    the page kept its original branch/language/parent before cleanup.
- Page cycle and published-version invariant verification:
  - `pnpm exec biome check --write packages/shared/src/site.ts
    packages/shared/src/site.test.ts apps/server/src/actions/sites.ts
    apps/server/src/actions/pages.ts apps/app/src/lib/site-paths.ts
    apps/app/src/routes/sites/$projectId/route.tsx`.
  - `pnpm --filter @nibleaf/shared test`.
  - `pnpm --filter @nibleaf/server typecheck`.
  - `pnpm --filter @nibleaf/app typecheck`.
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
  - `pnpm --filter @nibleaf/app typecheck`.
  - Code inspection confirmed page alternates returned by the public page API
    are published from `SitePageView` to the site chrome, and `changeLanguage`
    uses `siteHref` with the translated alternate path before falling back to
    query-only language switching.
- Published-site analytics consent verification:
  - `pnpm exec biome check --write apps/app/src/lib/site-seo.ts
    apps/app/src/lib/site-seo.test.ts
    apps/app/src/components/site/site-analytics-consent.tsx
    apps/app/src/lib/site-i18n.ts apps/app/src/routes/sites/$projectId/route.tsx`.
  - `pnpm --filter @nibleaf/app test`.
  - `pnpm --filter @nibleaf/app typecheck`.
  - `siteHead` regression tests confirm GA4/Plausible scripts are emitted when
    consent is not required and withheld from the initial head when cookie
    consent is enabled; the published-site chrome now renders a localized
    consent prompt that injects the same validated scripts only after acceptance.
- Self-hosted Plan/Billing copy verification:
  - `pnpm exec biome check --write apps/app/src/components/project-settings/plan-section.tsx
    apps/app/src/components/settings/billing-tab.tsx
    apps/app/src/components/settings/workspace-tab.tsx apps/app/src/lib/i18n/messages.ts
    IMPLEMENTATION_STATUS.md`.
  - `pnpm --filter @nibleaf/app typecheck`.
  - `pnpm --filter @nibleaf/app test`.
  - Code inspection confirmed the per-site Plan tab now renders a single
    self-hosted free plan, the Billing tab has no upgrade/cancel controls, and
    the workspace plan summary no longer exposes a nonfunctional billing portal
    action.
- Self-hosted integrations honesty verification:
  - `pnpm exec biome check --write
    apps/app/src/components/settings/integrations-tab.tsx
    apps/app/src/lib/i18n/messages.ts IMPLEMENTATION_STATUS.md`.
  - `pnpm --filter @nibleaf/app typecheck`.
  - `pnpm --filter @nibleaf/app test`.
  - Code inspection confirmed integrations no longer persist connected-looking
    states or expose connect/save controls in the self-hosted build; existing
  metadata is displayed read-only and users are directed to the Git settings
  tab for public repository imports.

Completed on 2026-07-17:

- Exported the legacy `ghost.joodbooking.com` publication (349 total entries,
  297 published) and preserved the source export plus a reproducible `en`/`ar`
  split report for the one-time production migration.
- Imported all 297 published Ghost items into the live JoodBooking project:
  117 English and 180 Arabic, with 0 skipped. English was restored as the
  default language, both languages remain enabled, and the Arabic root groups
  were localized to `المدونة` and `الصفحات`.
- Published and verified the production deployment at
  `https://docs.joodbooking.com`: HTTP 200, 298 sitemap URLs (the original
  Welcome page plus all migrated items), including 180 Arabic URLs and 118
  English/default URLs.
- Repaired all migrated Ghost image references in the live English and Arabic
  documentation and republished. A sampled Arabic guide renders ten screenshots
  from `ghost.joodbooking.com`, each fully loaded at its natural dimensions.
- Added safe Ghost asset ownership for future imports: public-host validation,
  redirect/type/size limits, object-storage persistence, Markdown rewriting,
  per-import deduplication, and stable reuse across repeated imports.
- Preserved non-language Ghost tags as published page metadata, kept legacy
  help-site links intact, omitted the stock Ghost Coming soon post, and fixed
  generated excerpts so Markdown image syntax and source URLs cannot leak below
  page headings.
- Extended the same asset ownership pipeline to Mintlify imports. Relative
  Markdown and MDX image references resolve against their source file, are
  copied into project storage, and modern object-style navigation retains page
  titles, icons, and tags.
- Production-tested the Mintlify importer against a nested public docs project.
  Root-relative images now resolve from the directory containing `docs.json`
  (Mintlify's project root) rather than incorrectly assuming the Git repository
  root.
- The production Mintlify fixture imported 27 configured pages and copied 23
  images into project-owned storage with no source-image fallbacks. Internal
  Markdown and MDX links are rewritten to the imported grouped routes, and
  valid linked source pages omitted from Mintlify navigation are discovered and
  imported under an `Additional pages` group so publish validation stays strict.
- Mintlify component indentation is normalized before persistence, preventing
  Markdown nested in JSX components from becoming accidental code blocks. MDX
  `<img>` tags are converted to first-class Markdown images after asset
  migration so imported screenshots render instead of exposing source markup.
- Production Ghost QA imported one tagged article, intentionally skipped the
  stock Coming soon placeholder, copied its image into project-owned storage,
  published the visible `First Steps` tag, and preserved its legacy HTTP help
  link exactly. The live JoodBooking deployment was also cleaned and
  republished without the Welcome and Coming soon placeholders.
- Added Ghost language-tag parsing, locale preflight validation, multilingual
  import routing, aggregated warnings for untagged/ambiguous content, focused
  mapping tests, and a bilingual tagging tutorial in the import UI.
- Replaced the import cards/wizard with a compact, unnumbered single-workspace
  flow inspired by Mintlify's source composer, with inline Mintlify/Ghost source
  settings, a Ghost site URL for image migration, and a collapsed language-tag
  tutorial.
- Reworked General settings into a responsive side-by-side translation editor
  and moved localized project identity into the new `ProjectTranslation` table.
  The migration preserves existing translations while removing them from JSON.
- Normalized primary sidebar controls to the same 48px vertical rhythm.
- Verification passed: full lint; server (108), app (93), validator (34), and
  shared (68) test suites (303 tests total); all 16 package
  typechecks; and the full production build. The build still reports the documented large
  frontend chunk warnings, so bundle splitting remains in the queue above.

## Pending / External

- Production deploys from `lord007tn/nibleaf` branch `main` through Coolify.
- Cloudflare DNS changes remain outside the active work target unless requested.
- Chrome file upload requires the ChatGPT Chrome extension's optional
  `file://` access. Production Ghost QA therefore used the authenticated page's
  same-origin import endpoint with the prepared local fixture; no browser
  credentials were copied or exposed.
