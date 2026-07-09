<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="apps/www/public/brand/nibleaf-logo-horizontal-ltr-reverse.svg" />
  <img src="apps/www/public/brand/nibleaf-logo-horizontal-ltr.svg" alt="Nibleaf" height="56" />
</picture>

### Beautiful docs, on your own infrastructure.

**Nibleaf** is an open-source, self-hostable documentation platform — a
[Mintlify](https://mintlify.com) alternative. Author in Markdown/MDX, publish a fast,
searchable, versioned docs site, and run all of it on infrastructure **you** own.
First-class **English + Arabic, RTL-first**.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/lord007tn/nibleaf?sort=semver&color=B96A3D)](https://github.com/lord007tn/nibleaf/releases)
[![CI](https://github.com/lord007tn/nibleaf/actions/workflows/ci.yml/badge.svg)](https://github.com/lord007tn/nibleaf/actions/workflows/ci.yml)
[![Docker image](https://github.com/lord007tn/nibleaf/actions/workflows/docker.yml/badge.svg)](https://github.com/lord007tn/nibleaf/pkgs/container/nibleaf)

[Homepage](https://nibleaf.com) · [Quick start](#-quick-start) · [Features](#-features) · [Deploy](#-deploy-to-production) · [Architecture](#️-architecture) · [Contributing](CONTRIBUTING.md)

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

## 🚀 Quick start

```bash
git clone https://github.com/lord007tn/nibleaf
cd nibleaf && cp .env.example .env

# Set a strong auth secret — the stack refuses to boot in production with the
# placeholder. (Also set POSTGRES_PASSWORD / STORAGE_SECRET_KEY for real deploys.)
echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)" >> .env

docker compose up -d --build
# → dashboard  http://localhost:4310   (open /sign-up to create your account)
# → API        http://localhost:4311/docs
```

> Open **http://localhost:4310/sign-up** and create the first account — it's provisioned
> with a workspace and a starter docs project automatically. (The Docker stack runs in
> production mode and does **not** seed demo credentials; for local dev, `pnpm db:seed`
> creates `demo@nibleaf.dev` / `nibleafdemo123`.) See **[DEPLOYMENT.md](DEPLOYMENT.md)** for
> production hardening.

## 🐳 Deploy to production

**[Coolify](https://coolify.io)** is the easiest path. Use
[`docker-compose.coolify.yml`](docker-compose.coolify.yml) — it **pulls the prebuilt image**
`ghcr.io/lord007tn/nibleaf:latest` (published by CI on every push and release), so nothing is
built on your server:

1. In Coolify, add a **Docker Compose** resource from this repo (a Public or Private-Repo /
   GitHub-App source), pointing at `docker-compose.coolify.yml`.
2. Assign the dashboard, admin, wildcard-docs, custom-domain-CNAME, and storage domains to the
   `app` / `admin` / `maxio` services — Coolify auto-generates the `SERVICE_*` secrets.
3. Set `SITE_BASE_DOMAIN` + `CUSTOM_DOMAIN_CNAME_TARGET`, then **Deploy**. The `migrate`
   service runs database migrations before `server` / `worker` / `app` start.

Pin a specific build with `NIBLEAF_IMAGE=ghcr.io/lord007tn/nibleaf:v0.1.0`. For a plain Docker
host, `docker-compose.yml` builds from source and serves only the product stack. Full
guide (secrets, reverse proxy, TLS, security checklist) in **[DEPLOYMENT.md](DEPLOYMENT.md)**.

## 🏗️ Architecture

A [Turborepo](https://turbo.build) + [pnpm](https://pnpm.io) monorepo:

```
apps/
  www      Marketing site               TanStack Start (SSR)          :4313
  app      Dashboard + editor + docs    TanStack Start + Query/Form   :4310
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

# run server + worker + dashboard (add www/admin with: pnpm dev:full)
pnpm dev
```

| App        | URL                          |
| ---------- | ---------------------------- |
| Dashboard  | http://localhost:4310        |
| API + docs | http://localhost:4311/docs   |
| Worker ops | http://localhost:4312/jobs   |
| Marketing  | http://localhost:4313        |

Demo login (after `pnpm db:seed`): `demo@nibleaf.dev` / `nibleafdemo123`.

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

All configuration is via environment variables — see [`.env.example`](.env.example).
Storage is S3-compatible, so swap **maxio** for Cloudflare R2, AWS S3, or Backblaze B2 by
changing the `STORAGE_*` variables. For production, set strong values for
`BETTER_AUTH_SECRET`, `POSTGRES_PASSWORD`, and `STORAGE_SECRET_KEY`, and serve the apps
behind a TLS-terminating reverse proxy.

When `NODE_ENV=production`, the container entrypoint refuses to start (`exit 1`) if
`BETTER_AUTH_SECRET` is empty or left at a known demo default — generate one with
`openssl rand -hex 32`. Implementation parity and open gaps are tracked in
**[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md)**.

## 🤝 Contributing

Contributions are welcome! See **[CONTRIBUTING.md](CONTRIBUTING.md)** to get set up, and
please open an issue to discuss substantial changes first. Found a vulnerability? See
**[SECURITY.md](SECURITY.md)**.

## 📄 License

Nibleaf is free software, licensed under the **GNU Affero General Public License v3.0**
(AGPL-3.0) — see [LICENSE](LICENSE) for the full text. Because the AGPL includes the
“network use” clause, if you run a modified version of Nibleaf as a network service you must
make your modified source available to its users. Contributions are accepted under the same
license.

<div align="center"><sub>Built with 🖋️ — <a href="https://nibleaf.com">nibleaf.com</a></sub></div>
