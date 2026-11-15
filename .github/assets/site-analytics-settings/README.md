# Site analytics settings: one draft form

**Component fixture, not the dashboard and not production.** Before (`main@b0e063ca`)
and after (`532588d4`) captures of Site settings → Integrations → Analytics as it
opens in its integration detail, in English and Arabic at 1440 px and 390 px.
Each PNG puts the **light** theme (left) and the **dark** theme (right) side by
side under a caption naming the phase, scene, locale and width.

How they were made (`capture.mjs`): a temporary Vite build of the real section,
design system and EN/AR catalogs, opened in the local headless Chromium through
`tests/integration/lib/capture-env.mjs` (dev-stack lock, local-only browser). The
site is fictional (GA4 id `G-4H7K2M9Q1Z`, consent add-on on). The only API call,
the config `PATCH`, was answered by interception, merging `config.analytics` one
level deep as the API does. No server, database or analytics provider was used,
and 0 requests left the fixture origin. "Before" swaps in the baseline
`analytics-section.tsx`; nothing else differs. The temporary build was deleted
after the run.

| Files | What it shows |
| --- | --- |
| `pristine-{before,after}-{en,ar}-{1440,390}.png` | The saved values, both opt-ins off. Before: a save button is always shown. After: the section is one `SettingsSection` panel of rows, and there is no save bar while nothing changed. |
| `dirty-{before,after}-{en,ar}-{1440,390}.png` | A Plausible domain typed and Campaign dimensions switched on. After: the page's save bar says "Unsaved changes" with Discard and Save. |
| `error-{before,after}-{en,ar}-{1440,390}.png` | `UA-1234-1` typed in the GA4 field, then Enter. Before: the error was already showing while typing. After: no error while typing (`errorsWhileTyping: []` in `evidence.json`); Enter submits, the error shows under the field, focus moves to it, and nothing is sent. |
| `flow-after-en-1440.webm`, `flow-after-ar-390.webm` | The new form in use (light theme): an invalid id gets no error while typing, then shows one on leaving the field, and the error clears once the id is fixed. Then a switch on, Save (the fixture holds the response for 1.2 s), a domain typed during the save that survives the response and stays unsaved, then Discard back to what the server holds. |

`evidence.json` records, for every capture and every recording step, the field
values and their `dir` (always `ltr`, also in Arabic), the switch states, the
validation messages on screen, whether a "Save changes" button shows, the request
bodies, page errors (none) and horizontal overflow (none). While a save is in
flight the button reads "Saving…", so `saveButtonVisible` is false at that step.
