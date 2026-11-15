# Site navbar: one draft per scope

**Component fixture, not the dashboard and not production.** These captures show Site configuration → Navbar as it
opens in the editor's Configuration canvas, before (`main`, the merge base in `evidence.json`) and after this branch.
Nothing here shows a published site; the reader is covered by `apps/app/src/routes/sites/$projectId/-reader-navbar.test.tsx`.

## How they were made

`capture.mjs` builds a temporary Vite fixture from the real code: the section, the design system, the EN/AR catalogs,
the project and languages queries, both mutations, `ConfirmProvider` and Sonner's `Toaster`. It opens the fixture in
the local headless Chromium through `tests/integration/lib/capture-env.mjs`, which keeps the browser local-only.

The site ("Handbook"), its navbar and its Arabic override are fictional and public. Requests are answered by
interception on the fixture origin:

- the project and languages `GET`s are served from an in-page store;
- the project `PATCH` merges `config.navbar` one level deep (arrays replace), as the API does;
- the language `PATCH` replaces the language's `navbar` whole, or drops it on `null`, as the API does;
- one `PATCH` in the recording is refused with a 500, on purpose.

No server or database was used, and 0 requests left the fixture origin. "Before" swaps in main's `navbar-section.tsx`
(with the two compact field tokens it imported, which this branch removes from `shared.tsx`, inlined from main);
nothing else differs. The temporary build was deleted after the run.

## Files

| Files | What it shows |
| --- | --- |
| `project-{en,ar}-{1440,390}.png` | The Default scope, before (left) and after (right), light theme, UI in English or Arabic. Before: placeholder-only row fields, three inputs and Remove squeezed into one anchor line (cut off at 390 px), and a Save button even when nothing changed. After: every row field has a persistent label (the existing "Link label", "Link URL" and "Icon" copy); rows stack below ~30rem (anchors ~36rem) of row width; addresses and icons are left to right in Arabic too; no save bar until something changes. No horizontal overflow at 390 px. |
| `language-{en,ar}-{1440,390}.png` | The Arabic scope, same layout. The CTA label and the links are the override's, written right to left; the CTA URL and both switches are the project's, read-only, with "Applies to all languages — edit in the Default scope." |
| `flow-en-1440.webm` | Add, Remove, Undo, clearing the CTA, a refused save, a save and a discard. The steps are listed below. |
| `main-tests.txt` | The new component suite run against main's component, with the three regressions in detail. |

## The recording, step by step

`evidence.json` → `recordings[0].steps` records the fields, the focused control, the toasts, the save bar, the
announced status and overflow at each step:

1. The stored navbar opens with no save bar.
2. **Add link** puts focus on the new row's label; `Pricing`, Tab, `/pricing`.
3. **Remove link Blog** (the button's computed name includes the row): the row leaves the draft, focus moves to the
   next row's Remove ("Remove link Pricing"), and "Removed · Undo" is offered.
4. **Undo** (the real Sonner toast) puts Blog back in place with `external: true`; focus is on its "Link label" field,
   not handed back to Remove by the toast (#751).
5. The only tab is removed, and both CTA texts are cleared.
6. Ctrl+S is refused by the server: one "Could not save" toast, the draft kept, the tab's Undo still offered, no
   "Saved".
7. Ctrl+S again: the same body is sent (`ctaLabel: ""`, `ctaUrl: ""`, `tabs: []`, the new link last, `external` and
   the icon kept), a refetch follows, the bar says "Saved" and closes, and the stale Undo is gone.
8. The search switch alone dirties the form; **Discard** turns it back on and closes the bar.
