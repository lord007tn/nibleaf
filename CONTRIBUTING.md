# Contributing to Nibleaf

Thanks for your interest in improving Nibleaf — the open-source, self-hostable
documentation platform. This guide covers how to get a local environment running
and the conventions we follow.

## Licensing of contributions

Nibleaf is licensed under the **GNU Affero General Public License v3.0 only**
(`AGPL-3.0-only`; see [LICENSE](LICENSE)). By submitting a contribution (a pull
request, patch, or any other change), you agree that it is licensed under the
same `AGPL-3.0-only` terms as the project and certify that you have the right to
submit it. Nibleaf does not require a separate contributor license agreement or
Developer Certificate of Origin sign-off.

## Development setup

Requirements: **Node ≥ 22.13**, **pnpm ≥ 10**, and **Docker** (for Postgres, the
cache, and S3-compatible storage).

```bash
git clone https://github.com/lord007tn/nibleaf.git
cd nibleaf
cp .env.example .env

pnpm install
pnpm db:generate

# Bring up the datastores (Postgres, Dragonfly, maxio):
docker compose -f docker-compose.dev.yml up -d

# Apply migrations and seed a local demo account (demo@nibleaf.test / nibleafdemo123):
pnpm db:deploy
pnpm db:seed

# Run the app, API, and worker in watch mode:
pnpm dev
```

- Dashboard: http://localhost:4310
- API + OpenAPI docs: http://localhost:4311/docs

For a production-style installation, use the pinned-image path in the
[self-hosted quickstart](https://docs.nibleaf.com/getting-started/self-hosted)
instead of the development stack above.

## Before you open a PR

Run the same checks CI runs and make sure they pass:

```bash
pnpm format      # biome format --write . (auto-fix formatting)
pnpm typecheck   # turbo run typecheck
pnpm lint        # biome check .
pnpm test        # vitest across the workspace
```

## Conventions

- **Monorepo** (pnpm + turbo). Apps live in `apps/*`, shared libraries in
  `packages/*`, all scoped `@nibleaf/*`.
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
issue — see [SECURITY.md](SECURITY.md). For support and community questions, see
[SUPPORT.md](SUPPORT.md).
