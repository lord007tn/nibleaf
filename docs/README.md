# Nibleaf documentation source

This directory is the reviewable source bundle for Nibleaf's product and
self-hosting documentation. `docs.json` defines the reader-facing hierarchy;
the Markdown and MDX pages are portable content that Nibleaf can import from
this public repository.

English pages keep their existing paths and Arabic counterparts mirror them
under `ar/`. Every public page declares `lang`, `dir`, and a shared
`translation_key`; `docs.json` keeps the two navigation trees in exact order.
Use [`ARABIC_GLOSSARY.md`](ARABIC_GLOSSARY.md) as the internal terminology
authority when reviewing Arabic changes. It deliberately stays out of public
navigation.

The hosted site at [docs.nibleaf.com](https://docs.nibleaf.com) is published
from Nibleaf's database. Treat a change as complete only after the source is
reviewed, imported or synchronized into the documentation project, published,
and checked on the canonical domain. Keeping the source here makes the content
recoverable and gives product changes a reviewable documentation diff.

## Content model

Every navigated page declares one primary audience and one content type:

- `tutorial`: a guided first success with minimal choices;
- `how-to`: a goal-oriented procedure that assumes basic familiarity;
- `reference`: complete, scannable facts such as settings and endpoints;
- `explanation`: concepts and product boundaries that support decisions.

Pages start with the outcome, state prerequisites before commands, explain how
to verify success, and include recovery steps when failure is plausible. Use
screenshots only when a control or state is genuinely hard to locate; text must
remain sufficient for accessibility and maintenance.

## Validate a change

From the repository root, run:

```bash
pnpm docs:check
```

The documentation check rejects invalid navigation, orphaned pages, missing
maintenance metadata, broken local links, skipped heading levels, language-tree
or translation-key mismatches, and different fenced code in a translation pair.
It does not verify product claims or prove the hosted site has changed. An app
build is a separate check when rendering code changes; plain text edits need the
documentation check and a content review. Before
publishing, also follow the review and visual checks in
[`contributing/documentation.mdx`](contributing/documentation.mdx).

Record whether a claim describes the pinned self-host release or the current
source. `release/self-host.json` pins v0.2.1 and the hash of
`docker-compose.prod.yml`; that file has no ClickHouse service. The source
quickstart and Coolify files have a different service inventory. A variable in
`.env.production.example` reaches a container only if its Compose environment
passes it. Verify the schema default and that wiring separately.

## Sources and maintenance

The structure follows the task, concept, reference, and tutorial separation
described by the [Diátaxis framework](https://diataxis.fr/) and the audience,
navigation, style, media, SEO, and maintenance practices in the
[Mintlify documentation guide](https://www.mintlify.com/guides/introduction).
These sources inform the method only; Nibleaf's wording and product claims are
verified against this repository.
