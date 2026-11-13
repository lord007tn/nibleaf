# Import fidelity captures

`browser.mjs` compares `origin/main` at the recorded baseline with this branch.
It converts neutral GitBook source through each revision's real conversion and
link mapping functions, seeds the resulting Markdown into disposable sites,
opens the editor, publishes through the UI and checks the published reader.
The PostgreSQL rehearsal separately exercises the authenticated importer route
with recorded GitHub responses. No capture uses an existing customer site.

Every capture uses `withLocalOnlyBrowser`. No custom domain is created. Provider
responses are fulfilled in-process; requests outside the local stack fail the
run. `request-log.json` records the attempted count. The after profiles verify a
real divider, navigation to the imported page link, and click-to-load playback.

The harness takes `NIBLEAF_DEVSTACK_LOCK`, waits two minutes between acquisition
attempts, starts only app :4310 and API :4410, and processes the publish queue
without a worker listener. On Windows each owned server/worker tree is stopped
with `taskkill /PID <root> /T /F` before the lock is released.

Use a disposable PostgreSQL database whose name contains `import_fidelity`, an
allocated Redis DB, a migrated schema and the demo seed. Load their local env
outside Git. Set `NIBLEAF_CAPTURE_DATABASE` to the database name and set the
machine-wide `NIBLEAF_DEVSTACK_LOCK` for the host. Use a non-default local
capture auth secret because the built app runs in production mode.

Build both revisions with `NODE_ENV=production` and
`VITE_API_URL=http://localhost:4410`. Do not load a development NODE_ENV while
building. Keep each output beside its original package and set
`NIBLEAF_BEFORE_ROOT`, `NIBLEAF_BEFORE_APP` and `NIBLEAF_BEFORE_API` to the baseline
checkout and its built entrypoints. The baseline checkout belongs under the
owner's configured Codex worktree root. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` if
using an installed Chrome executable instead of Playwright's bundled browser.

Run from the changed checkout:

```sh
node --env-file=.env --import tsx tests/integration/import-fidelity/browser.mjs
```

Screenshots, one short reader recording and the request log are written to
`.github/assets/fix-import-fidelity/`. After all rehearsal/capture runs, verify
ports 4310/4410 are free, drop the disposable database, flush only the allocated
Redis DB, and verify no owned process remains.
