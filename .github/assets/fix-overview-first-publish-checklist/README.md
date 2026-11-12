# First-publish checklist journey

The before captures use main at `7e7545a10a9dc59fd8ed239dc1fc950058ee4048`.
The after captures use this PR's implementation. Each journey starts with two
untouched starter pages and no publish or domain, copies the reserved address
(after only), edits and saves a page, returns to Overview, adds a connecting
domain, and returns again.

The actual Overview route, Tiptap editor, domain settings form, query/mutation
hooks, translations, clipboard helper, and design primitives run in a small
router harness. HTTP responses use fictional in-memory fixtures. Clipboard
contents are read back after the real copy action. This verifies the component
journey; it does not verify a live database, authentication service, or DNS/TLS
provider. No dev server or container is started. Personal Chrome and the shared
preview host were unavailable in the capture environment, so captures use
Playwright's installed Chromium.

The final batch was captured together on 2026-11-12: eight journeys, eight GIFs,
and 44 PNGs. Assertions cover 0 → 1 → 2 progress, Publish becoming the current
step, clipboard readback, saved content, a connecting domain, no browser errors,
and no horizontal page overflow. Screenshots settle CSS animations before
capture. The standalone build uses the browser halves of the origin helpers;
unused public reader search throws if invoked instead of returning a fake result.

Each `before|after-en|ar-1440|390.gif` shows one journey. PNGs show the initial,
edited, and domain states, with intermediate editor/form/copy frames. GIFs are
checked below 5 MB. `evidence.json` records the requests and assertions.

To reproduce, set `NIBLEAF_DEVSTACK_LOCK` to the machine-wide lock and, if needed,
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` to the installed browser, then run:

```sh
node tests/integration/overview-first-publish/browser.mjs
```

One invocation acquires the lock, captures both revisions and all four
locale/viewport combinations, closes its browser, and releases only its own lock.
The script uses `tests/integration/lib/capture-env.mjs` for locking and browser
selection. `BASELINE` can override the pinned before revision.
