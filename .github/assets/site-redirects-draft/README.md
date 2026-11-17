# Site redirects: one draft for the whole list

**Component fixture, not the dashboard and not production.** These captures show Site configuration → Redirects as it
opens in the editor's Configuration canvas, before (`main`, the merge base in `evidence.json`) and after this branch.
No redirect is followed, and nothing here says how a published site answers.

## How they were made

`capture.mjs` builds a temporary Vite fixture from the real code:

- the section;
- the design system and the EN/AR catalogs;
- the project query (`useProject`);
- the config mutation.

It opens the fixture in the local headless Chromium through `tests/integration/lib/capture-env.mjs`, which keeps the
browser local-only.

The site ("Handbook") and its four rules are fictional and public: one generated when a page moved, one external URL
with a query and fragment, one Arabic source, one with a fragment. Requests are answered by interception on the fixture
origin:

- the project `GET` is served from an in-page store;
- the config `PATCH` replaces `config.redirects` with the array it was sent, as the API's merge does for arrays.

No server or database was used, and 0 requests left the fixture origin. "Before" swaps in main's
`redirects-section.tsx`; nothing else differs. The temporary build was deleted after the run.

## Files

| Files | What it shows |
| --- | --- |
| `pristine-{en,ar}-{1440,390}.png` | Before (left) and after (right), in the light theme. Before: a loose header, rows in their own card, and a Save button even when nothing has changed; at 390 px the longer paths are cut off. After: one `SettingsSection` panel of rows, with Add in its footer and no save bar until something changes. At 390 px the destination goes under its source, so both stay readable. Paths read left to right in Arabic too, and the arrow points the reading way. |
| `invalid-fix-undo-save-en-1440.webm` | The new form: an invalid rule refused and fixed, a row removed and restored, then a save. The steps are listed below. |
| `main-tests.txt` | The new component suite run against main's component, with the stale-Undo regression in detail. |

## The recording, step by step

`evidence.json` → `recordings[0].steps` records the rows, the invalid fields, the problems, the focused control, the
toasts, the save bar and the announced status at each step:

1. The saved rules open with no save bar.
2. **Add redirect**, then `/blog`, Tab, and `//news.example.com`. The row was left, so its problem shows ("Protocol-relative
   external destinations are not permitted; use an HTTPS URL.") and the destination is marked invalid. Nothing is sent.
3. Ctrl+S is refused: focus stays on the destination, the bar says "Fix the highlighted fields to save.", and no `PATCH`
   goes out.
4. The destination is replaced with `/news`; the problem goes as it is fixed.
5. **Remove redirect /legacy**: the row leaves the draft, focus moves to the next row's Remove, and "Removed · Undo" is
   offered.
6. **Undo** puts `/legacy` back in place; the new rule is kept.
7. Ctrl+S saves. One `PATCH` sends all five rules in order, as typed, with their `generated` flags, and is followed by
   a refetch (`GET`). The form is clean on the server's rules and the bar says "Saved".
