# Server-rendered interface locale: before/after captures

`capture.mjs` records what #546 changes for a visitor whose interface language
is Arabic, against production builds of the app and API:

- layout shifts (`PerformanceObserver` `layout-shift`, `buffered: true`, shifts
  with `hadRecentInput` excluded) on the marketing home, `/sign-in`, `/sign-up`
  and the signed-in dashboard (`/app`), for an English visitor, an Arabic
  visitor with only `Accept-Language: ar`, and an Arabic visitor with the
  `NIBLEAF_LOCALE=ar` cookie, at 390 and 1440 px, 3 cold runs each (median of
  the web-vitals CLS: largest session window);
- first paint with JavaScript disabled on sign-in and the dashboard, EN and AR,
  390 and 1440;
- CDP screencast frames of the Arabic visitor landing on sign-in and the
  dashboard at 1440, with the CPU throttled 4×.

Results go to `.github/assets/fix-ssr-locale-direction/` (`cls-<phase>.json`,
`nojs-*.png`); frames go to `.tmp/ssr-locale-direction/frames/` and are encoded
to GIFs separately. With both phases captured the script prints the Markdown
table.

## Running

The script does not start services. Take the machine-wide dev-stack lock
(`NIBLEAF_DEVSTACK_LOCK`, a directory created with `mkdir`) before starting any
stack, and keep it until both phases are done.

1. Use a disposable, migrated and seeded database (`pnpm db:deploy`, then
   `pnpm db:seed`, which creates `demo@nibleaf.test`). The script adds a
   temporary session for that user and deletes it at the end.
2. Build the change and main (in a separate worktree) with
   `pnpm turbo run build --filter=@nibleaf/app... --filter=@nibleaf/server...`.
3. For each phase, start that build's API on 4311 and app on 4310 with
   `NODE_ENV=production` and a production-strength `BETTER_AUTH_SECRET`:
   `node --import tsx apps/server/dist/index.mjs` and
   `node --import tsx apps/app/.output/server/index.mjs` (with `PORT` set). Then
   run:

```sh
node --env-file=.env --import tsx tests/integration/ssr-locale-direction/capture.mjs before   # main's stack
node --env-file=.env --import tsx tests/integration/ssr-locale-direction/capture.mjs after    # this branch's stack
```

Stop the services and remove the lock afterwards. `PLAYWRIGHT_CHROMIUM_EXECUTABLE`
(or `CHROME_PATH`) selects the browser, `APP_URL` another origin, `RUNS` the
number of runs per profile.
