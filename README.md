# Plume

**The open-source documentation platform — a self-hostable alternative to Mintlify.**

Write your docs in Markdown, organize them into a navigable tree, and publish a
fast, searchable documentation site. Versioned publishing, custom domains,
hybrid search, and analytics — all running on infrastructure you own.

```bash
git clone https://github.com/plume-docs/plume
cd plume && cp .env.example .env

# Set a strong auth secret — the stack refuses to boot in production with the
# placeholder. (Also set POSTGRES_PASSWORD / STORAGE_SECRET_KEY for real deploys.)
echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)" >> .env

docker compose up -d --build
# → dashboard  http://localhost:4310   (open /sign-up to create your account)
# → API        http://localhost:4311/docs
# → marketing  http://localhost:4313
```

> Open http://localhost:4310/sign-up and create the first account — it gets a
> workspace and a starter docs project automatically. (The docker stack runs in
> production mode and does **not** seed demo credentials; for local dev,
> `pnpm db:seed` creates `demo@plume.dev` / `plumedemo123`.) See
> **[DEPLOYMENT.md](DEPLOYMENT.md)** for production hardening.

---

## Features

- **Markdown editor** with a live preview, page tree, and groups.
- **Versioned publishing** — every publish snapshots your docs; the live site is
  always served from an immutable, READY deployment.
- **Hybrid search** (full-text + fuzzy) powered by [Orama](https://oramasearch.com),
  built into every published site and available via ⌘K.
- **Live documentation sites** with a 3-column layout (nav, content, table of
  contents), prev/next navigation, breadcrumbs, and per-project theming.
- **Custom domains** with guided DNS records and verification.
- **Analytics** — page views, unique visitors, top pages, and top searches.
- **Workspaces & members** with role-based access (owner / admin / editor).
- **Asset uploads** to any S3-compatible store (maxio, R2, S3, B2).
- **RTL support** and light/dark themes throughout.

## Architecture

A Turborepo + pnpm monorepo:

```
apps/
  www      Marketing site         TanStack Start (SSR)        :4313
  app      Dashboard + live docs  TanStack Start + Query/Form :4310
  server   API                    Hono + better-auth          :4311
  worker   Background jobs        BullMQ                       :4312
packages/
  database   Prisma schema + client (PostgreSQL)
  auth       better-auth (email/password + organizations)
  storage    S3-compatible object storage
  bullmq     Typed queues/workers (publish, search, email, analytics)
  search     Orama full-text + fuzzy search
  validators Shared Zod schemas (the server↔app contract)
  shared     Constants, RBAC, ids, snapshot/site helpers
  logger     Pino
  tsconfig   Shared TS configs
```

**How publishing works:** the dashboard edits `Page` rows (the draft). Hitting
**Publish** creates a `Deployment` and enqueues a BullMQ job; the worker builds an
immutable snapshot of the doc tree and marks the deployment `READY`. The public
site and its search index are served from that snapshot — so readers never see a
half-written page, and rolling forward is atomic.

**Same-origin auth:** the dashboard proxies `/api/**` to the server (via Nitro),
so better-auth session cookies stay first-party with no CORS dance.

## Tech stack

TanStack Start · React 19 · Hono · better-auth · Prisma · PostgreSQL · BullMQ ·
Dragonfly · Orama · shadcn/ui (Base UI) · Tailwind CSS v4 · Zod · Pino · tsdown · Vite.

## Local development

Prerequisites: Node ≥ 22, pnpm 10, Docker.

```bash
pnpm install
cp .env.example .env

# start infra only (Postgres, Dragonfly, maxio)
docker compose -f docker-compose.dev.yml up -d

# create the schema + seed a demo workspace
pnpm db:deploy      # or: pnpm db:migrate  (creates a new migration)
pnpm db:seed

# run server + worker + app (www: pnpm dev:full)
pnpm dev
```

| App        | URL                          |
| ---------- | ---------------------------- |
| Dashboard  | http://localhost:4310        |
| API + docs | http://localhost:4311/docs   |
| Worker ops | http://localhost:4312/jobs   |
| Marketing  | http://localhost:4313        |

Demo login: `demo@plume.dev` / `plumedemo123`.

## Useful scripts

| Command             | Description                                   |
| ------------------- | --------------------------------------------- |
| `pnpm dev`          | server + worker + dashboard (watch mode)      |
| `pnpm build`        | build every app and package                   |
| `pnpm typecheck`    | type-check the whole workspace                |
| `pnpm db:migrate`   | create + apply a Prisma migration (dev)       |
| `pnpm db:deploy`    | apply migrations (production)                 |
| `pnpm db:seed`      | seed the demo workspace + published site      |
| `pnpm db:studio`    | open Prisma Studio                            |

## Configuration

All configuration is via environment variables — see [`.env.example`](.env.example).
Storage is S3-compatible, so swap maxio for Cloudflare R2, AWS S3, or Backblaze B2
by changing the `STORAGE_*` variables. For production, set strong values for
`BETTER_AUTH_SECRET`, `POSTGRES_PASSWORD`, and `STORAGE_SECRET_KEY`, and serve the
apps behind a TLS-terminating reverse proxy.

### Production

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for the full production guide (secret
generation, required `.env` vars behind a domain, an nginx reverse-proxy example,
keeping datastore ports private, and a security checklist).

Production **must** set `BETTER_AUTH_SECRET`, `POSTGRES_PASSWORD`, and
`STORAGE_SECRET_KEY`. When `NODE_ENV=production`, the container entrypoint refuses
to start (`exit 1`) if `BETTER_AUTH_SECRET` is empty or left at a known demo
default — generate one with `openssl rand -hex 32`.

## License

MIT.
