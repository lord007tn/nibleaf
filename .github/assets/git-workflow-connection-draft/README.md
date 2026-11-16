# Settings → Git → Connection configuration: one draft, its own save, the import targets kept

**Component fixture only, not the dashboard and not production.** These captures show the connected Git
workflow's Connection configuration, with main's `GitWorkflow` beside this branch's, in English and Arabic at
390 px and 1440 px (light theme), plus one recording. They prove nothing about real sites, the server, a real
repository, a real credential or screen readers. Nothing reached any Git provider, and no token was ever typed.

## How they were made

`capture.mjs` builds a temporary Vite fixture from the real code. It takes main's `git-workflow.tsx` at the pinned
base `861c6f1f` (main with #793, so a connected save no longer crashes on the server; read with `git show`) and this branch's component, together with the design system, the EN/AR
catalogs and the app's own `createQueryClient` (wrapped to record which keys are invalidated). It opens the fixture
in local headless Chromium through `tests/integration/lib/capture-env.mjs`, which keeps the browser local-only. The
run held the repository's heavy-step lock.

- The site (`site-1`), the repository (`acme-fixture/handbook`) and the import targets (`branch-fixture-1`,
  `language-fixture-1`) are fictional.
- `GET …/git` (the status) answers the fixture's stored connection at once. `PUT …/git/connection` is answered by
  interception: held until the script releases it, or delayed (1.5 s in the recording), then stored the way the
  server normalizes it, or refused with a 400 the fixture invents. That answer is the mock, not the server: the
  server's own normalization and storage are checked separately, with mocked persistence, in
  `apps/server/src/actions/git/workflow.test.ts`.

No server, database, worker or Git provider was used, no request left the fixture origin (`attempted: 0`), and the
temporary build was deleted after the run. `evidence.json` names the base and the head, and records every save
request with its body (the fixture's import-target IDs written as `<id#1>`, `<id#2>`), and how often the status was
read.

## Files

| Files | What it shows |
| --- | --- |
| `states-390.png`, `states-1440.png` | Main (left) and this branch (right), EN then AR, in six states. **Ready**: the same fields and the same Save beside Disconnect. **A refresh that only changes the sync state**: main wipes the path being edited; here it stays. **Someone else changed the base branch being edited**: main overwrites the base and the path silently; here both stay and the conflict shows, with Use their version / Keep mine. **Save held, path typed during it**, then **its readback**: main wipes the path typed during the save and says "GitHub connection saved."; here the path stays, dirty, with Discard, and nothing says saved. Main's body has no import targets (the server then clears them); here they are sent as the status holds them. **A blank repository**: main sends it (the fixture refuses it); here nothing is sent and the field says why, with focus on it. Arabic lays out from the right, and nothing overflows (asserted for every state). |
| `flow-en-1440.webm` | This branch only: a held save, a refresh during it, the refusal, a retry and its readback (below). |
| `evidence.json` | Every state's readback: the four fields (and whether a token was typed: never), conflict, Discard, Save busy, invalid fields, focus, toasts, refreshed query keys, status reads, and every save with its body. |

## The recording, step by step

1. Ready. The base branch is changed to `trunk`.
2. Save, held: busy.
3. A refresh during the save: someone else changed the content path. The untouched path follows the server
   (`content`); the base being saved stays `trunk`.
4. The fixture refuses the save (400): explained once, every value kept, Save ready again.
5. Save again (1.5 s): busy. Stored: the readback leaves the form clean, and "GitHub connection saved." shows once.
   The site's status is refreshed.

In total: two `PUT`s, each the whole connection with the import targets as the status held them.
