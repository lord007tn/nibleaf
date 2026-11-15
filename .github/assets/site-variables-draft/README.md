# Site variables: one draft for the whole list

**Component fixture, not the dashboard and not production.** These captures show Site configuration → Variables as it
opens in the editor's Configuration canvas, before (`main`, the merge base in `evidence.json`) and after this branch.

## How they were made

`capture.mjs` builds a temporary Vite fixture from the real code:

- the section;
- the design system and the EN/AR catalogs;
- the project query (`useProject`);
- the config mutation.

It opens the fixture in the local headless Chromium through `tests/integration/lib/capture-env.mjs`, which keeps the
browser local-only.

The site ("Handbook") and its variables are fictional and public. Requests are answered by interception on the fixture
origin:

- the project `GET` is served from an in-page store;
- the config `PATCH` replaces `config.variables` with the array it was sent, as the API's merge does for arrays.

No server or database was used, and 0 requests left the fixture origin. "Before" swaps in main's
`variables-section.tsx`; nothing else differs. The temporary build was deleted after the run.

## Files

| Files | What it shows |
| --- | --- |
| `pristine-{en,ar}-{1440,390}.png` | Before (left) and after (right), in the light theme. Before: a loose header, rows in their own card, and a Save button even when nothing has changed; at 390 px, long values are cut off. After: one `SettingsSection` panel of rows, with Add in its footer and no save bar until something changes. At 390 px the name stacks above the value. Names read left to right in Arabic too, and values follow their own text. |
| `keyboard-flow-en-1440.webm` | The new form, keyboard only. The steps are listed below. |
| `main-tests.txt` | The new component suite run against main's component, with the stale-Undo regression in detail. |

## The recording, step by step

`evidence.json` → `recordings[0].steps` records the rows, the focused control's name, the toasts and the save bar at
each step:

1. Tab reaches **Add variable**. Enter adds a blank row and puts focus in its name.
2. A name and a value are typed. The draft is unsaved and nothing is sent.
3. Shift+Tab reaches **Remove variable version**, and Enter removes that row. Focus moves to the next row's Remove, and
   "Removed · Undo" is offered.
4. Alt+T, then Tab twice, reaches **Undo**. Enter puts the row back in place; the new row is kept.
5. Ctrl+S saves. One `PATCH` sends all five rows in order and is followed by a refetch (`GET`). The form is clean on
   the server's rows.
