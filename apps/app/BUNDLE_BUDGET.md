# JavaScript bundle budget

Public documentation pages have a 390,000-byte gzip JavaScript budget. The
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
