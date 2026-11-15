# SaveRegion says "Saved" only when nothing is left (#759)

**Component fixture, not the dashboard and not production.** Site configuration → SEO stands in for every
`useServerDraftForm` + SaveRegion form. It runs before (`main`, the merge base in `evidence.json`) and after this
branch.

## How they were made

`capture.mjs` builds a temporary Vite fixture twice from the real code:

- the SEO section;
- the design system and the EN/AR catalogs;
- the project query and the config mutation.

"Before" resolves `@/lib/forms/save-region` to main's file; nothing else differs. The fixture runs in the local
headless Chromium through `tests/integration/lib/capture-env.mjs`, which keeps the browser local-only.

The site ("Handbook") is fictional. Requests are answered by interception on the fixture origin:

- the project `GET` is served from an in-page store;
- the config `PATCH` merges `config.seo` and holds its response for a moment, so an edit can be typed during the save.

No server or database was used, and 0 requests left the fixture origin. The temporary builds were deleted after the
run.

The dashed strip above the section is **fixture instrumentation, not product UI**. It shows the text of the
SaveRegion's `role="status" aria-live="polite"` element. The page also records every value that element held,
including old values between commits, and the run asserts there is no false "Saved" in that history. That is the DOM
live-region contract, **not a screen-reader speech certification**. No assistive technology was run.

## Files

| Files | What it shows |
| --- | --- |
| `settlement-{1440,390}.png` | One sheet per width, an EN row and an AR row, light theme. Each row has three panels: (1) main, a title saved with Enter while " (beta)" was typed during the request: the live region says **Saved** though the bar still shows unsaved changes; (2) this branch, same steps: **Unsaved changes**, bar and draft kept; (3) this branch, a clean save: **Saved**, bar gone. |
| `flow-en-1440.webm` | This branch: the steps are listed below. |
| `evidence.json` | Per-step live-region text, its value history, the bar, the title, the conflict callout and every request. |

## The recording, step by step

`evidence.json` → `recordings[0].steps`:

1. Open: no bar, empty region.
2. Enter saves "Handbook Guides" while " (beta)" is typed. The request succeeds, the region says "Unsaved changes", and
   the bar and the newer text stay. The history is `"" → "Unsaved changes"`, with no "Saved".
3. Save: the region says "Saved" and the bar closes.
4. Typing again takes "Saved" back. The region empties once and stays empty while typing.
5. Ctrl+S while someone else renames the site. A background refetch during the request shows their title, the
   "changed elsewhere" callout appears, and the region says "Unsaved changes", not "Saved".
6. "Use their version": nothing is left, so the bar closes. "Unsaved changes" clears silently, and no "Saved" is
   invented for a choice that sent nothing.

## The new tests against main

`apps/app/src/lib/forms/save-region-settlement.test.tsx` uses the real `useServerDraftForm` and `SaveRegionProvider`.
Run against main's `save-region.tsx` (nothing else swapped), 17 of its 28 tests fail. Among them are the #759
reproduction (Sent → refetch Theirs → success keeps the conflict: main says "Saved"), edits during a save, "Keep
mine", Enter while another form is dirty, and the stale (replaced, unmounted, A → B → A) cases. The 11 that pass are
behaviour kept as it was: clean save, normalized echo, pristine no-op, failure, invalid, busy, deferred, all-clean
multi-form, invalid stopping the run, mixed deferred, and identity switch during the save.

## Limits

- One adopter (SEO) is captured. The others are covered by their component suites and by
  `apps/app/src/lib/forms/save-region-settlement.test.tsx`.
- The Theme Studio form (`refactor/site-theme-draft`) was not on main when these were made and is not covered here.
