# Exports: one-time export, Cancel and downloads

**Component fixture only, not the dashboard and not production.** These captures show Settings → Exports (the
one-time export form and Run history), with main's `ExportsSection` beside this branch's, in English and Arabic at
390 px and 1440 px (light theme), plus one recording. They prove nothing about real sites, the server, the worker, the
scheduler, real export files or screen readers. Nothing here was accepted by a server or produced by a worker.

## How they were made

`capture.mjs` builds a temporary Vite fixture from the real code. It takes main's `exports-section.tsx` and
`hooks/api/exports.ts` at `86e8cb74` (read with `git show`) and this branch's section, together with the design
system, the EN/AR catalogs, the query hooks and the create / Cancel / download-link mutations. It opens the fixture in
local headless Chromium through `tests/integration/lib/capture-env.mjs`, which keeps the browser local-only. The run
held the repository's heavy-step lock.

The site ("Handbook"), its three runs and their artifacts are fictional. Every API request is answered by interception
on the fixture origin:

- the site, its deployments and the schedules come from fixed answers;
- a create or cancel `POST` is answered 503 when the run asks for a failure, and can be held. Otherwise a create adds
  a queued run and a cancel marks the run cancelled, and the runs `GET` reads that back. That readback is the mock,
  not the API.
- the download-link `GET` answers with a fictional link back to the fixture origin. The artifact file itself is
  **never served**: Playwright's routes don't see a browser download, and the local-only browser can't reach the
  fixture host, so Chromium starts the download (named `handbook-v4.pdf`, from the link the fixture gave) and then
  cancels it. The recording shows the download being asked for, not a downloaded file.

No server, database, worker, scheduler or job was used, no request left the fixture origin, and the temporary build
was deleted after the run. `evidence.json` names the base and the head, and records request paths and bodies but no
response bodies (no link of any kind).

## Files

| Files | What it shows |
| --- | --- |
| `states-390.png`, `states-1440.png` | Main (left) and this branch (right), EN then AR, in four states. **One-time export**: unchanged. **Run history**: a running export, a scheduled one with two downloads, and a failed one. On main every Cancel is just "Cancel"; here Cancel's accessible name adds the run's formats and time, and each download adds the run's time. In Arabic, main's download buttons reorder the size ("2.4" lands beside "PDF"); here the size is isolated and reads "PDF · 2.4 ميبيبايت". **Cancel pressed with Enter, answer held**: only that button is busy in both; on main the busy button is natively disabled and keyboard focus drops to the page, while here it stays on the button. **Cancel refused (503)**: still "running" in both, as the server has it; main says nothing, while here "Could not cancel the export." is shown. Arabic lays out from the right, and nothing overflows (asserted for every panel). |
| `flow-en-1440.webm` | Create refused and retried, Cancel refused and retried, and a download pressed twice: described step by step below. |
| `evidence.json` | Every panel's and step's readback: each run's status, details and buttons (accessible name, busy, disabled, focus), toasts, every write request with its body, and the download event. |

## The recording, step by step

1. One-time export with Markdown ZIP and PDF selected.
2. Create: the button is busy; the fixture answers 503. "Couldn't start the export. Try again." The formats stay as
   chosen.
3. Create again: the same `{ "formats": ["MARKDOWN", "PDF"] }`, and "Export queued from the latest published
   revision."
4. Run history: the queued export is on top, "pending".
5. Cancel: only that button is busy; the fixture answers 503. "Could not cancel the export.", and the run is still
   "pending".
6. Cancel again: the run reads back as "cancelled" and its Cancel button is gone.
7. A PDF download, double-clicked: one download-link `GET` and one download started, named `handbook-v4.pdf`.

In total: two create `POST`s with identical bodies, two cancel `POST`s with no body, and one download-link `GET`.

## Compared with main, reproduced first

Before any change, a probe with a real `QueryClient` and held requests was run against main (`86e8cb74`):

| Probe | Main | This branch |
| --- | --- | --- |
| `useCreateExport` / `useCancelExport`, held request for site A, same component re-rendered for site B | refreshes **site B's** exports | refreshes site A's |
| Same, with the component keyed by site (as the settings page mounts it) | refreshes site A's | refreshes site A's |
| Create / Cancel / download pressed twice in the same tick | 2 / 2 / 2 requests | 1 / 1 / 1 |
| Export queued after the section was left | no toast | "Export queued…" |
| Download failure after the keyed section moved to site B | toast shown on site B | nothing |
| Cancel refused | no toast, nothing read back | toast, runs read back |

The wrong-site refresh only shows when one component instance changes site. The settings page keys
`ExportsSection` by site, so there it remounts and the old hooks refreshed the right site.
