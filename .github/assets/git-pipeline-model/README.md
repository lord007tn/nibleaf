# Git → Pipeline: the model extraction, pixel-identical

**Component fixture only, not the dashboard and not production.** These captures show the Settings → Git Pipeline
card (Import → Build → Live), with main's inline `GitPipeline` beside this branch's `features/site-git` one, in English
and Arabic at 390 px and 1440 px (light theme). They prove nothing about real repositories, the server, the worker or
real deployments. No repository was imported, built or deployed.

## How they were made

`capture.mjs` builds a temporary Vite fixture from the real code. It takes main's `git-tab.tsx` at `602f2498`
(read with `git show`, with its private `GitPipeline` exported) and this branch's component, together with the design
system, the EN/AR catalogs and the real deployments queries (`useDeployments`, `useLiveDeployments`). Both cards get
the same props. It opens the fixture in local headless Chromium through `tests/integration/lib/capture-env.mjs`, which
keeps the browser local-only. The run held the repository's heavy-step lock.

The site and its deployments are fictional. The only API requests are the two deployments reads (the attempts list
and `?status=READY`), answered by interception on the fixture origin; any other API call fails the run. No server,
database or worker was used, no request left the fixture origin, and the temporary build was deleted after the run.

For every state, locale and width, the run asserts that both versions read the same (each step's label, detail,
marker classes and action) and that their screenshots are **byte-identical** (same SHA-256, recorded in
`evidence.json`). It also checks a few details against the catalogs, so two identically wrong cards would still fail.

## Files

| Files | What it shows |
| --- | --- |
| `pipeline-390.png`, `pipeline-1440.png` | Main (left) and this branch (right), EN then AR, in five states: no attempts and never imported; 50 newer failed attempts with v3 live only in the live-only list, after a manual import; v8 building over live v7 with a push sync tied with the manual import (the sync is shown); a failed push sync with its error shown as plain text, and v9 failed over live v8; Import now busy with its loading text. Every pair is marked "identical: yes". Arabic lays out from the right, and nothing overflows (asserted). |
| `evidence.json` | Base and head SHAs, each panel's readback and screenshot SHA-256, the requests each page made, and the keyboard check: on both versions, Enter on the focused Import now calls the callback once, keeps focus, doesn't navigate and sends no request. |

No recording: nothing changes over time that the sheets and the component tests don't already show.
