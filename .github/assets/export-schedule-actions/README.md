# Exports: schedule row actions

**Component fixture only, not the dashboard and not production.** These captures show Settings → Exports →
Schedules, with main's `ExportsSection` beside this branch's, in English and Arabic at 390 px and 1440 px (light
theme), plus one recording. They prove nothing about real sites, the server, the scheduler, the worker or screen
readers, and nothing here was accepted by a server or a scheduler.

## How they were made

`capture.mjs` builds a temporary Vite fixture from the real code. It takes main's `exports-section.tsx` and
`hooks/api/exports.ts` at `a4230029` (read with `git show`) and this branch's section, together with the design system,
the EN/AR catalogs, the query hooks and the Run now / Enable / Disable mutations. It opens the fixture in local headless
Chromium through `tests/integration/lib/capture-env.mjs`, which keeps the browser local-only. The run held the
repository's heavy-step lock.

The site ("Handbook") and its two schedules are fictional. Every request is answered by interception on the fixture
origin:

- the site, its deployments and its export runs come from fixed answers;
- a schedule `PATCH` or run `POST` is answered 503 when the run asks for a failure, and can be held. Otherwise the
  `PATCH` stores `enabled` and the run adds one to the schedule's run count, and the schedules `GET` reads that back.
  The readback comes from the mock, not the API.

No server, database, scheduler, worker or job was used. No request left the fixture origin, and the temporary build
was deleted after the run. `evidence.json` names the base and the head.

## Files

| Files | What it shows |
| --- | --- |
| `states-390.png`, `states-1440.png` | Main (left) and this branch (right), EN then AR, in three states. **Listed**: both look the same; here each action's accessible name ends with its schedule ("Run now Handbook nightly"), while on main every row's buttons are just "Run now" and "Disable". **Disable pressed with Enter, answer held**: only that button is busy in both; on main the busy button is natively disabled and keyboard focus drops to the page, while here it stays on the button (the focus ring). **Refused (503)**: the "Could not save" toast, and the schedule is still "enabled", as the server has it. Arabic lays out from the right with left-to-right times and timezones, and nothing overflows (asserted for every panel). |
| `flow-en-1440.webm` | Disable, a 503, the retry, then Run now pressed twice: described step by step below. |
| `evidence.json` | Every panel's and step's readback: each row's status, details, failure and buttons (accessible name, busy, disabled, focus), toasts and every write request with its body. |

## The recording, step by step

1. Two schedules are listed; the second is disabled and shows its last failure.
2. Disable on the first: only that button is busy, and the row still says "enabled". The fixture answers 503.
3. "Could not save", and the value stays as the server has it.
4. Disable again: the same `{ "enabled": false }` is sent, and the row reads back "disabled" with "Enable".
5. Run now, double-clicked: one `POST …/run` with no body. "Archive run queued." is shown, and the run count reads back
   as 13.

In total: two `PATCH`es with identical bodies and one run `POST`.
