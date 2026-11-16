# Settings → Git → Sync and Update PR: one owner per press, refreshed and reported for its own site

**Component fixture only, not the dashboard and not production.** These captures show the connected Git workflow's
Sync and Update PR panels, with main's `GitWorkflow` beside this branch's, in English and Arabic at 390 px and
1440 px (light theme), plus one recording. They prove nothing about real sites, the server's Git worker, a real
repository or screen readers. Nothing was pulled, pushed or opened on any Git provider.

## How they were made

`capture.mjs` builds a temporary Vite fixture from the real code. It takes main's `git-workflow.tsx` and
`hooks/api/git-workflow.ts` (with `useQueueGitOperation`) at the pinned base `5c7426c6` (read with `git show`) and
this branch's component, together with the design system, the EN/AR catalogs and the app's own `createQueryClient`
(wrapped to record which keys are invalidated). It opens the fixture in local headless Chromium through
`tests/integration/lib/capture-env.mjs`, which keeps the browser local-only. The run held the repository's
heavy-step lock.

- The site (`site-1`) and the repository (`acme-fixture/handbook`, base branch `main`) are fictional.
- `GET …/git` (the status) is answered at once with a fixed connection. `POST …/git/operations` is answered by
  interception: held until the script releases it, or delayed (1.5 s in the recording), then queued, or refused
  with a 503 the fixture invents. That answer is the mock, not the server.

No server, database, worker or Git provider was used, no request left the fixture origin (`attempted: 0`), and the
temporary build was deleted after the run. `evidence.json` names the base and the head, and records every request
with its body and idempotency key, and how often the status was read.

## Files

| Files | What it shows |
| --- | --- |
| `states-390.png`, `states-1440.png` | Main (left) and this branch (right), EN then AR, in four states. **Sync ready**: unchanged. **Sync pressed twice in one task, request held**: main sends two operations (two keys); here one. **Update PR typed and pressed twice in one task**: the same, with the fields sent raw. **Sync running, Update PR chosen and typed, then Sync refused**: Update PR is busy while Sync runs in both; main then toasts "Could not queue Git operation." over the Update PR panel, here nothing is reported there. Neither refreshes on a failure. Arabic lays out from the right, and nothing overflows (asserted for every panel). |
| `flow-en-1440.webm` | Sync refused, its retry, and an Update PR (below). |
| `evidence.json` | Every panel's and step's readback: the panel shown, the Sync and Update PR buttons (busy, disabled, focus), the commit message field, toasts, refreshed query keys, status reads, and every request with its body. |

## The recording, step by step

1. Sync chosen.
2. Sync: busy for 1.5 s; the fixture refuses it (503): "Could not queue Git operation.", shown once. Nothing is
   refreshed.
3. Sync again: busy, sent with the same body under a new key. Queued: `['git-workflow', 'site-1']` is refreshed and
   the status read once more.
4. Update PR chosen and typed (the commit message with its spaces), sent: busy, then queued. The fields stay as
   typed, and there is no success toast, as on main.

In total: two PULLs (`{ kind: 'PULL', sourceRef: 'main' }`) and one PUSH (`{ kind: 'PUSH', commitMessage: '  Refresh
the handbook ', authorName, authorEmail, createPullRequest: true, pullRequestTitle }`), each with its own UUID key.

## Not changed, recorded as is

A pressed Sync or Update PR button is natively `disabled` while busy, on main and here alike, so a keyboard press
leaves the focus on the page body (`focusLost: true` in both columns). This branch keeps that as it is.
