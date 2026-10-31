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

# Apply migrations and seed a local demo account (demo@nibleaf.test):
pnpm db:deploy
pnpm db:seed

# Run the app, API, and worker in watch mode:
pnpm dev
```

- Dashboard: http://localhost:4310
- API + OpenAPI docs: http://localhost:4311/docs

The demo account uses the same email-code sign-in as the product. With no email
provider configured, open the local worker's job dashboard at
http://localhost:4312/jobs and read the code in the latest email job's data.
The seed creates the workspace and published starter idempotently.

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

Documentation lives under [`docs/`](docs/README.md), with reader navigation in
`docs/docs.json`. Run `pnpm docs:check` after changing a page or the navigation.
The [documentation contribution guide](docs/contributing/documentation.mdx)
covers content types, product-truth checks, visual review, and publication to
the canonical site.

## Conventions

- **Monorepo** (pnpm + turbo). Apps live in `apps/*`, shared libraries in
  `packages/*`, all scoped `@nibleaf/*`.
- **Content is Markdown end-to-end.** `Page.content` is a Markdown string that
  feeds search, the table of contents, excerpts, and the live site. The editor
  round-trips Markdown — never persist ProseMirror/TipTap JSON.
- **i18n is first-class.** New user-facing strings must be added to *both* the
  English and Arabic Paraglide catalogs (`packages/i18n/messages/*.json`), and
  the UI must work in RTL. Use logical CSS properties (`ms-*`/`me-*`, `start`/`end`).
- **Commits**: short, imperative, scoped (e.g. `editor: fix slash menu in RTL`).
- **Tests**: add or update tests for behavior changes. Pure logic lives in
  `packages/*` and is the easiest to cover.

## Reporting bugs & requesting features

Use the GitHub issue templates. For security issues, **do not** open a public
issue — see [SECURITY.md](SECURITY.md). For support and community questions, see
[SUPPORT.md](SUPPORT.md).

## GitHub release notes

Release notes use pinned `changelogithub@14.0.0` through `pnpm release:notes:engine`.
`pnpm release:notes` composes the reviewed highlights and publishes **Nibleaf vX.Y.Z**
for the current tag. It never edits an already published release's title or notes;
retries still upload the verified self-host assets. An existing draft is completed.
This is separate from the manual Docker image build and deployment process.

In the release PR, rename `## Unreleased` in `CHANGELOG.md` to `## vX.Y.Z` and
fill its `### Highlights` block with one to three plain user-facing sentences.
Empty blocks (including comment-only blocks) fail with instructions. Publishing
requires the version section; only dry runs fall back to `## Unreleased`.
Keep `release/self-host.json` aligned with the tag and run `pnpm release:check`
and `pnpm self-host:check` before tagging through the owner's release process.
Before creating a tag, run the dry command below against the exact release PR
head (`--to HEAD`) with its intended `--version`. Resolve every Highlights fallback
warning: the version heading must exist for publishing; Unreleased is only a
preview fallback. Final releases select the previous non-prerelease version tag;
prerelease versions may select a preceding candidate. `--from` overrides selection.

With full Git history and an authenticated `gh` session (CI uses its existing
`GITHUB_TOKEN`), preview without publishing:

```bash
pnpm release:notes:dry -- --from v0.1.2 --to origin/main --version v0.2.0
```

Use `--output notes.md` to save the composed Markdown. The same command runs in
CI on Linux in a temporary checkout with sample Highlights prose, using HEAD
instead of origin/main. That smoke run exercises GitHub account/release reads,
`gh api --paginate --slurp`, and the nested pinned engine call without publishing.
Its temporary prose is a fixture, not reviewed release copy. The existing
read-only `GITHUB_TOKEN` is used; permissions are not widened. Non-conventional
commits warn in the log. The
folded full changelog lists conventional commits; counts cover all non-bot
commits. The short Fixes section includes fix commits with PR numbers; direct
fix commits remain in the full changelog. Contributors include human co-authors, resolve GitHub logins across
email addresses, exclude bots and AI identities, and mark people absent from
history through the previous tag as first-time contributors. Unresolved people
are credited by name and deduplicated by email. PR titles follow Naasher's
conventional-title check, including `chore(deps): ...` for Dependabot.

The non-human identity policy is defined beside `isPerson` in the script:
GitHub accounts of type Bot, `[bot]` markers, Dependabot/GitHub Actions automation
addresses, all `@openai.com` addresses, and `noreply@anthropic.com`,
`noreply@cursor.com`, `noreply@githubcopilot.com`. Display names such as Claude or
Bot alone never exclude a person. Unresolved names cannot create @mentions.
Fixes are deduplicated and HTML-escaped. A fork's `(#N)` in a squash subject is
interpreted as this repository's PR number N, not a link to the fork's PR.
