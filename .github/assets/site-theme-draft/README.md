# Site themes: one authored draft

**Component fixture, not the dashboard and not production.** These captures show Site configuration → Themes as it
opens in the editor's Configuration canvas, before (`main`, the merge base in `evidence.json`) and after this branch.
Nothing here shows a published site.

## How they were made

`capture.mjs` builds a temporary Vite fixture from the real code: the section, the design system, the EN/AR catalogs,
the project query, the project PATCH, the theme import and export mutations, `ConfirmProvider` and Sonner's `Toaster`.
It opens the fixture in the local headless Chromium through `tests/integration/lib/capture-env.mjs`, which keeps the
browser local-only.

The site ("Handbook"), its theme and the pasted template ("Field notes") are fictional and public. Requests are
answered by interception on the fixture origin:

- the project `GET` is served from an in-page store;
- the project `PATCH` merges each config section one level deep, as the API does;
- the template preview, apply and export run the shared theme functions `apps/server/src/actions/themes.ts` uses
  (template validation is not repeated: the fixture's template is valid);
- one save and one apply are refused with a 500, on purpose.

No server or database was used, and 0 requests left the fixture origin. "Before" swaps in main's `theme-section.tsx`;
nothing else differs. The temporary build was deleted after the run. The recording was re-encoded afterwards
(`ffmpeg -i flow-en-1280.webm -c:v libvpx-vp9 -b:v 0 -crf 42 -an`, Playwright's bundled ffmpeg) to keep it small.

## Files

| Files | What it shows |
| --- | --- |
| `open-{en,ar}-{1440,390}.jpg` | The section as it opens, before (left) and after (right), light theme, UI in English or Arabic. Before: "Cancel" and "Save changes" always on screen. After: no save bar until something changes (the page's shared bar saves and discards); the contrast readout, Undo, Reset, preview and template tools are as they were. No horizontal overflow at 390 px. |
| `flow-en-1280.webm` | Preset, Undo, an invalid colour, a refused and a failed save, a save, Discard, a template preview, a failed apply, and an apply over unsaved edits. Steps below. |
| `main-tests.txt` | The lifecycle suite run against main's component, with the two regressions in detail. |

## The recording, step by step

`evidence.json` → `recordings[0].steps` records the active preset, the marked colours, focus, dialogs, toasts, the save
bar and the announced status at each step:

1. The stored Signal theme opens with no save bar.
2. **Manuscript** dirties the draft; **Undo** goes back to Signal and the bar closes.
3. Manuscript again, then a light text colour (`#eeeeee`) that fails contrast. Leaving it marks both colours of the
   failing pair (`aria-invalid`, described by the contrast readout).
4. Ctrl+S is refused before any request: "Fix the highlighted fields to save.", focus on the first marked colour.
   **Undo** restores the colour and nothing is marked.
5. Ctrl+S is refused by the server: one error toast, the draft kept, no "Saved". Ctrl+S again saves; the body is
   `{ config: { theme } }` only. Styling's colour and radius are never sent and stay as stored.
6. Dark appearance dirties the draft; **Discard** puts it back.
7. A pasted template: **Preview import** lists the proposed changes and writes nothing.
8. **Apply to draft** is refused by the server: the apply error, with the text and preview kept.
9. Harbor picked (unsaved), then **Apply to draft** asks first. "Keep editing" writes nothing; "Discard changes"
   applies at once, as main did, and the clean draft shows the imported Manuscript.
