# Contributing to Midad

Thanks for your interest in improving Midad — the open-source, self-hostable
documentation platform. This guide covers how to get a local environment running
and the conventions we follow.

## Licensing of contributions

Midad is licensed under the **GNU Affero General Public License v3.0**
([LICENSE](LICENSE)). By submitting a contribution (a pull request, patch, or any
other change) you agree that your contribution is licensed under the AGPL-3.0,
the same license as the project. We do not require a separate CLA; the
[Developer Certificate of Origin](https://developercertificate.org/) (DCO) is
implied — only submit work you have the right to contribute.

## Development setup

Requirements: **Node ≥ 22.13**, **pnpm ≥ 10**, and **Docker** (for Postgres, the
cache, and S3-compatible storage).

```bash
git clone https://github.com/midad-docs/midad
cd midad
cp .env.example .env
echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)" >> .env

pnpm install

# Bring up the datastores (Postgres, Dragonfly, maxio):
docker compose up -d postgres dragonfly maxio

# Apply migrations and seed a local demo account (demo@midad.dev / midaddemo123):
pnpm db:deploy
pnpm db:seed

# Run the app, API, and worker in watch mode:
pnpm dev
```

- Dashboard: http://localhost:4310
- API + OpenAPI docs: http://localhost:4311/docs
- Marketing site: http://localhost:4313

Alternatively, run the whole stack in containers with `docker compose up -d --build`.

## Before you open a PR

Run the same checks CI runs and make sure they pass:

```bash
pnpm typecheck   # turbo run typecheck
pnpm lint        # biome check .
pnpm test        # vitest across the workspace
pnpm format      # biome format --write . (auto-fix formatting)
```

## Conventions

- **Monorepo** (pnpm + turbo). Apps live in `apps/*`, shared libraries in
  `packages/*`, all scoped `@midad/*`.
- **Content is Markdown end-to-end.** `Page.content` is a Markdown string that
  feeds search, the table of contents, excerpts, and the live site. The editor
  round-trips Markdown — never persist ProseMirror/TipTap JSON.
- **i18n is first-class.** New user-facing strings must be added to *both* the
  English and Arabic dictionaries (`apps/app/src/lib/i18n/messages.ts`), and the
  UI must work in RTL. Use logical CSS properties (`ms-*`/`me-*`, `start`/`end`).
- **Commits**: short, imperative, scoped (e.g. `editor: fix slash menu in RTL`).
- **Tests**: add or update tests for behavior changes. Pure logic lives in
  `packages/*` and is the easiest to cover.

## Reporting bugs & requesting features

Use the GitHub issue templates. For security issues, **do not** open a public
issue — see [SECURITY.md](SECURITY.md).
