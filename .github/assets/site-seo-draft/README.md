# Site SEO: one draft per scope, an upload that belongs to its draft

**Component fixture, not the dashboard and not production.** Before (`main`, the merge base in `evidence.json`) and
after captures of Site configuration → SEO as it opens in the editor's Configuration canvas, in English and Arabic at
1440 px and 390 px. Each PNG puts the **light** theme (left) and the **dark** theme (right) side by side, under a
caption naming the phase, scene, locale and width. Nothing here says anything about search engines, phones or screen
readers.

## How they were made

`capture.mjs` builds a temporary Vite fixture from the real code: the section, the design system, the EN/AR catalogs,
the project and language queries, both save mutations and the shared upload hook (presign → PUT → confirm). It opens
the fixture in the local headless Chromium through `tests/integration/lib/capture-env.mjs`, which keeps the browser
local-only. It was run while holding the repository's heavy-step lock.

The site ("Handbook"), its Arabic language (with a banner override that belongs to another form) and the uploaded PNG
are fictional. Every request is answered by interception on the fixture origin:

- the project and language `GET`s are served from an in-page store;
- a project `PATCH` merges `config.seo` key by key; a language `PATCH` does the same, and `config: null` drops the
  language's SEO and keeps its banner. That is a stand-in for the API; the real merges are covered by
  `apps/server/src/actions/projects.test.ts` and `languages.writes.test.ts`;
- the upload's presign, `PUT` and confirm are answered there too.

No server, database or storage was used, nothing was uploaded, and 0 requests left the fixture origin. "Before" swaps
in the baseline `seo-section.tsx`; nothing else differs. The temporary build was deleted after the run.

## Files

| Files | What it shows |
| --- | --- |
| `pristine-{before,after}-{en,ar}-{1440,390}.png` | The saved project SEO. Before: loose fields, a separate toggle row and the section's own Save button, always shown (disabled while clean). After: one `SettingsSection` panel of rows with the same labels and hints, and no save bar while nothing has changed. The social image reads left to right in Arabic too. |
| `arabic-draft-after-{en,ar}-{1440,390}.png` | The Arabic scope: an uploaded image fills the draft, an Arabic title is typed right to left, the empty description shows the inherited project text, and the page's save bar says the draft is unsaved. No `PATCH` was sent (asserted for every still capture). |
| `flow-after-en-1440.webm` | The new form in use (light theme), step by step below. |
| `main-tests.txt` | One upload race run against main's component and this branch's: main lets a late upload overwrite a URL typed meanwhile. |

## The recording, step by step

`evidence.json` → `recordings[0].steps` reads back every step: the field values, whether the upload runs, the toasts,
whether Save shows, the save bar's status, the request count and the fixture's stored SEO.

1. In the Default scope an image is chosen; the confirm is held for 1.8 s.
2. **Race:** the scope switches to Arabic while it runs (clean, so no confirmation). The late result fills nothing
   there, and nothing is unsaved.
3. An image is uploaded in the Arabic scope: the URL fills the draft only, with no `PATCH`.
4. An Arabic title is typed, then Save: one `PATCH …/languages/ar` with all four values, a refetch of the languages,
   and the status says "Saved". The stored Arabic SEO is there and its banner is kept.
5. Both fields are cleared and saved: the request is `{ "config": null }`. The stored Arabic SEO is gone, its banner
   kept.
6. Back to Default: the project SEO is unchanged.
