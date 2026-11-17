# Git → Connect GitHub → Connect: the first connection keeps the token and secret out of every cache

**These are component-fixture captures only. They are not the dashboard and not production.** They show Settings →
Git → Connect GitHub, step 3 (Connect), with main's `GitWorkflow` and `useConnectGitWorkflow` beside this branch's.
Each state is shown in English and Arabic at 390 px and 1440 px (light theme), and there is one recording of this
branch. They prove nothing about real sites, the server, GitHub, real tokens or screen readers. No token was sent to
GitHub, and GitHub accepting a token is not claimed anywhere.

## How they were made

`capture.mjs` builds a temporary Vite fixture from the real code:

- main's `git-workflow.tsx`, its whole `features/site-git` slice and its `hooks/api/git-workflow.ts` (for
  `useConnectGitWorkflow`), read with `git show` at the pinned base `dd302202`. Every other module the before side
  imports is checked to be unchanged since the base, and `hooks/api/git-workflow.ts` to differ only by the removed hook;
- this branch's `GitWorkflow` and `features/site-git` first-connect command;
- the design system, the EN/AR catalogs and the app's own `createQueryClient`, wrapped to record which keys are
  invalidated and to report, by label, which of the token and the secrets it holds.

The fixture keys the panel by site (`git-site-a`), as the settings page keys the Git tab, and can switch it to
`site-b` and back, as leaving and reopening the tab does. It opens the fixture in local headless Chromium through
`tests/integration/lib/capture-env.mjs`, which keeps the browser local-only. The run held the repository's heavy-step
lock.

- The sites, the repository (`acme-fixture/handbook`) and the account (`fixture-user`) are fictional. The token
  (`test-token-0001-placeholder`) and the webhook secrets (`test-secret-000n`) are low-entropy placeholders, nothing like
  a provider token or a generated secret.
- The token field is masked by the app in every screenshot and in the recording. The one-time secret is masked by the
  fixture's own style (its text hidden, the label `<SECRET_n>` shown); both are asserted. `evidence.json` writes every
  request body, field and secret as a label (`<TOKEN_A>`, `<SECRET_1>`), never the value, which is also asserted.
- Every API request is answered by interception on the fixture origin. Those answers are the mock, not the server:
  - The status `GET` answers "not connected" (`null`) until a Connect is stored, then the stored connection.
  - The authorization `POST` answers the fictional account.
  - A connection `PUT` can be held until the script releases it. It is then refused with a 400 (optionally echoing
    the token in its message), or stored and answered with the next fictional one-time secret, as a first connection
    is.

No server, database or Git provider was used, and no request left the fixture origin (`attempted: 0`). The temporary
build was deleted after the run. In production, the secret is a 64-hex value the server generates once, and the PUT
verifies repository access with GitHub; neither happens here.

## Files

| Files | What it shows |
| --- | --- |
| `states-390.png`, `states-1440.png` | Main (left) and this branch (right), EN then AR, in seven states. Each panel's caption gives the screen, the PUTs, Connect, the secret (as a label), the refreshed keys, the toasts, what the QueryClient keeps and whether the console printed a placeholder. |
| `flow-after-en-1440.webm` | This branch: check → review → Connect held → refused → Connect again held → stored and read back → the Connection panel with the one-time secret (masked). |
| `evidence.json` | Every panel's and every step's readback, retention and requests, as labels. |

### The seven states

The screenshot is of the panel; toasts render outside it, so the caption counts them.

- **Review, Connect ready:** the same on both.
- **Connect pressed, held:** the same body on both (the fields as typed, `main`, `nibleaf/docs`, `docs`, the token, no
  import targets), and Connect busy. Main's QueryClient already holds the token: `<TOKEN_A>` in its MutationCache and so
  in a dehydration of every mutation. Here it holds nothing.
- **Refused (400):** the same on both. One toast, the review kept, Connect ready, nothing refreshed beyond the check.
  Main still holds the token.
- **Stored and read back:** the same on both. The connected screen, one "saved" toast, site A read back, and the
  Connection panel showing the one-time secret. Main keeps both `<TOKEN_A>` and `<SECRET_1>` in its MutationCache and
  all-mutation dehydration. Here neither is kept.
- **A refusal whose message echoes the token:** the toast is the existing message on both. Main keeps the token in the
  cached mutation (its variables and its error) and prints it to the console. Here nothing keeps or prints it.
- **Ordinary: Connect held, the tab left for site B and reopened, the wizard redone:** main's Connect is ready again,
  and a press sends a second first connection for the site. Here Connect is busy until the first one and its read end,
  and nothing more is sent.
- **Synthetic, three clicks in one task (held):** main sends three PUTs. Here one, busy. A person's real double click
  on main does not reach this, because the button is disabled after the first render.

Arabic lays out from the right, and nothing overflows; this is asserted for every panel.

## The recording, step by step

1. Type the token and check it (Authorize GitHub). Fill the repository and go on to the review.
2. Press Connect GitHub. The PUT is held, so Connect is busy.
3. The fixture refuses it (400). One toast, the review is unchanged, and Connect is ready.
4. Press Connect GitHub again. It is held, then stored.
5. The status is read back, and the connected screen shows with one "saved" toast.
6. Open Connection settings. The one-time secret shows, masked by the fixture as `<SECRET_1>`.

PUTs: `<TOKEN_A>` twice, both `PUT /api/app/projects/site-a/git/connection`. At every step, the QueryClient and the
console hold neither placeholder (asserted).
