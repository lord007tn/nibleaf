# Editor authoring journeys

`browser.mjs` exercises the real built app, API, publish worker and published
reader. It creates fictional sites in a designated disposable database and
checks the saved records and published deployment, as well as the UI. It does
not intercept API requests or substitute components.

Prepare an isolated `nibleaf-editor-p2` namespace through the owner's shared
services helper, map its host environment into the ignored root `.env`, apply
migrations, and run the normal demo seed. Keep search in local/legacy mode and
external providers off. Build the app and its dependencies, plus the worker.
The capture requires the disposable database name in
`NIBLEAF_CAPTURE_DATABASE`, equal to the database in `POSTGRES_URL` and containing
`editor_p2`. Never point it at a database with real records.

Set `NIBLEAF_DEVSTACK_LOCK` to the shared machine-wide Nibleaf lock directory.
The script acquires it before starting any service, waits while another thread
owns it, and releases it after stopping its processes. Existing backing
containers stay running. Chromium uses `../lib/capture-env.mjs` and the normal Playwright installation;
`PLAYWRIGHT_CHROMIUM_EXECUTABLE`, `CHROME_PATH` or `CHROMIUM_PATH` can override it.

```sh
node --env-file=.env --import tsx tests/integration/editor-p2/browser.mjs
```

By default this captures the current build. To compare main and the change in
one browser session, also set `NIBLEAF_BEFORE_APP` and `NIBLEAF_BEFORE_API` to
preserved main builds' server entrypoints. The reviewed baseline is main
`35d9d6686`. The app entrypoint needs the entire adjacent built output, not only
the entry file. The final app and API entrypoints use the normal `.output` and
`dist` locations. The same worker runs both phases.

Each phase walks page settings, creates an empty group, opens the actual preview
popup and publishes, inspects the published sidebar, creates and names a page,
and adds Arabic using the keyboard on an English-only fixture site. Both the
interface and the first site's content language use EN/AR, at 1440 and 390 px.
Assertions cover the mobile header's width, title offset, settings validation,
group URL diffs, persisted empty titles and adopted slugs, the warning dot, and
combobox/menu accessibility snapshots. Before assertions reproduce the known
defects; after assertions require the corrected behavior.

Screenshots, accessibility snapshots and measured geometry go into
`.github/assets/fix-editor-p2-batch/`. Continuous browser recordings stay in
`.tmp/editor-p2/videos/`; `measurements.json` maps each journey to its editor and
preview recordings. The PR's GIFs are encoded from those recordings, each under
5 MB. The script removes its temporary
signed-in session and leaves the fictional sites for inspection. No credentials
or browser storage are saved with the media.
