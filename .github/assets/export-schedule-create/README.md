# Exports: creating a schedule

**Component fixture, not the dashboard and not production.** These are captures of Settings → Exports → Schedules →
New schedule: main's `ExportsSection` beside this branch's, in English and Arabic at 390 px and 1440 px (light theme),
plus one recording. They say nothing about real sites, the scheduler, the worker or screen readers.

## How they were made

`capture.mjs` builds a temporary Vite fixture from the real code: main's `exports-section.tsx` and its export hooks
(read with `git show origin/main:…`), and this branch's section, with the design system, the EN/AR catalogs, the query
hooks and the create mutation. It opens the fixture in the local headless Chromium through
`tests/integration/lib/capture-env.mjs`, which keeps the browser local-only. The run held the repository's heavy-step
lock. The browser's timezone is set to `Africa/Lagos`, so that is the detected default.

The site ("Handbook") is fictional. Every request is answered by interception on the fixture origin:

- the site, its deployments and its export runs come from fixed answers;
- a schedule `POST` is answered 409 or 503 when the run asks for a failure, and otherwise stored in an in-page list
  that the schedules `GET` reads back. That readback is the mock, not the API.

The real request schema is `createExportScheduleBody`; `packages/validators/src/schema.test.ts` and this branch's
`schedule-create.test.ts` run it. No server, database, scheduler, worker or real job was used, 0 requests left the
fixture origin, and the temporary build was deleted after the run. `evidence.json` names the base and head.

## Files

| Files | What it shows |
| --- | --- |
| `states-390.png`, `states-1440.png` | Main (left) and this branch (right), EN then AR, in three states. **Opened**: the same defaults. **Blank name, time and runs to retain**: main greys out Create with no reason and turns the blank number into `0`; this branch keeps the blank, and Create marks the three fields with their messages and focuses the first. **Create refused with 409**: main shows the limit in a toast; this branch keeps it in the form, beside the values kept for a retry. The 409 copy is unchanged. Arabic lays out from the right with left-to-right times and timezones, and nothing overflows (asserted for every panel). |
| `flow-en-1440.webm` | Create, a 503, the retry and the close: below. |
| `evidence.json` | Every panel's and step's readback: field values, invalid fields and messages, focus, Create's state, alerts, toasts, requests and the stored schedules. |

## The recording, step by step

1. Opened with the defaults, nothing marked.
2. A name and 30 runs to retain.
3. Create: the fields freeze and Create shows "Creating schedule…"; the fixture answers 503.
4. One error in the form ("Could not save"), everything still as typed.
5. Create again: the same complete body is sent, the schedule is created, "Archive schedule created." is announced,
   the form closes and the list reads the new schedule back. Two `POST`s in total, with identical bodies.

## A difference from main, reproduced first

Two component tests were run against main (`176033a4`) before any change, rendering through `ExportsSection`. Both
fail there and pass on this branch with the same assertions (now in `schedule-create-form.test.tsx`, "regressions
from main"):

```
× keeps a pristine draft clean when the dashboard language changes
  AssertionError: expected true to be false
× lets a number field stay blank instead of turning it into 0
  AssertionError: expected '0' to be ''
```

On main, switching the dashboard language makes an untouched draft count as unsaved (the default name is compared
with the new language's), and a cleared number shows `0`.

## What this does not change

- The schema, the server, the scheduler, the worker, retention and exporters are unchanged. Creation sends the same
  complete body; the weekday or day of month is sent only for its cadence, as before.
- One-time exports, history, downloads, schedule rows, enable/disable and Run now are unchanged.
- Closing the form or leaving Schedules with an edited or pending draft now asks first, with the settings leave copy.
  A creation already sent still finishes on the server, quietly.
