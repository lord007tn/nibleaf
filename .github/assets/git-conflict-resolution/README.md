# Git → two-way sync → Reconcile conflicts: one resolution per conflict, reported only into its own card

**These are component-fixture captures only. They are not the dashboard and not production.** They show Settings → Git → the
two-way sync panel's conflict cards, with main's `GitWorkflow` and inline `ConflictCard` beside this branch's. Each state
is shown in English and Arabic at 390 px and 1440 px (light theme), and there is one recording of each version. They
prove nothing about real sites, the server, real repositories, Git providers or screen readers. No conflict was
resolved anywhere.

## How they were made

`capture.mjs` builds a temporary Vite fixture from the real code:

- main's `git-workflow.tsx` and `useResolveGitConflict` (with the `useGitWorkflowMutation` helper it used), read with
  `git show` at the pinned base `9f4e4178`;
- this branch's `GitWorkflow` and `features/site-git` card;
- the design system, the EN/AR catalogs and the app's own `createQueryClient`, wrapped to record which keys are
  invalidated.

The fixture keys the panel by site (`git-${projectId}`), as the settings page keys the Git tab, so leaving for another
site is an unmount. It opens the fixture in local headless Chromium through `tests/integration/lib/capture-env.mjs`,
which keeps the browser local-only. The run held the repository's heavy-step lock.

- The sites (`site-a`, `site-b`), repositories (`acme-fixture/handbook`, `acme-fixture/guides`) and conflicts are
  fictional. Conflict ids are synthetic. `evidence.json` writes them as `<id#n>`; the same number means the same id.
- Every API request is answered by interception on the fixture origin; those answers are the mock, not the server:
  - The status `GET` returns the site's open conflicts.
  - A resolution `POST` can be held until the script releases it. It is then refused with a 409 the script queued, or
    resolved as the server's `resolveGitConflict` does: the first resolution of an open conflict resolves it, so the
    next status read no longer lists it, and a later resolution returns the resolved conflict unchanged.
  - The status read after a success can be held too.

No server, database, worker or Git provider was used, and no request left the fixture origin (`attempted: 0`). The
temporary build was deleted after the run. `evidence.json` names the base and the head, and records every request with
its JSON body.

## Files

| Files | What it shows |
| --- | --- |
| `states-390.png`, `states-1440.png` | Main (left) and this branch (right), EN then AR, in eight states. Each panel is captioned with its POSTs and their bodies, the busy cards, the refreshed keys and the toasts. The states are listed below. |
| `flow-before-en-1440.webm`, `flow-after-en-1440.webm` | A refused custom resolution, its retry, leaving for site B and coming back while it runs, Use Git, and the success with its status read held. The steps are listed below. |
| `evidence.json` | Every panel's and every step's readback: each card's sides, custom text and busy and disabled buttons; the toasts; the refreshed query keys; and every request. |

### The eight states

- **Ready:** unchanged.
- **All four buttons pressed in one task, held:** main sends four POSTs for one conflict (`OURS`, `THEIRS`,
  `CUSTOM` with the Nibleaf text, and `CUSTOM` with `null`). This branch sends one.
- **Site A resolving, leave for B and back to A, press Use Git:** main shows the conflict idle on return and sends a
  second, conflicting POST (`THEIRS`). Here the conflict is still busy and nothing more is sent.
- **Leave for B, then A succeeds:** the same on both. Only `["git-workflow","site-a"]` is refreshed and nothing is
  reported.
- **Leave for B, then A is refused:** the same on both. Nothing is refreshed and nothing is reported.
- **Custom text (Arabic, newlines) refused:** the same on both. The exact text is sent, the error appears once,
  nothing is refreshed, and the text stays in the field.
- **One conflict resolving while another is resolved:** the same on both. The second conflict stays usable.
- **Programmatic, two copies of one panel:** the settings page never mounts this. Main sends two conflicting POSTs;
  here one, with both copies busy.

Arabic lays out from the right, and nothing overflows; this is asserted for every panel.

## The recording, step by step

1. Type a custom resolution (Arabic heading, newlines), then press Use custom. The request is held, so the card is
   busy. The fixture answers 409, and the card shows the existing error once. Nothing is refreshed, and the text stays.
2. Press Use custom again (the retry). It is sent with the same body and held.
3. Leave for site B, then come back to site A while the retry runs. On main the card is idle; here it is still busy.
   On both, the returning card is new, and its custom text starts again from the Nibleaf version, as it did before.
4. Press Use Git. Main sends a third POST (`THEIRS`) for the conflict. Here nothing is sent.
5. The fixture answers, and the status read after it is held. Here the card stays busy until that read. On main,
   the second POST's refresh starts its own read, and the card leaves.
6. The status read answers. On both, intro.md has left the list and setup.md is still there.

In total, every POST was `POST /api/app/projects/site-a/git/conflicts/<id#1>/resolve`: three on main
(`CUSTOM`, `CUSTOM`, `THEIRS`) and two here (`CUSTOM`, `CUSTOM`).
