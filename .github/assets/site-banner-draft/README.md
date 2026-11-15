# Banner settings: one server draft per scope

Component-fixture captures of Site configuration → Banner. These are **not** dashboard or production screenshots.

`capture.mjs` builds the real section with Vite: before is `banner-section.tsx` from the merge base with `main`, after
is `features/site-banner`. The build includes the design system, the EN/AR catalogs, TanStack Query and the app's own
mutations. The page runs in headless Chromium through `tests/integration/lib/capture-env.mjs`, which takes the dev-stack
lock and lets no request leave the fixture origin.

The API is answered by interception with fictional data. A project save merges the banner one level deep, as the server
does, and the project is refetched after a save, as its hosts do. No server, database or account was used, and 0 requests
went outside. The temporary build is deleted after the run.

| File | What it shows |
| --- | --- |
| `sheet-{en,ar}-{1440,390}-{light,dark}.png` | Before \| after, three rows: **Unsaved edits** (Default scope: Dismissible off and the message changed). **Failed save** (Arabic scope, the server answers 500: the error toast shows and the draft stays). **Clean form, then a refetch** that turns Dismissible off: before keeps the stale toggle on and enables Save, so the next save would write it back; after takes the server's value and stays clean. |
| `flow-after-en-1440.webm` | After, EN, 1440, light. A toggle-only edit makes the form dirty. A failed save keeps the draft. The retry saves and the bar closes. A new edit, then a scope switch asks first, and Discard opens the Arabic scope clean (RTL content, LTR address, project text as placeholders). |
| `evidence.json` | Per capture: the toggles, each field's value, `dir` and placeholder, whether Save is offered, the toast, the API requests, page errors (none) and overflow (none). Also the recording's steps. |

The capture asserts the key facts on every run: the stale toggle before and the server's value after; the Arabic draft
kept after the failed save, written RTL, with exactly one request; no overflow, no page errors and no outside requests.
