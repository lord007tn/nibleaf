# Settings → Git → Deploy on push → Rotate: the new secret stays out of the MutationCache

**These are component-fixture captures only. They are not the dashboard and not production.** They show the legacy
import's Deploy on push card on Settings → Git, with main's `GitTab` and `useRotateGitWebhookSecret` beside this
branch's. Each state is shown in English and Arabic at 390 px and 1440 px (light theme), and there is one recording of
this branch. They prove nothing about real sites, the server, a Git provider, real secrets or screen readers. No real
key or secret was rotated, revoked or replaced anywhere.

## How they were made

`capture.mjs` builds a temporary Vite fixture from the real code:

- main's `git-tab.tsx`, its whole `features/site-git` slice and `useRotateGitWebhookSecret` from
  `hooks/api/mutations.ts`, read with `git show` at the pinned base `84d80dc9`;
- this branch's `GitTab` and its `features/site-git` rotation request and command;
- the design system, the EN/AR catalogs and the app's own `createQueryClient`, with a probe that reports, by label,
  which placeholder secrets the QueryClient's mutations keep (their state with the error's own fields, their options,
  and a dehydration of every mutation) and which the settings read keeps.

The fixture keys the tab by site, as the settings page does, and can switch it to another site and back, or to
another page while the QueryClient stays. It runs in local headless Chromium through
`tests/integration/lib/capture-env.mjs`, which keeps the browser local-only. The run held the repository's heavy-step
lock.

- The sites (`<id#1>`, `<id#2>`), the repository (`acme-fixture/handbook`) and the secrets (`<credential#n>`) are
  fictional, low-entropy placeholders. Screenshots, the recording and `evidence.json` show only the labels; this is
  asserted.
- Every API request is answered by interception on the fixture origin. The settings `GET` answers an admin with the
  stored secret, as the route does. A rotation `POST` is held until the script stores the next secret and answers
  with it, or refuses it with a 403 whose code, message, details and `Retry-After` echo a placeholder.
- Offline is the browser's own emulation (`context.setOffline`). TanStack's online manager follows it. Playwright's
  interception still answered the request the branch sent while offline; a real browser would fail it at once.

No server, database or Git provider was used, and no request left the fixture origin (`attempted: 0`). The temporary
build was deleted after the run.

## Files

| Files | What it shows |
| --- | --- |
| `states-390.png`, `states-1440.png` | Main (left) and this branch (right), EN then AR, in five states. Each caption gives the POSTs, Rotate, the toasts, the mutations (and paused ones in a default dehydration) and which placeholders the mutations keep. |
| `flow-after-en-1440.webm` | This branch: Rotate → refused → Rotate, the tab left and reopened (still busy, so it cannot be pressed again) → stored and read back (no reveal or toast in the reopened tab) → Rotate → stored, read back and revealed with one toast. |
| `evidence.json` | Every panel's and every step's readback, retention and requests, as labels. |
| `preflight-main.json` | The preflight on main in vitest (the real GitTab and QueryClient, held HTTP), before anything changed. |

### The five states

- **Rotate pressed, held:** the same request on both (`POST /api/app/projects/<id#1>/settings/git/webhook-secret`, no
  body) and Rotate busy. Main has one pending mutation; here none.
- **Stored and read back:** the same on both: the settings read again, the new secret revealed, one toast. Main's
  mutation keeps `<credential#2>`, so a dehydration of every mutation carries it. Here no mutation exists.
- **Refused (403):** the same one toast on both. Main's mutation error keeps the server's text, with the echoed
  `<credential#4>`. Here nothing is kept.
- **Ordinary: held, the tab left for `<id#2>` and reopened:** main's Rotate is ready again and a press sends a second
  rotation of the site. Here Rotate is busy (and so disabled) until the first rotation and its read end.
- **Ordinary: offline, pressed, then another page, then online:** main pauses the press (no POST, one paused mutation
  in a default dehydration) and sends it after the person has left, keeping `<credential#2>` from the answer. Here the
  press is sent at once and nothing is paused, kept or sent later.

## What these do not change

The settings read (`GET /settings`) answers an admin with the site's webhook secret, and this card shows the secret
from it. So the settings query holds the secret on both sides (`bySettingsRead` in `evidence.json`). That is main's
server and query contract. This branch leaves it as it is.
