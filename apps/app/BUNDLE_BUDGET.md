# JavaScript bundle budget

Public documentation pages have a 345,100-byte gzip JavaScript budget. The
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
with each chunk's rendered modules and dynamic imports. With that report, the
public profiles also print `non-reader route modules`: the rendered bytes of
route files other than `__root.tsx` and `routes/sites/**` that every published
docs page still loads, because every route's definition is in the route tree.

## Updating the budget

Treat a failure as a routing or import-boundary regression first. The command
prints the largest assets, and the analysis report identifies modules inside
them. Increase the threshold only when an intentional public feature justifies
the transfer cost, and record the new measured route totals in the pull request.

## Import boundaries

Every route file's non-split parts, `validateSearch`, `beforeLoad`, `head`,
and anything the file exports, sit in the router's eager chunk, which every
page loads, published docs included. Loaders are split for every route except
the root and the reader under `/sites/` (`READER_ROUTE` and `splitBehavior` in
`vite.config.ts`), so they load with their route, and each route's preloads
include that chunk. So:

- Export only `Route` from a route file. Put page components in
  `src/components/**`: an exported component keeps its whole import graph
  eager, because the router's code splitter can't drop exports.
- Add a marketing page to the marketing route table, not to `src/routes`. A
  page is a module in `components/marketing/pages/` that exports `load` (its
  data and the `head` it renders) and `Page` (which reads that data with
  `useMarketingData`), listed in `MARKETING_ROUTES`
  (`components/marketing/routes.tsx`). The router holds only nine thin
  marketing routes (`/`, `/$page`, `/blog/$slug`, `/compare/$slug`,
  `/alternatives/$slug`, `/use-cases/$slug`, `/tools/$slug`, `/ar/$page`,
  `/ar/use-cases/$slug`) that dispatch into it, so a new page adds nothing to
  what published docs load. Add a router route only for a new URL shape, with a
  static first segment: a route like `/$section/$slug` would also catch unknown
  dashboard URLs such as `/app/xyz`.
- A page's `load` imports the helpers it needs (`lib/marketing-seo.ts`,
  `lib/blog-seo.ts`, page copy) lazily, and builds the head there.
- Keep `validateSearch` and `beforeLoad` small: check ids against a plain list,
  not a list of icons and labels, and import anything larger lazily.
- Loaders import only i18n-free factory modules (`DATA_LOADING.md`).
- Code-split content that the server renders on reader pages is a hydration
  module rendered in a `HydrationIsland`
  (both in `src/lib/hydration-modules.tsx`), not `React.lazy`. A lazy component
  suspends while hydrating even when its chunk is cached, and a re-render above
  it then swaps the server HTML for the fallback (READER-03: a blank article and
  0.33 CLS). An island never suspends in the browser: until its module loads,
  hydrating keeps the server HTML as sent, a client navigation shows its pending
  and failed states (never the route's error page), and the module retries a
  bounded number of times, from an effect.
  - The article and rich (HTML/math) renderers, declared in
    `src/lib/reader-hydration-modules.ts`, also load before hydration: their
    islands carry `data-hydration-module`, and the router's `hydrate` hook
    loads the ones it finds. They stay out of the first-load preloads and load
    only on pages that render them. The reader's loaders import the
    declarations lazily, because the loaders sit in the eager chunk.
  - Code in a language outside the article renderer's core highlight.js
    grammars (`CORE_HIGHLIGHT_GRAMMARS` in
    `src/components/site/reader-highlight.ts`: Bash/shell, JS/TS, JSON,
    HTML/XML, CSS, Python, YAML, SQL, Markdown, diff, GraphQL, plain text)
    loads that grammar per article, one chunk each
    (`src/components/site/highlight-grammars.ts`). `lazyHighlightLanguages`
    (`src/lib/highlight-languages.ts`) finds them in the content; the article's
    island lists their keys (`hljs-rust`, space-separated) so the router's hook
    loads them before hydrating, and the server waits for them. Together the
    two sets are exactly lowlight's `common` set, which rehype-highlight used,
    and `reader-highlight.test.ts` checks the output matches rehype-highlight's
    for every language.
  - The rich renderer's check (`needsRichMarkdown`) ignores fenced code and
    single-line inline code: a `<div>` or `$HOME` in a code sample used to load
    parse5 and KaTeX.
  - The Ask AI launcher and card keep their server markup until a reader
    reaches for them (`loadOnIntent`: pointer, touch or focus), and a click
    that comes first is replayed once the chat loads. A search hand-off, an
    `?ask=` link or a site that asks for analytics consent (whose launcher
    isn't in the server markup) loads it at once. A router import of the chat
    would let Rolldown re-split the consent modules it shares with the reader
    (about 250 B gzip).
- Controls whose code only matters once opened render a static trigger with
  the same markup and load on intent (`src/lib/intent-module.ts`): the header's
  language and version menus (`header-menus.tsx`), the phone drawer
  (`mobile-nav-drawer.tsx`) and the search dialog (on pointer, touch, focus or
  the shortcut; never on idle). A click before the code has loaded opens the
  control once it has. Don't import a Base UI popup (menu, dialog, sheet,
  select, popover, scroll area) from reader code that renders on first paint:
  their floating-ui positioning and focus management are about 60 KiB gzip.
- The reader's first-paint Lucide icons are two chunks, not one per icon:
  `site-icons` and `site-shared-icons` (the icons marketing also uses), built
  by `readerIconGroups` (`scripts/reader-icons.ts`) from the imports of the
  files in `READER_ICON_SOURCES`. Add a file there when a new first-paint
  reader module imports icons.

- Marketing code doesn't import a Lucide icon the reader also uses. Rolldown
  groups shared modules by the chunks that import them, so a new importer
  re-splits the reader's icon chunks (#332 measured +292 B gzip with no reader
  change). Use a copy in `components/marketing/site/marketing-icons.ts`.
  `bundle:check` fails on a reader icon that a marketing chunk imports unless it
  is one of the icons already shared on main@88daac87
  (`marketingSharedReaderIcons` in `scripts/bundle-boundaries.mjs`).
- Dashboard chunk names stay out of the router's eager chunk. For each lazy
  import, Vite writes the chunks to preload with it into a `__vite__mapDeps`
  table in the importing chunk, and the router's eager chunk imports every
  route lazily, so before #393 every dashboard chunk name shipped to published
  docs. `dashboardPreloadPlugin` (`scripts/dashboard-preload-plugin.ts`) gives
  dashboard routes (`src/routes/app/**`) an empty list there.
  `bundle:check` fails with "dashboard chunk names leak into the published-docs
  eager preload list" when a public chunk's table names a chunk whose every
  module is dashboard code (`routes/app/`, `hooks/api/`, or
  `components/{app,project,project-settings,settings,analytics,ai-conversations}/`)
  and that none of the chunk's non-dashboard lazy imports load: sign-in,
  invitations and OAuth consent use some of the same data hooks, so those stay
  listed (`leakedDashboardPreloads` in `scripts/bundle-boundaries.mjs`; it
  needs the `BUNDLE_ANALYZE=true` report, like the module check).
- Dashboard navigations get their preloads from the dashboard instead. The
  client build writes `dashboard-preloads.json` (site root): for each dashboard
  route id, every chunk its split parts load (each chunk and its static
  imports, minus what the entry already loads). The signed-in shell
  (`routes/app/route.tsx`) calls `useDashboardIntentPreload`
  (`src/lib/dashboard-intent-preload.ts`), which fetches that file when the
  browser is idle (production only, with `cache: 'no-cache'`: the file's name has
  no hash and `/assets/` is cached as immutable, and a per-build query string would
  rename reader chunks on every build, because the shell chunk that carries it is
  named in the router's eager chunk) and, when the pointer or focus reaches a same-origin
  `/app…` link, adds `<link rel="modulepreload">` for the chunks of every route
  the link matches, each once. Without it, the router's intent preload fetches
  a route chunk and then its imports one level at a time. A failed or missing
  file only leaves navigation to the router. The module is listed in
  `forbiddenPublicModules`, so docs pages can't start loading it.

## Budget history

### 345,100 bytes, unchanged: reader first load trimmed (READER-05)

Measured on production builds with `BUNDLE_ANALYZE=true` (gzip level 9), main@03c84760:

| Build | public-docs | public-docs-index | JS files (all modulepreloads) | article renderer before hydrating |
| --- | --- | --- | --- | --- |
| main@03c84760 | 334.32 KiB | 333.14 KiB | 107, 42 of them single icons | +12 files, 115.11 KiB |
| this change | 264.92 KiB | 264.16 KiB | 51, 2 icon chunks | +13 files, 88.16 KiB |

- **Header menus and the phone drawer, about 60 KiB.** Base UI's menu, dialog
  and scroll area with floating-ui load on intent behind static triggers.
- **Icons, about 6 KiB and 40 requests.** Two icon chunks instead of one per icon.
- **highlight.js, about 27 KiB of the article renderer.** 14 core grammars up
  front; the other 23 of lowlight's common set load per article.
- **Off the load entirely:** the search dialog (was idle-preloaded, now on
  intent), the chat UI (now on intent), parse5 and KaTeX on pages whose only
  HTML or `$` is in code, and mermaid until a diagram is near the viewport.

The budget stays at 345,100 bytes, leaving about 72 KiB of headroom.

### 348,200 → 345,100 bytes: dashboard preload lists out of the eager chunk (#393)

The router's eager `index` chunk carried `__vite__mapDeps`: the dependency
chunk names of every lazy route, dashboard routes included (343 entries, ~11 KB
raw). Dashboard routes now get no preload list there
(`scripts/dashboard-preload-plugin.ts`), and the signed-in shell preloads a
route's chunks on hover or focus from `/dashboard-preloads.json`. It is rewritten by every build under the same
name, so it is served outside the immutable `/assets/` with `public, max-age=60, must-revalidate`.

Measured against main@bae70857 (analyzed builds, gzip level 9):

| Build | public-docs | public-docs-index | eager `index` chunk (raw) |
| --- | --- | --- | --- |
| main | 345,985 B (337.88 KiB) | 337.07 KiB | 311,499 B |
| this change | 343,096 B (335.05 KiB) | 334.25 KiB | ~299,000 B |

Dashboard navigation, production build, 100 ms round trip, time from click to
the last chunk (one request wave on both builds):

| Navigation | main | this change |
| --- | --- | --- |
| sites → site overview (250 ms hover) | 682 ms | 490 ms |
| site overview → analytics (250 ms hover) | 367 ms | 172 ms |
| sites → site overview (no hover) | 940 ms | 804 ms |
| site overview → analytics (no hover) | 645 ms | 497 ms |

The budget is the 343,096 bytes plus the usual ~2 KiB margin. The guard in
`check-bundle-budget.mjs` fails when a dashboard-only chunk name reaches a
public profile's preload table again.

### 349,700 → 348,200 bytes: a marketing route table (#345)

Measured first, on this change's base: building without the 29 marketing route
files (their pages removed outright) gave the upper bound of what moving
marketing out of the router could save.

| Build | public-docs | public-docs-index | non-reader route modules |
| --- | --- | --- | --- |
| before (29 marketing route files) | 340.31 KiB | 339.51 KiB | 58, 30.39 KiB rendered |
| marketing route files deleted (upper bound) | 335.49 KiB | 334.69 KiB | 33, 18.26 KiB rendered |
| marketing route table, nine thin routes | **338.01 KiB** | **337.21 KiB** | 42, 22.46 KiB rendered |

- The marketing definitions cost published docs pages 4.82 KiB gzip; the
  table takes back 2.30 KiB of it. The nine routes left are about 480 B
  rendered each.
- The rest of the upper bound is chunk grouping: marketing pages still share
  chunks (icons, UI parts) with the reader, which only deleting them removes.
- One root splat (`/$`) would save a little more, but it would also take over
  unknown dashboard URLs, which today 404 inside their own layout, so every
  marketing route keeps a static first segment.
- URLs, heads and the sitemap are unchanged. Before the move, every head of the
  66 sitemap URLs was captured from the old routes' loaders, and after it the
  table's loaders rendered all 66 byte-identical. `routes.test.ts` checks that
  every sitemap URL reaches a marketing route through the router (on the tree
  rebuilt from `routeTree.gen.ts`), has a self canonical and `og:url`, and that
  the table and sitemap list the same pages.
- The guard below found one icon marketing already shared that it hadn't seen:
  `circle-question-mark`, from the RTL grader, which lived under `src/routes`.

The budget is the 346,122 bytes measured for public-docs plus the same ~2 KiB
margin (2,078 bytes of headroom).

### Icon re-split guard (#345)

`bundle:check` now also fails when marketing code starts sharing a reader icon
(see Import boundaries). It changes no shipped code.

### 356,000 → 349,700 bytes: marketing heads and non-reader loaders (#345)

| Build | public-docs | public-docs-index |
| --- | --- | --- |
| main@afd79476 | 346.32 KiB | 345.51 KiB |
| this change | 339.26 KiB | 338.46 KiB |
| this change with main@26c089c0 (#336's two use-case routes, +0.21 KiB) | 339.47 KiB | 338.67 KiB |

Each step, measured on main@831657aa (346.35 and 345.55 KiB):

| Build | public-docs | public-docs-index |
| --- | --- | --- |
| loaders split for non-reader routes only | 346.15 KiB | 345.35 KiB |
| marketing heads built in loaders only | 341.74 KiB | 340.94 KiB |
| both | 339.24 KiB | 338.43 KiB |

- **Marketing heads, ~4.6 KiB.** Marketing routes called `pageMeta`,
  `breadcrumbLd` and `faqLd` in `head`, and imported `getGithubStarsFn` and
  `loadComparisonData` for their loaders (`/` and `/ar` already built their
  head in `copy/landing-head.ts`, but imported `getGithubStarsFn`). That kept
  `lib/marketing-seo.ts`, `lib/marketing-organization.ts`,
  `functions/marketing.ts`, `lib/comparison-loader.ts` and `lib/blog-seo.ts`
  in every page. `/contact`'s head also shared its contact list with the page,
  which pulled four page icons (`life-buoy`, `lock-keyhole`, `shield-check`,
  `triangle-alert`) into the eager chunk. Each route now has a private head
  builder that its loader calls after importing the helpers lazily, and the
  `/compare` and `/alternatives` pages share `lib/comparison-page.ts`. The
  `<head>` output is unchanged: the meta, links and JSON-LD of 22 marketing
  routes matched `main` exactly, and the blog article head still comes from
  `articleHead`.
- **Non-reader loaders, ~2.5 KiB more.** `splitBehavior` now splits the loader
  of every route except `__root__` and `/sites/**`, not only the dashboard's.
  On its own this saves only 0.20 KiB, because `head` kept the helpers eager;
  with heads in the loaders, the head strings move out as well. Non-reader
  route modules in the public profile went from 40.3 KiB (main@afd79476) to
  28.6 KiB rendered. What's left is mostly the route tree's lazy-chunk
  references; taking the routes out of the tree is #345's third option.

Still in the public profile, and needed there:

- `deploy_close`: the reader's mobile navigation close label. It's in the
  dashboard namespace and has its own chunk because the dashboard shares it; a
  site copy would carry the same twelve translations.
- Lucide icon chunks such as `settings`, `bell`, `users`, `chart-column`,
  `house`, `pen-line`, `info`, `file-text` and `life-buoy`: the icons site
  authors can give their pages (`components/site/page-icon.tsx`). `book-open`
  and `languages` are the reader layout's. They're split into small chunks
  because dashboard and marketing code import them too.

The module check now also rejects `lib/marketing-*` (except
`lib/marketing-analytics-route.ts`, which the root route uses to decide whether
to load marketing analytics), `lib/comparison-*`, `lib/blog-seo.ts` and
`functions/marketing.ts`. Against main@afd79476 it reports five forbidden
modules. The patterns live in `scripts/bundle-boundaries.mjs`, and
`scripts/bundle-boundaries.test.mjs` checks them against a fixture module list.

The budget is the 347,620 bytes measured for public-docs after merging main with
#336, plus a ~2 KiB margin (2,080 bytes of headroom).

### 365,000 → 356,000 bytes: dashboard code out of the reader (#291)

| Build | public-docs | public-docs-index |
| --- | --- | --- |
| marketing boundary (#295) | 352.57 KiB | 351.76 KiB |
| this change | 344.13 KiB | 343.33 KiB |

- **Dashboard loaders, ~7.2 KiB.** Their query factories, analytics insight
  queries, deployment cache helpers and prefetch helpers were eager because
  loaders aren't split by default. Routes under `/app`, `/(auth)`,
  `/accept-invite` and `/oauth` now split `loader` into its own chunk.
- **Settings search checks, ~0.6 KiB.** The two settings routes validated
  `?section=` and `?tab=` against their nav lists, which carry 21 icons. They
  now check a plain id list.
- **MCP OAuth helpers, ~0.6 KiB.** The `/(auth)` layout's `beforeLoad` imports
  `lib/mcp-oauth.ts` (and the shared MCP scope tables) lazily; the auth pages
  load it anyway.

The module check now also rejects dashboard query factories, dashboard
components, `lib/mcp-oauth.ts` and `@nibleaf/shared`'s `mcp`/`rbac` modules.
Against main@ed15240e it reports 20 forbidden modules. Still eager: the query
key factory (`hooks/api/query-keys.ts`, shared with the reader's own queries) and
the analytics and AI search validators.

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
