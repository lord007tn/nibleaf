# Git → Connect GitHub → Authorize: the account check belongs to the token it verified

**These are component-fixture captures only. They are not the dashboard and not production.** They show Settings →
Git → Connect GitHub, step 1 (Authorize GitHub), with main's `GitWorkflow` and `useAuthorizeGitWorkflow` beside this
branch's. Each state is shown in English and Arabic at 390 px and 1440 px (light theme), and there is one recording of
each version. They prove nothing about real sites, the server, GitHub, real tokens or screen readers. No token was
sent to GitHub, and GitHub accepting a token is not claimed anywhere.

## How they were made

`capture.mjs` builds a temporary Vite fixture from the real code:

- main's `git-workflow.tsx`, its whole `features/site-git` slice and its `hooks/api/git-workflow.ts` (for
  `useAuthorizeGitWorkflow`), read with `git show` at the pinned base `fc7f92e2`. Every other module the before side
  imports is checked to be unchanged since the base, and `hooks/api/git-workflow.ts` to differ only by the removed hook;
- this branch's `GitWorkflow` and `features/site-git` authorization command;
- the design system, the EN/AR catalogs and the app's own `createQueryClient`, wrapped to record which keys are
  invalidated.

The fixture keys the panel by site (`git-site-a`), as the settings page keys the Git tab. It opens the fixture in
local headless Chromium through `tests/integration/lib/capture-env.mjs`, which keeps the browser local-only. The run
held the repository's heavy-step lock.

- The site (`site-a`), the repository (`acme-fixture/handbook`) and the accounts (`fixture-user-a`, `fixture-user-b`)
  are fictional. The tokens are low-entropy placeholders (`test-token-000n-placeholder`), nothing like a provider
  token. The token field is masked in every screenshot and recording (asserted), and `evidence.json` writes each
  request body and field value as a label (`<TOKEN_A>`, `<TOKEN_B>`), never the value (also asserted).
- Every API request is answered by interception on the fixture origin; those answers are the mock, not the server:
  - The status `GET` answers "not connected" (`null`), or a 403 once when a state asks for it.
  - An authorization `POST` can be held until the script releases it. It is then refused with a 400, or answered with
    the token's fictional account, as the server's read-only identity check would.

No server, database or Git provider was used, and no request left the fixture origin (`attempted: 0`). The temporary
build was deleted after the run.

## Files

| Files | What it shows |
| --- | --- |
| `states-390.png`, `states-1440.png` | Main (left) and this branch (right), EN then AR, in seven states. Each panel is captioned with the step, the token field (as a label), the POSTs, the Authorize button, the inline error, the account, the refreshed keys and the toasts. |
| `flow-before-en-1440.webm`, `flow-after-en-1440.webm` | Token A checked and held, the token edited to B, A's answer, then the retry for B on this branch. The steps are listed below. |
| `evidence.json` | Every panel's and every step's readback and every request, bodies as labels. |

### The seven states

- **Step 1, nothing typed:** unchanged; Authorize is disabled under 20 characters.
- **Verified (control):** the same on both. One POST, `["git-workflow","site-a"]` refreshed, step 2.
- **Refused (control):** the same on both. The token stays, the existing error shows once, nothing is refreshed, no
  toast.
- **A checked (held), edited to B, A verified:** main moves on to step 2 while the field holds B, and its review
  names A's account (`@fixture-user-a`). Here the edit retired the check: step 1, B in the field, Authorize ready, no
  account. Both refresh site A, because the request still completes for its site.
- **A checked (held), edited to B, A refused:** main shows the refusal under B. Here nothing shows.
- **Authorize pressed three times in one task (held):** main sends three POSTs. Here one, busy.
- **A checked (held), a status read fails (403) so the error screen replaces the wizard, then A verified:** the
  answer's own refresh brings the wizard back. Main comes back on step 2: the answer that arrived while the wizard
  was hidden was applied anyway. Here it comes back on step 1, idle.

Arabic lays out from the right, and nothing overflows; this is asserted for every panel.

## The recording, step by step

1. Type token A and press Authorize GitHub. The request is held, so the button is busy.
2. Edit the token to B. On main the button stays busy. Here it is ready again.
3. The fixture answers A as verified. Main moves on to step 2. Here the wizard stays on step 1 with B.
4. Main: fill the repository and go to the review, which names A's account while the token kept for Connect is B.
   Here: press Authorize GitHub again (the retry for B). It is held, then verified, and the review names B's account.

POSTs: main `<TOKEN_A>`; this branch `<TOKEN_A>`, `<TOKEN_B>`, all `POST /api/app/projects/site-a/git/authorize`.
Connect was not pressed in any capture.
