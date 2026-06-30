# Midad Implementation Status

Last updated: 2026-06-30

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
  DNS instruction records, and custom-domain root serving through the app server.
- Custom-domain navigation keeps reader URLs at the domain root instead of
  leaking the internal `/sites/:projectId` route.
- Custom-domain primary selection in project settings.
- Configurable custom-domain CNAME target via `CUSTOM_DOMAIN_CNAME_TARGET`.
- Free project subdomains through `SITE_BASE_DOMAIN`; requests to
  `<project-slug>.<SITE_BASE_DOMAIN>` resolve to the published project without a
  redirect.
- Project overview live-domain and recent deployment activity panel.
- API key settings UI for create/copy/revoke using the existing scoped key API.
- Git-style DB branches with create/fork/merge/delete and versioned published
  snapshots.
- One-way public GitHub and GitLab Markdown/MDX import into the default
  branch/language.
- Multilingual docs with language CRUD, RTL/LTR direction, language-specific
  page trees, fallback, language switcher, and hreflang alternates.
- Self-host Docker image and Compose stack for local/standard deployment.
- Coolify-specific Compose stack in `docker-compose.coolify.yml` that excludes
  the marketing app and exposes only the docs platform services.

## Partial / Deliberate Limits

- Git integration is currently one-way import from public GitHub/GitLab
  repositories. There is no OAuth/private-repo sync, webhook sync, or two-way
  push yet.
- Multilingual authoring is manual/structural. There is no automatic translation
  workflow.
- TLS certificates and wildcard/custom-domain ingress are handled by Coolify or
  the operator's reverse proxy. The app resolves hosts and serves content once
  traffic reaches it.
- Export-to-PDF remains out of scope for the free self-hostable target.
- Advanced hosted search providers are not prioritized; built-in published-site
  search is implemented, including configurable result count.

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

Pending / External:

- Push is pending because this checkout has no configured Git remote and no
  visible existing GitHub repository matched the project metadata.
- Cloudflare DNS for `raedbahri.com` is pending until there is a deployed
  Coolify ingress target and desired hostnames to point at.
- Live import dogfood against an external public GitLab repository is still
  pending; current git parity remains one-way public Markdown/MDX import.

Known verification caveat:

- Full `pnpm lint` currently fails on broad pre-existing formatting/import
  diagnostics across the dirty worktree; touched files pass focused Biome checks.
- Chrome profile extensions can block direct navigation to some local settings
  URLs or add hydration warnings; authenticated in-app settings screens were
  still verified after a clean dev-server restart.
