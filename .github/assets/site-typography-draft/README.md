# Site typography: one draft for all six values

**Component fixture, not the dashboard and not production.** These are before (`main`, the merge base in
`evidence.json`) and after captures of Site configuration → Typography as it opens in the editor's Configuration
canvas, in English and Arabic at 1440 px and 390 px. Each PNG puts the **light** theme (left) and the **dark** theme
(right) side by side, under a caption naming the phase, locale and width.

## How they were made

`capture.mjs` builds a temporary Vite fixture from the real code: the section, the design system, `typeset.css`, the
EN/AR catalogs, the project query (`useProject`) and the config mutation. It opens the fixture in the local headless
Chromium through `tests/integration/lib/capture-env.mjs`, which holds the dev-stack lock and keeps the browser
local-only.

The site ("Handbook") is fictional. It is saved with the Compact rhythm (15 / 1.6 / Snug), Inter and Fira Code, and a
heading font outside the catalog (`Merriweather`), plus an unrelated `branding` section. Every request is answered by
interception on the fixture origin: the project `GET` from an in-page store, and the config `PATCH` merged one level
deep, as the API does, so the refetch after a save reads the merged values back. No server, database or font download
was used, and 0 requests left the fixture origin. "Before" swaps in the baseline `typography-section.tsx`; nothing else
differs. The temporary build was deleted after the run.

## Files

| Files | What it shows |
| --- | --- |
| `pristine-{before,after}-{en,ar}-{1440,390}.png` | The saved values. Before: a loose header and fields, with a Save button always shown. After: one `SettingsSection` panel of rows, presets next to the rhythm rows they fill, and no save bar while nothing has changed. The site's own heading font shows in its picker in both. |
| `flow-after-en-1440.webm` | The new form in use (light theme): preset → one manual adjustment → Save → refetch, step by step below. |
| `evidence.json` | Every capture's readback: direction, picker values, pressed buttons, the preview's variables, toasts, requests, overflow and page errors. |
| `main-tests.txt` | The new stale-rhythm test run against `main`'s component: it fails, because `main` sends its stale line height back. |

## The recording, read back

Every step's pickers read Merriweather / Inter / Fira Code. "Save" is whether a button named exactly "Save" shows;
at step 4 the save is in flight, so no button named "Save" shows.

| # | Step | Pressed | Preview size / leading / flow | Save |
| --- | --- | --- | --- | --- |
| 1 | Opened: the saved values, Compact pressed (it matches 15 / 1.6 / Snug), no save bar | Compact, 15, 1.6, Snug | 15px / 1.6 / 1em | hidden |
| 2 | Article preset: only size, line height and block spacing change; the preview follows; nothing is saved | Article, 17, 2.0, Roomy | 17px / 2 / 1.5em | shown |
| 3 | Line height set to 1.9 by hand: no preset is pressed any more; the preview follows | 17, 1.9, Roomy | 17px / 1.9 / 1.5em | shown |
| 4 | Save pressed: saving | 17, 1.9, Roomy | 17px / 1.9 / 1.5em | hidden |
| 5 | Saved and refetched: the form shows what the server holds, no save bar | 17, 1.9, Roomy | 17px / 1.9 / 1.5em | hidden |

The single `PATCH` sent `{"config":{"typography":{"baseSize":"17","leading":"1.9","flow":"1.5"}}}`: the three values
that changed, no preset name and no other section. The store's `branding` section was unchanged afterwards.
