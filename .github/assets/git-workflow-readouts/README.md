# Settings → Git, connected: status header, pull request previews and recent operations, moved unchanged

**This is a component fixture only. It is not the dashboard and not production.** These captures put main's
`GitWorkflow` beside this branch's, in English and Arabic at 390 px and 1440 px (light theme, UTC). Main renders the
status header, previews and history inline. This branch renders them through
`features/site-git/components/git-workflow-readouts.tsx`. The captures prove nothing about real sites, the server, a
real repository or screen readers. Nothing was read from any Git provider.

## How they were made

`capture.mjs` builds a temporary Vite fixture from the real code:

- **Before** is main's `git-workflow.tsx` and its whole `features/site-git` slice at the pinned base `a804d679` (#788),
  read with `git show`.
- **After** is this branch's component.

Both sides share the design system, the EN/AR catalogs, `hooks/api`, `FailureMessage`, `lib`, services and the app's
own `createQueryClient`. The script first asserts that none of those changed since the base (`unchangedSinceBase` in
`evidence.json`), so the before side is immutable and doesn't mix in modules this branch changed. It opens the fixture
in local headless Chromium through `tests/integration/lib/capture-env.mjs`, which keeps the browser local-only. The run
held the repository's heavy-step lock.

- The site (`site-1`), the repository, pull requests, previews and operations are fictional. Their IDs are
  low-entropy (`op-1`, `pr-3`, `pv-9`) and none is a UUID.
- `GET …/git` (the status) is answered by interception. In the keyboard steps it is held until the script releases it.
  That answer is the mock, not the server.
- No operation in the captured states is queued or running, so nothing polls during a capture. The 2.5 s polling is
  covered by `git-workflow-readouts.test.tsx` instead.

No server, database, worker or Git provider was used, and no request left the fixture origin (`attempted: 0`). The
temporary build was deleted after the run.

## Files

| Files | What it shows |
| --- | --- |
| `states-390.png`, `states-1440.png` | Main (left) and this branch (right), EN then AR, on Overview. **Empty**: an unknown last-sync status, no pull request and no operation. **Mixed**: previews with the first listed one shown (a failed first preview hides a later ready one, as on main), draft before state, Arabic titles and paths, and history in the order given. **Failure**: the last sync failed and an operation failed, with details collapsed. Arabic lays out from the right, and nothing overflows. |
| `evidence.json` | For every state, width and locale, on each side: SHA-256 of the whole connected screen's markup and of each readout, a full-page pixel hash, the links (name, href, target, rel), Refresh (name, busy, disabled, focus), and the status query with its observer count. Also the keyboard Refresh steps below. |

For every state, width and locale, the script asserts that before and after are identical. That covers the markup
(`main.innerHTML` string-equal), each readout's digest and the full-page pixels. The query cache holds exactly one
query, `['git-workflow', 'site-1']`, with one observer, read once.

## Keyboard and Refresh (no recording)

Nothing on these readouts changes over time except Refresh's busy state, so there is no recording. The steps are
recorded in `evidence.json` (`keyboard`) for both widths and locales, and are the same before and after:

1. Refresh focused, then **Enter**: the status is read once (2 reads in total), and the button is busy and natively
   `disabled`.
2. **Enter** again while busy: nothing more is read.
3. The read is answered: the button is idle again.
4. Refresh re-focused, then **Space**: read once more (3 reads in total), then answered.

State is read after two animation frames. A busy `disabled` button loses focus to the page body at Chrome's next
rendering step, on main and here alike (`focusOnBody: true`). This branch keeps that as is.

## Not changed, recorded as is

- Statuses, PR states and operation kinds are shown raw, untranslated, in Arabic too.
- A pull request shows `previews[0]` as listed, even when a later preview is ready and has a link.
- Changed files are keyed by path, so two entries with the same path in one operation would collide.
- Refresh loses keyboard focus while busy (above).
