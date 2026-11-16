# Git → legacy import → Import now: one import per site, reported only into its own panel

**Component fixture only, not the dashboard and not production.** These captures show Settings → Git → Legacy
import settings → Pipeline, with main's `GitTab` beside this branch's, in English and Arabic at 390 px and 1440 px
(light theme), plus one recording of each. They prove nothing about real sites, the server's importer, real
repositories, providers or screen readers. Nothing was imported anywhere.

## How they were made

`capture.mjs` builds a temporary Vite fixture from the real code. It takes main's `git-tab.tsx`, `git-pipeline.tsx`
and `useImportFromGit` at the pinned base `1ba227f8` (read with `git show`), and this branch's tab, together with the
design system, the EN/AR catalogs and the app's own `createQueryClient` (wrapped to record which keys are
invalidated). The fixture keys the tab by site (`git-${projectId}`), as the settings page does, so leaving for another
site is an unmount. It opens the fixture in local headless Chromium through
`tests/integration/lib/capture-env.mjs`, which keeps the browser local-only. The run held the repository's heavy-step
lock.

- The sites (`site-a`, `site-b`) and repositories (`acme-fixture/handbook`, `acme-fixture/guides`) are fictional.
- The import `POST`s are answered by interception on the fixture origin: held until the script releases them, then a
  fixed summary (3 imported, 1 updated) or a 500 the script queued. That answer is the mock, not the importer.
- The per-site GitHub connection above the legacy import is out of scope and renders as nothing on both sides.

No server, database, worker, importer or Git provider was used, no request left the fixture origin (`attempted: 0`),
and the temporary build was deleted after the run. `evidence.json` names the base and the head, and records each
request with its body.

## Files

| Files | What it shows |
| --- | --- |
| `states-390.png`, `states-1440.png` | Main (left) and this branch (right), EN then AR, in six states, each captioned with its POSTs, busy and focus state, refreshed keys and toasts. **Ready**: unchanged. **Import pressed twice in one task, held**: main sends two POSTs; here one. **Enter on Import, held, then Enter again**: one POST on both; main's busy button is `:disabled` and Chromium moves focus to the page, here it stays focused (`aria-disabled`). **Site A importing, leave for B and back to A, press Import**: main shows A idle on return and sends a second POST; here A is still busy and nothing more is sent. **Leave for B, then A succeeds / fails**: the same on both: the success refreshes `['workspace','settings','site-a']` and `['pages','site-a']` and reports nothing into B's panel; the failure refreshes and reports nothing. Arabic lays out from the right, and nothing overflows (asserted for every panel). |
| `flow-before-en-1440.webm`, `flow-after-en-1440.webm` | A refused import, its retry, leaving for site B and coming back while it runs, pressing Import again, the success, and one more import (below). |
| `evidence.json` | Every panel's and step's readback: the repository shown, the Import button (text, busy, disabled, `aria-disabled`, focus), toasts, refreshed query keys, and every request. |

## The recording, step by step

1. Import: busy while held; the fixture answers 500: "Could not import from Git" once, nothing refreshed.
2. Import again (the retry): busy while held. Main moves focus to the page; here the button keeps it.
3. Leave for site B, then back to site A while the retry runs. Main: A shows Import idle; here it is still busy.
4. Press Import on A. Main sends a third POST; here nothing is sent.
5. The fixture answers. Main refreshes site A twice and toasts the result in the reopened panel; here site A is
   refreshed once and nothing is reported (A → B → A is a new panel).
6. Import once more from the same panel: the result toast, and site A refreshed.

In total, every POST was `POST /api/app/projects/site-a/settings/git/import` with no body: four on main, three here.
