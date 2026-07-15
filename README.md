<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="apps/app/public/brand/nibleaf-logo-horizontal-ltr-reverse.svg" />
  <img src="apps/app/public/brand/nibleaf-logo-horizontal-ltr.svg" alt="Nibleaf" height="56" />
</picture>

### The open-source Mintlify alternative

Nibleaf is an open-source, self-hostable documentation platform — an alternative
to Mintlify and GitBook — with a Notion-style WYSIWYG editor over plain Markdown,
first-class Arabic/RTL support, custom domains, and a free cloud beta at
[nibleaf.com](https://nibleaf.com).

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/lord007tn/nibleaf?sort=semver&color=B96A3D)](https://github.com/lord007tn/nibleaf/releases)
[![CI](https://github.com/lord007tn/nibleaf/actions/workflows/ci.yml/badge.svg)](https://github.com/lord007tn/nibleaf/actions/workflows/ci.yml)
[![Docker image](https://github.com/lord007tn/nibleaf/actions/workflows/docker.yml/badge.svg)](https://github.com/lord007tn/nibleaf/pkgs/container/nibleaf)

[Homepage](https://nibleaf.com) · [Quick start](#-quick-start) · [Features](#-features) · [Deploy](DEPLOYMENT.md) · [Upgrade](UPGRADING.md) · [Architecture](#️-architecture) · [Contributing](CONTRIBUTING.md)

<br />

<img src=".github/assets/landing.png" alt="Nibleaf — the open-source documentation platform" width="840" />

</div>

---

## What is Nibleaf?

Nibleaf lets you write documentation in Markdown/MDX, organize it into a navigable tree,
and publish a fast, searchable, multilingual site — with versioned deploys, custom
domains, per-site teams, and analytics — **all self-hosted with one Docker command**.
It's the docs platform you own end to end: no per-seat pricing, no vendor lock-in, and
your content stays in your database.

- 🖋️ **WYSIWYG _and_ Markdown, round-tripped** — write visually or in raw MDX; content is
  Markdown end-to-end, so you're never locked into a proprietary format.
- 🌍 **Bilingual & RTL-first** — genuine Arabic + English with per-language page trees,
  right-to-left layout, and fully translated chrome. Almost no docs platform does this.
- 📦 **Versioned publishing** — every publish is an immutable snapshot; the live site is
  always served from a READY deployment, so readers never see a half-written page.
- 🏠 **Self-hosted** — Docker Compose or Coolify, bring-your-own Postgres + S3-compatible
  storage. Your data never leaves your infrastructure.

## 📸 Screenshots

**The published docs site** — three-column layout, instant `⌘K` search, and a scroll-spy
table of contents:

<img src=".github/assets/docs-en.png" alt="A published Nibleaf documentation site" width="840" />

**The editor** — Visual / Markdown / Preview modes, a drag-and-drop page tree, branches,
anchored comments, and one-click publish:

<img src=".github/assets/editor.png" alt="The Nibleaf editor" width="840" />

## ✨ Features

- **Rich editor** — WYSIWYG *and* raw Markdown/MDX modes with live preview, a Notion-style
  block handle + slash menu, and a drag-and-drop, nestable page tree.
- **MDX components** — callouts, cards, steps, tabs, code groups, accordions,
  param/response fields, frames, tooltips, inline icons, KaTeX math, and Mermaid — all
  round-trip losslessly between visual and source.
- **Versioned publishing** — immutable snapshots; atomic roll-forward; readers never see a
  half-written page.
- **Branches** — git-style, database-backed branches: fork, edit in isolation, and merge
  into `main`.
- **Anchored comments** — Figma-style review comments pinned to the exact block.
- **Hybrid search** — full-text + fuzzy ([Orama](https://oramasearch.com)), bilingual
  (including an Arabic tokenizer), built into every published site and available via `⌘K`.
- **Bilingual & RTL** — per-language page trees, RTL layout, `hreflang`, and localized
  dashboard / editor / site chrome (English + Arabic).
- **Custom domains & subdomains** — guided DNS + verification, wildcard project subdomains,
  and host-based published-site routing.
- **SEO built in** — SSR, per-page canonical / Open Graph / Twitter / JSON-LD, sitemap,
  robots, `hreflang`, and `noindex` controls.
- **Per-site teams** — each site is its own workspace with role-based members
  (owner / admin / editor) via better-auth organizations.
- **Analytics** — page views, unique visitors, top pages, top searches, plus device and
  language breakdowns.
- **Platform admin** — an internal operator panel for customers, sites, deployments, and roles.
- **Bring-your-own storage** — any S3-compatible store (maxio, Cloudflare R2, AWS S3,
  Backblaze B2).

## 🚧 Not built yet

Honesty over marketing — if you need these today, Nibleaf isn't there yet:

- **OpenAPI playground / API "try it"** — no interactive API-reference console yet.
- **Two-way git sync & PR previews** — public repo *import* exists, but docs don't
  round-trip to a git repo and there are no per-PR preview deployments.
- **Reader auth / personalization** — sites are either public or visible to
  workspace members only; there are no dedicated end-reader accounts, JWT/SSO
  hand-off, or per-audience content.
- **SSO / SAML** — email/password + Google OAuth only; no enterprise SSO.

Want one of these sooner? Open or upvote an issue —
[github.com/lord007tn/nibleaf/issues](https://github.com/lord007tn/nibleaf/issues).

## 🚀 Quick start

On a Linux server, the guided installer downloads the production Compose file,
prompts for the public URLs and optional mail provider, generates fresh secrets
locally, writes a mode-600 `.env`, and starts the stack:

```bash
curl -fsSL https://nibleaf.com/install.sh | sh
```

For manual setup, the recommended path below **pulls the prebuilt image** from
GHCR (`ghcr.io/lord007tn/nibleaf`) — nothing is compiled on your server, so it
runs fine on a small VPS:

```bash
git clone https://github.com/lord007tn/nibleaf
cd nibleaf && cp .env.production.example .env

# Edit .env — set APP_URL (your dashboard origin), the storage endpoints, and
# fresh secrets (openssl rand -hex 32). The stack fails fast if one is missing.

docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
# → dashboard  http://127.0.0.1:4310   (put a TLS reverse proxy in front)
```

Database migrations run automatically (the one-shot `migrate` service), and the
image tag is **pinned** via `NIBLEAF_VERSION` — upgrades are bump-pull-up, see
**[UPGRADING.md](UPGRADING.md)**. Open **`$APP_URL/sign-up`** and create the first
account — it's provisioned with a workspace and a starter docs project
automatically (no demo credentials are seeded in production). The full production
guide — reverse proxy, TLS, wildcard subdomains, custom-domain TLS automation,
and backups — is **[DEPLOYMENT.md](DEPLOYMENT.md)**. Operators of the managed
`nibleaf.com` service should use **[DEPLOY-CLOUD.md](DEPLOY-CLOUD.md)**.

<details>
<summary><b>Build from source instead</b> (needs ~5–6 GB free RAM)</summary>

`docker-compose.yml` builds the whole monorepo in-container — the build needs
roughly **5–6 GB of free RAM** and will OOM small servers. Prefer the pull-based
quick start above unless you're modifying the code.

```bash
cp .env.example .env
echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)" >> .env
docker compose up -d --build
# → dashboard  http://localhost:4310   (open /sign-up to create your account)
# → API        http://localhost:4311/docs
```

</details>

## 🐳 Deploy to production

- **Docker Compose (recommended)** — the quick start above *is* the production
  path; harden it with **[DEPLOYMENT.md](DEPLOYMENT.md)** (secrets, reverse
  proxy + TLS, wildcard docs subdomains, backups, security checklist).
- **[Coolify](https://coolify.io)** — add a **Docker Compose** resource pointing
  at [`docker-compose.coolify.yml`](docker-compose.coolify.yml), assign domains
  to the `app` / `admin` / `maxio` services (Coolify auto-generates the
  `SERVICE_*` secrets), set `SITE_BASE_DOMAIN` + `CUSTOM_DOMAIN_CNAME_TARGET`,
  and deploy. Pin a build with `NIBLEAF_IMAGE=ghcr.io/lord007tn/nibleaf:v0.1.0`.
- **Nibleaf Cloud** — don't want to run servers? The hosted beta at
  [nibleaf.com](https://nibleaf.com) is free while in beta.

## 🏗️ Architecture

A [Turborepo](https://turbo.build) + [pnpm](https://pnpm.io) monorepo:

```
apps/
  app      Marketing + dashboard + docs TanStack Start + Query/Form   :4310
  server   API                          Hono + better-auth            :4311
  worker   Background jobs              BullMQ                         :4312
  admin    Platform admin panel        TanStack Start                 :4315
packages/
  database    Prisma schema + client (PostgreSQL)
  auth        better-auth (email/password + organizations)
  storage     S3-compatible object storage
  bullmq      Typed queues/workers (publish, search, email, analytics)
  search      Orama full-text + fuzzy search (bilingual)
  validators  Shared Zod schemas — the server↔app contract
  shared      Constants, RBAC, ids, snapshot/site helpers
  design-system  Brand + shadcn/Base UI components
  logger      Pino
```

**How publishing works** — the dashboard edits `Page` rows (the draft). Hitting **Publish**
creates a `Deployment` and enqueues a BullMQ job; the worker builds an immutable snapshot of
the doc tree and marks the deployment `READY`. The public site and its search index are
served from that snapshot — so readers never see a half-written page, and rolling forward is
atomic.

**Same-origin auth** — the dashboard proxies `/api/**` to the server (via Nitro), so
better-auth session cookies stay first-party with no CORS dance.

## 🧰 Tech stack

TanStack Start · React 19 · Hono · better-auth · Prisma · PostgreSQL · BullMQ · Dragonfly ·
Orama · shadcn/ui (Base UI) · Tailwind CSS v4 · Zod · Pino · tsdown · Vite · Biome.

## 💻 Local development

Prerequisites: **Node ≥ 22**, **pnpm 10**, **Docker**.

```bash
pnpm install
cp .env.example .env

# start infra only (Postgres, Dragonfly, maxio)
docker compose -f docker-compose.dev.yml up -d

# create the schema + seed a demo workspace
pnpm db:deploy      # or: pnpm db:migrate  (creates a new migration)
pnpm db:seed

# run server + worker + the app (add admin/docs with: pnpm dev:full)
pnpm dev
```

| App        | URL                          |
| ---------- | ---------------------------- |
| Dashboard  | http://localhost:4310        |
| API + docs | http://localhost:4311/docs   |
| Worker ops | http://localhost:4312/jobs   |

Demo login (after `pnpm db:seed`): `demo@nibleaf.test` / `nibleafdemo123`.

## 📜 Scripts

| Command           | Description                               |
| ----------------- | ----------------------------------------- |
| `pnpm dev`        | server + worker + dashboard (watch mode)  |
| `pnpm build`      | build every app and package               |
| `pnpm typecheck`  | type-check the whole workspace            |
| `pnpm test`       | run the unit test suites (Vitest)         |
| `pnpm lint`       | lint + format check (Biome)               |
| `pnpm db:migrate` | create + apply a Prisma migration (dev)   |
| `pnpm db:deploy`  | apply migrations (production)             |
| `pnpm db:seed`    | seed the demo workspace + published site  |
| `pnpm db:studio`  | open Prisma Studio                        |

## ⚙️ Configuration

All configuration is via environment variables — see
[`.env.production.example`](.env.production.example) (production, pull-based stack)
and [`.env.example`](.env.example) (local dev / source build). Storage is
S3-compatible, so swap **maxio** for Cloudflare R2, AWS S3, or Backblaze B2 by
changing the `STORAGE_*` variables. For production, set strong values for
`BETTER_AUTH_SECRET`, `POSTGRES_PASSWORD`, and `STORAGE_SECRET_ACCESS_KEY`, and
serve the apps behind a TLS-terminating reverse proxy.

When `NODE_ENV=production`, the container entrypoint refuses to start (`exit 1`) if
`BETTER_AUTH_SECRET` is empty or left at a known demo default — generate one with
`openssl rand -hex 32`. Implementation parity and open gaps are tracked in
**[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md)**.

## 💬 Support & community

- **Questions & ideas** — [GitHub Discussions](https://github.com/lord007tn/nibleaf/discussions)
- **Bugs** — [GitHub Issues](https://github.com/lord007tn/nibleaf/issues)
- **Email** — [support@nibleaf.com](mailto:support@nibleaf.com)
- **Security vulnerabilities** — privately, please: see [SECURITY.md](SECURITY.md)

## 🤝 Contributing

Contributions are welcome! See **[CONTRIBUTING.md](CONTRIBUTING.md)** to get set up, and
please open an issue to discuss substantial changes first. Found a vulnerability? See
**[SECURITY.md](SECURITY.md)**.

## 📄 License

Nibleaf is free software, licensed under the **GNU Affero General Public License v3.0**
(AGPL-3.0) — see [LICENSE](LICENSE) for the full text. Because the AGPL includes the
“network use” clause, if you run a modified version of Nibleaf as a network service you must
make your modified source available to its users. Contributions are accepted under the same
license. The “Nibleaf” name and logo are **not** covered by the AGPL — see
**[TRADEMARK.md](TRADEMARK.md)**.

<div align="center"><sub>Built with 🖋️ — <a href="https://nibleaf.com">nibleaf.com</a></sub></div>
