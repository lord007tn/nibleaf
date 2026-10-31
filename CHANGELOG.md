# Changelog

This file records source changes. A merged entry does not prove that Nibleaf
Cloud or a published self-host image contains it. The committed self-host
manifest remains the authority for the latest published artifact.

## Unreleased

## v0.2.0

### Highlights

v0.2.0 adds optional hybrid search with grounded AI answers, a GitBook importer, project add-ons, portable documentation themes, usage metering, project integrations, and a read-only MCP endpoint, and published sites now move between pages without a full reload. Upgrading from v0.1.2 takes two steps because of the move to BullMQ 6, so follow the [upgrade guide](https://docs.nibleaf.com/self-hosting/upgrade-v0-2) instead of only changing the image tag. Dependency scanning still reports three Medium advisories, in `glob`, `minimatch`, and `deepmerge`, which the image includes through its email packages.

### Upgrade actions

These apply when you upgrade a self-hosted v0.1.2 installation. New installations
need none of them. The
[upgrade guide](https://docs.nibleaf.com/self-hosting/upgrade-v0-2) has the full
procedure.

- **Upgrade in two hops.** Changing only the image tag does not work. BullMQ 6
  refuses the repeat definitions left by v0.1.2: the log shows `Unknown recurring
  configuration`, scheduling is refused, and the API and worker do not become ready.
  Migrate the schedules from the staged image first (#123, #147).
- **Take a tested backup.** Eight Prisma migrations run on start and are
  forward-only. Going back means restoring the pre-upgrade backup. Rolling back the
  schedules alone is not enough.
- **Check for duplicate linked accounts.** Better Auth now refuses a sign-in when two
  `account` rows share a provider and account ID. The check in the upgrade guide must
  return no rows (#249).
- **Replace the Compose file** with the release's verified copy, keeping `.env`, the
  Compose project name, and the volume names. Changing only the version misses the
  new `MCP_*` and `INTEGRATION_*` settings.
- **Add `INTEGRATION_CREDENTIAL_ENCRYPTION_KEY`** to `.env`, as a base64-encoded
  32-byte key, before using integrations. Do not change it once integrations are in
  use.
- **Confirm a sign-in path.** Sign-in uses email codes, or Google when configured.
  The worker health check returns 503 while required email delivery has no provider.
  Configure Postmark or SMTP, or set `EMAIL_DELIVERY_REQUIRED=false` on an instance
  that signs in through Google.
- **Move AI to OpenRouter.** AI writing assist and search read `OPENROUTER_API_KEY`.
  `OPENAI_API_KEY` is no longer used (#100). The release Compose file passes the new
  key to the services (#241).
- **Add `erasure` to `WORKER_QUEUES` if you set it.** Deleting a project now also
  erases its stored files through a new `erasure` queue. An allowlist without it
  leaves those files in place. This applies only to projects deleted after the upgrade
  (#248).

### Added

- A GitBook Git Sync importer, thanks to @Zhincore, that keeps sidebar sections and
  URLs, maps GitBook blocks onto Nibleaf components, and copies images into project
  storage (#235).
- Published sites move between pages without a full reload, thanks to @Zhincore, with
  focus, announcements and page views handled for each navigation (#237).
- Pages with subpages collapse in the published sidebar, with only the branch holding
  the current page open, and Harbor and Signal show a visible scrollbar. Readers
  without JavaScript still see every page (#262).
- The admin funnel shows first manual publishes and day 1 to 7 publishing retention
  (#244).
- The installer refuses to run over an existing installation, checks the Docker
  architecture, and requires a sign-in path (#241).
- Tenant-safe hybrid search over Qdrant with optional grounded AI answers, project
  search configuration, and privacy-safe index diagnostics (#98, #106).
- Project add-ons with entitlement-aware availability, consent controls, reader
  actions, publish checks, revisions, and audit history (#103).
- Harbor, Manuscript, and Signal documentation themes with safe template exchange
  and runnable Git exports (#96, #101, #104).
- Provider-neutral usage metering with exact quantities, advisory entitlements,
  reconciliation, export, deletion, and degraded states (#105).
- Optional ClickHouse product analytics (#97).
- A project integrations engine with encrypted credentials, confirmations, audit,
  and key rotation (#107).
- An authenticated, project-bound HTTP MCP endpoint with least-privilege read
  adapters, audit, API-key expiry, host validation, and rate limiting (#108).
- An English and Arabic guide library, plus Markdown delivery for public pages
  (#142).

### Changed

- Moved to Prisma 7, Vite 8, TypeScript 7, BullMQ 6, and stable TanStack Start (#90,
  #91, #92, #123, #188).
- AI features now use OpenRouter (#100).
- The release image installs a separate production dependency graph (#198).
- Services receive termination signals directly, so they shut down gracefully (#173).
- Worker readiness now checks its queue connections (#202).
- Project routes wait for access and show a clear not-found state, and member
  administration controls follow the member's role (#168).
- Mobile navigation reaches sign-in and product pages, and privacy choices moved to
  an explicit footer dialog (#176).
- Removed the View Markdown and Copy Markdown buttons from the public reader (#175).
- Self-hosting documentation now covers the upgrade, the `amd64` requirement, the
  sign-in prerequisite, and backups that work from an installer directory.
- Upgraded Better Auth to 1.7.14, with an additive migration for the `invitation.createdAt`
  column its schema check requires. Builds of `main` on 1.7.0 to 1.7.2 could not
  complete Google sign-in; no published release was affected (#249).

### Fixed

- **AI:** When an AI provider fails, drafting shows a translated error in the editor
  instead of offline placeholder text, and AI controls no longer appear on instances
  without a provider (#259, #260).
- **Projects:** Deleting a project also erases its stored files (#248), and a project
  has no icon unless one is picked (#263).
- **Exports:** GitHub alert callouts render without the literal marker (#257).
- **Published sites:** Public asset routes serve only a project's assets (#250), and
  custom domains keep the right paths and canonical origins (#246).
- **CLI:** `inspect` checks a path that gets the real Markdown 404, and publishing uses
  npm trusted publishing (#242).
- **Editor and publishing:** Saving a page no longer corrupts an image placed directly
  before an MDX block tag or paragraph (#236, thanks @Zhincore). Pages already saved
  in the corrupted form need a manual fix or a re-import. Saves are serialized so
  rapid or blank edits are not lost, and a publish uses the latest draft (#194).
  Python `import` lines survive the visual editor (#212).
- **Published reader:** Invalid site URLs return 404 instead of 500 (#239). Rate-limited
  requests keep their 429, and Try again reloads the route (#216). Server rendering
  works when public and container ports differ (#198). Articles stay visible during
  hydration (#209), accessible names are localized (#207), and reader links use clean
  canonical URLs (#174). Transient failures no longer look like an unpublished site
  (#212).
- **Search and answers:** Pages that begin at `##` and definitions held in headings are
  retrievable (#212, #213). Answers keep complementary evidence (#214, #215),
  weak dense matches are filtered before fusion (#218), custom-domain search works
  (#137), and index diagnostics recover during first-time indexing (#213).
- **Imports:** Mintlify sync is atomic with navigation-exact replacements (#129, #131).
  Cross-language imports no longer duplicate pages (#148), literal code and fenced MDX
  examples are preserved (#167, #169), and Ghost fallback warnings are kept (#199).
- **Exports:** PDF export uses bounded memory on image-heavy sites (#220), Arabic PDFs
  are readable (#198), cross-language links resolve (#221), and attachment downloads
  and localized file sizes are correct (#211).
- **Sign-in and administration:** A failed email enqueue returns an error instead of
  claiming a code was sent, expired codes are not delivered, and those errors are
  localized (#202, #205). Email templates render correctly (#128), and the admin
  panel renders and keeps its session on a shared auth origin (#124, #145).
- **Arabic and RTL:** Fixed the command palette crash, direction handling, select
  labels, and digit display across the dashboard (#136, #137), and labelled settings
  controls for assistive technology (#139).
- **Projects:** Deleting a project and analytics writes no longer fail on a database
  lock result (#170).
- **Math:** Sanitization no longer strips KaTeX layout and accessibility metadata
  (#197).

### Security

- Patched runtime dependency advisories and upgraded the MCP server SDK with input
  limits (#258, #261).
- Moved `next`, `vite`, `vitest`, `body-parser`, `fast-uri`, `qs`, and `toml` to
  patched versions (#268).
- Removed the unused Better Auth organization deletion endpoint, so workspace removal
  uses the full erasure workflow (#245).
- Tightened remote image downloads in the importers (#243).
- Disabled an unused Better Auth invitation endpoint, so invitations keep following
  Nibleaf's rules (#249).
- Updated the runtime image's zlib, Expat, Chromium, and bundled pnpm (#203, #217,
  #219).
- Patched the MDX frontmatter TOML parser for GHSA-82x6-q7mm-w9cf and
  GHSA-v5mp-jgw5-2x6j (#146), and applied compatible updates for vulnerable transitive
  dependencies (#197).
- The release image no longer carries development tools or accepts private local
  environment and QA files during `COPY` (#198).

### Known limitations

- The published image supports `linux/amd64` only.
- `docker-compose.prod.yml` includes neither Qdrant nor ClickHouse. Hybrid search needs
  the optional overlay, and AI features need a provider key that you supply.
- The MCP endpoint is off by default and its adapters are read-only.
- Usage metering does not enable billing or payments, and entitlements remain
  advisory.
- Dependency scanning still reports three Medium advisories, in `glob`, `minimatch`,
  and `deepmerge`. The image includes them through its email packages. Nibleaf does
  not import them directly, and removing them needs upstream changes.
