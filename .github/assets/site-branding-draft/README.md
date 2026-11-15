# Site branding: one draft form, uploads that belong to their request

**Component fixture, not the dashboard and not production.** These are before (`main`, the merge base in
`evidence.json`) and after captures of Site configuration → Branding as it opens in the editor's Configuration
canvas. Each one is in English and Arabic at 1440 px and 390 px. Each PNG puts the **light** theme (left) and the
**dark** theme (right) side by side, under a caption naming the phase, scene, locale and width.

## How they were made

`capture.mjs` builds a temporary Vite fixture from the real code:

- the section itself;
- the design system and the EN/AR catalogs;
- the project query (`useProject`);
- the config mutation;
- the shared upload hook (presign → PUT → confirm).

It opens the fixture in the local headless Chromium through `tests/integration/lib/capture-env.mjs`, which holds
the dev-stack lock and keeps the browser local-only.

The site ("Handbook") and the uploaded image are fictional. The image is a small SVG the script writes to its
temporary folder. Every request is answered by interception on the fixture origin:

- the project `GET` is served from an in-page store;
- the config `PATCH` is merged one level deep into `config.branding`, as the API does, so the refetch after a save
  reads the server's merged values back;
- the upload's presign, `PUT` and confirm are answered there too.

No server, database or storage was used, nothing was uploaded, and 0 requests left the fixture origin. "Before"
swaps in the baseline `branding-section.tsx`; nothing else differs. The temporary build was deleted after the run.

## Files

| Files | What it shows |
| --- | --- |
| `pristine-{before,after}-{en,ar}-{1440,390}.png` | The saved values. Before: a loose header and fields, with a Save button always shown. After: one `SettingsSection` panel of rows, and no save bar while nothing has changed. Paths and URLs read left to right in Arabic too. |
| `uploaded-{before,after}-{en,ar}-{1440,390}.png` | An image chosen for "Logo for light mode". Its URL fills only that field, and no `PATCH` is sent (asserted for every capture). After: the page's save bar says "Unsaved changes", and the toast names the field. |
| `upload-failed-after-{en,ar}-{1440,390}.png` | The presign refused with a 413. The favicon keeps its value, and one message says why ("That's too large…") and names the field. |
| `flow-after-en-1440.webm`, `flow-after-ar-390.webm` | The new form in use (light theme), step by step below. |

## The recording, step by step

`evidence.json` → `recordings[].steps` reads back every step:

1. An image is chosen for "Logo for light mode". Only that field's button shows progress.
2. The URL fills that field; the draft is unsaved and nothing is saved.
3. Save sends one `PATCH` with `{ "branding": { "logoDark": … } }`. It is followed by a refetch (`GET`), and the
   form is clean on the server's values.
4. **Race:** a favicon upload is held for 1.6 s while `/brand/typed-meanwhile.svg` is typed into the field. The late
   result does not overwrite it.
5. **Race:** with the logo destination edited, an upload for "Logo for dark mode" starts and the draft is
   discarded. The late result does not bring the draft or the save bar back.
6. **Failure:** an upload is refused. One message names the field, and the value stays.

## What `evidence.json` records

For every capture and every recording step, `evidence.json` records:

- the field values and their `dir` (always `ltr`);
- which upload buttons are busy, and their accessible names (after: "Upload Logo for dark mode"…);
- the toasts on screen;
- whether a "Save changes" button shows;
- every request (bodies for presign, confirm and `PATCH`);
- page errors (none) and horizontal overflow (none).

While a save is in flight the button reads "Saving…", so `saveButtonVisible` is false at that step.

## Before, under the new tests

`main-tests.txt` is the new upload suite run against main's component, with the result of each test.
