# Git → Connection → Rotate webhook secret: the new secret stays out of every cache

**These are component-fixture captures only. They are not the dashboard and not production.** They show Settings →
Git → Connection → Webhook → Rotate webhook secret, with main's `GitWorkflow` and `useRotateGitWorkflowWebhookSecret`
beside this branch's. Each state is shown in English and Arabic at 390 px and 1440 px (light theme), and there is one
recording of this branch. They prove nothing about real sites, the server, GitHub, real secrets or screen readers. No
real key or secret was rotated, revoked or replaced anywhere.

## How they were made

`capture.mjs` builds a temporary Vite fixture from the real code:

- main's `git-workflow.tsx`, its whole `features/site-git` slice and its `hooks/api/git-workflow.ts` (for
  `useRotateGitWorkflowWebhookSecret`), read with `git show` at the pinned base `5e3fd880`. Every other module the
  before side imports is checked to be unchanged since the base, and `hooks/api/git-workflow.ts` to differ only by the
  removed hook;
- this branch's `GitWorkflow` and `features/site-git` rotation command;
- the design system and its confirmation dialog, the EN/AR catalogs and the app's own `createQueryClient`, wrapped to
  record which keys are invalidated and to report, by label, which of the secrets it holds.

The fixture keys the panel by site (`git-site-a`), as the settings page keys the Git tab, and can switch it to
`site-b` and back, as leaving and reopening the tab does. It opens the fixture in local headless Chromium through
`tests/integration/lib/capture-env.mjs`, which keeps the browser local-only. The run held the repository's heavy-step
lock.

- The sites and the repository (`acme-fixture/handbook`) are fictional. The webhook secrets (`test-secret-000n`) are
  low-entropy placeholders.
- The one-time secret is masked by the fixture's own style (its text hidden, the label `<SECRET_n>` shown); this is
  asserted. `evidence.json` writes every secret as a label, never the value, which is also asserted.
- Every API request is answered by interception on the fixture origin. Those answers are the mock, not the server:
  - The status `GET` answers a connected site.
  - A rotation `POST` can be held until the script releases it. It is then refused with a 429 and `Retry-After: 30`,
    or answered with the next fictional secret, as the route answers a rotation.
  - Offline is the browser's own emulation (`context.setOffline`).

No server, database or Git provider was used, and no request left the fixture origin (`attempted: 0`). The temporary
build was deleted after the run.

## Files

| Files | What it shows |
| --- | --- |
| `states-390.png`, `states-1440.png` | Main (left) and this branch (right), EN then AR, in seven states. Each panel's caption gives the POSTs (and their sites), Rotate, the dialog, the secret (as a label), the refreshed keys, the toasts, the paused mutations a default dehydration carries, what the QueryClient keeps and whether the console printed a placeholder. |
| `flow-after-en-1440.webm` | This branch: Rotate → Cancel → Rotate → confirmed, held → refused (429) → Rotate → confirmed, held → stored and read back → the one-time secret (masked). |
| `evidence.json` | Every panel's and every step's readback, retention and requests, as labels. |

### The seven states

Each screenshot is of the viewport, so the confirmation shows; toasts are counted in the caption.

- **Rotate pressed:** the same destructive confirmation on both; nothing sent.
- **Confirmed, held:** the same request on both (`POST /api/app/projects/site-a/git/webhook-secret`, no body) and
  Rotate busy.
- **Stored and read back:** the same on both: site A read back, then the one-time secret in the panel, no toast. Main
  keeps `<SECRET_1>` in its MutationCache and so in a dehydration of every mutation. Here nothing keeps it.
- **Refused (429):** the same on both: one "rate limited" toast, Rotate ready.
- **Ordinary: rotation held, the tab left for site B and reopened:** main's Rotate is ready again, and a confirmed
  press sends a second rotation for the site. Here Rotate is busy until the first one and its read end, and nothing
  more is sent.
- **Ordinary: the confirmation open, the tab left for site B, then accepted:** main still rotates site A. Here nothing
  is sent.
- **Offline: Rotate confirmed, the tab left for site B, the connection back:** main pauses the rotation (the default
  dehydration, what an offline persister keeps, carries it) and sends it on reconnect, after the person left, so nobody
  sees its secret. Here it is tried at once, the browser refuses it offline, one network toast shows, and the reconnect
  sends nothing.

Arabic lays out from the right, and nothing overflows; this is asserted for every panel.

## The recording, step by step

1. Open Connection settings. Rotate is ready.
2. Press Rotate webhook secret: the confirmation opens. Cancel it; nothing is sent.
3. Press it again and confirm. The POST is held, so Rotate is busy.
4. The fixture refuses it (429). One toast, and Rotate is ready.
5. Press and confirm again. It is held, then answered.
6. Site A is read back, and the one-time secret shows, masked by the fixture as `<SECRET_1>`.

Two POSTs, both `POST /api/app/projects/site-a/git/webhook-secret` with no body. At every step, the QueryClient and the
console hold no placeholder (asserted).
