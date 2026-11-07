# JavaScript bundle budget

Public documentation pages have a 365,000-byte gzip JavaScript budget. The
budget applies to each representative direct-navigation profile in
`scripts/check-bundle-budget.mjs` and keeps a small regression buffer above the
measured size. CI also rejects public profiles that contain known
dashboard/auth chunks, dashboard translation keys, marketing or blog modules, or
marketing and blog copy from the English and Arabic catalogs.

## Reproduce the report

```sh
BUNDLE_ANALYZE=true pnpm build:app
pnpm --filter @nibleaf/app bundle:report
pnpm --filter @nibleaf/app bundle:check
```

CI builds with `BUNDLE_ANALYZE=true`, so the check can also reject forbidden
modules by path. Without that report the module check is skipped locally (and
fails in CI); the copy check still runs.

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

## Import boundaries

Every route file's non-split parts, `validateSearch`, `beforeLoad`,
`loader`, `head`, and anything the file exports, sit in the router's eager
chunk, which every page loads, published docs included. So:

- Export only `Route` from a route file (a `head` factory is fine). Put page
  components in `src/components/**`: an exported component keeps its whole
  import graph eager, because the router's code splitter can't drop exports.
- Keep heavy or page-specific copy out of `head`. A loader can import it
  lazily and hand it to `head` through `loaderData` (see
  `src/lib/arabic-marketing-copy.ts`).
- Loaders import only i18n-free factory modules (`DATA_LOADING.md`).

## Budget history

### 393,000 → 365,000 bytes: marketing out of the reader (#291)

Measured with `pnpm --filter @nibleaf/app bundle:report` on production builds
(gzip level 9):

| Build | public-docs | public-docs-index |
| --- | --- | --- |
| main@ed15240e | 383.79 KiB | 382.99 KiB |
| this change | 352.57 KiB | 351.76 KiB |

Two leaks put the marketing site into every published docs page:

- **Exported page components, ~30 KiB.** `routes/about.tsx` and
  `routes/developers.tsx` exported their page components for tests. The
  router's code splitter keeps exports in the eager route module, so
  `cloud-marketing.tsx` (the landing page and marketing shell, 13.8 KiB) came
  in with its imports: the blog manifest (11 KiB), its Arabic copy, the privacy
  choices dialog and several icons. The components now live in
  `components/marketing/`.
- **Arabic marketing head copy, ~0.5 KiB.** The `/ar` and
  `/ar/documentation-platforms` heads read seven long Arabic strings through
  `siteT`, the reader's own translator, and a Vite group pinned them to the
  reader's eager messages chunk. The routes' loaders now import the copy lazily.

Still eager, and small: `lib/marketing-seo.ts`, `lib/blog-seo.ts` and
`lib/marketing-faqs.ts` (about 2.5 KiB), because marketing routes' `head`
functions use them.

### 390,000 → 393,000 bytes: Ask AI chat assistant (#279)

Measured with `pnpm --filter @nibleaf/app bundle:report` on production builds
(gzip level 9):

| Build | public-docs | public-docs-index |
| --- | --- | --- |
| main@50124dba (#281 reader search) | 377.09 KiB | 376.29 KiB |
| #279 merged on 50124dba | 380.65 KiB | 379.84 KiB |
| main@178fc83d (#288 dashboard conventions) | 378.56 KiB | 377.76 KiB |
| #279 merged on 178fc83d | 382.12 KiB | 381.32 KiB |
| main@e1244b8f (#280 support MCP, +1.41) | 379.97 KiB | 379.17 KiB |
| #279 merged on e1244b8f | 383.51 KiB | 382.70 KiB |

The budget was first raised to 392,000 bytes against main@178fc83d; #280 then
grew main by 1.41 KiB (new routes in the route tree, an `mcp` chunk, query keys),
so it was set to 393,000 bytes. #279's own cost, about +3.54 KiB, is:

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

Before this work, the chat had cost +7.6 KiB with its strings and launcher eager.
Not adopted: opting the provider out of the React Compiler, injecting
Button/Sheet into lazy chunks, or a global Rolldown chunk group. Each saves
under 1 KiB at the cost of a fragile build.

This budget is a ceiling, not a target. [#291](https://github.com/lord007tn/nibleaf/issues/291)
brings the public bundle back to 375 KiB or less by keeping dashboard-only routes
and schemas out of the reader bundle.
