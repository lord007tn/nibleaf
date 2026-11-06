# JavaScript bundle budget

Public documentation pages have a 392,000-byte gzip JavaScript budget. The
budget applies to each representative direct-navigation profile in
`scripts/check-bundle-budget.mjs` and keeps a regression buffer above the
August 2026 baseline. CI also rejects public profiles that contain known
dashboard/auth chunks or dashboard translation keys.

## Reproduce the report

```sh
pnpm build:app
pnpm --filter @nibleaf/app bundle:report
pnpm --filter @nibleaf/app bundle:check
```

The reporter reads TanStack Start's generated server manifest. For each route
profile it collects the unique JavaScript scripts and preloads across the exact
route ancestry, then reports raw bytes and gzip level-9 bytes without
double-counting shared assets. This measures what a production direct
navigation is instructed to fetch; it does not estimate size from source code.

For module-level attribution, build with `BUNDLE_ANALYZE=true`. The opt-in Vite
plugin writes `.bundle-analysis/client-modules.json`, outside deployed output,
with each chunk's rendered modules and dynamic imports.

## Updating the budget

Treat a failure as a routing or import-boundary regression first. The command
prints the largest assets, and the analysis report identifies modules inside
them. Increase the threshold only when an intentional public feature justifies
the transfer cost, and record the new measured route totals in the pull request.

## Budget history

### 390,000 → 392,000 bytes: Ask AI chat assistant (#279)

Measured with `pnpm --filter @nibleaf/app bundle:report` on production builds
(gzip level 9):

| Build | public-docs | public-docs-index |
| --- | --- | --- |
| main@50124dba (#281 reader search) | 377.09 KiB | 376.29 KiB |
| #279 merged on 50124dba | 380.65 KiB | 379.84 KiB |
| main@178fc83d (#288 dashboard conventions) | 378.56 KiB | 377.76 KiB |
| #279 merged on 178fc83d | 382.12 KiB | 381.32 KiB |

The +3.56 KiB over main@178fc83d is:

- **Eager chat context, ~0.95 KiB.** The reader layout's provider, which queues
  "open the chat" requests from search and the end-of-article card. The panel,
  launcher, card, panel state, `?ask=` deep link and every chat string
  (`siteChatT`) load lazily, through a small loader so the panel's preload list
  stays out of the eager chunk.
- **Route tree, ~0.77 KiB.** The AI dashboard route's `validateSearch` (a zod
  schema; a hand-written check came out larger), the reader's `ask` param, and
  the settings loader's search-section prefetch. Every page loads route options.
- **Shared-chunk re-splitting, ~1.6 KiB.** Lazy chat chunks share reader modules
  (Button and Sheet internals, `useMutation` and query-core, a thumbs icon), so
  Rolldown moves them out of the chunks they shared into smaller ones. The
  bytes are the same; the extra chunks compress less well. Removing the legacy
  answer view (`useAnswerSite`) also changed `useMutation`'s importers.

Before this, the chat had cost +7.6 KiB with its strings and launcher eager.
Not adopted: opting the provider out of the React Compiler, injecting
Button/Sheet into lazy chunks, or a global Rolldown chunk group. Each saves
under 1 KiB at the cost of a fragile build.

