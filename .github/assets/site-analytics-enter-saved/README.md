# Site analytics settings: Enter says Saved

**Component fixture, not the dashboard, not production, and not a screen-reader
test.** Before (`main`) and after (this branch) captures of Site settings →
Integrations → Analytics after keyboard-only saves, in English and Arabic at
1440 px and 390 px (light theme).

How they were made (`capture.mjs`): a temporary Vite build of the real form, save
region, design system and EN/AR catalogs, opened in the local headless Chromium
through `tests/integration/lib/capture-env.mjs` (dev-stack lock, local-only
browser). Keys are trusted CDP key events, so the browser's own implicit
submission runs. The site is fictional (GA4 id `G-4H7K2M9Q1Z`). The only API
call, the config `PATCH`, was answered by interception with a one-level
`config.analytics` merge, as the API does. No server, database or analytics
provider was used, and 0 requests left the fixture origin. "Before" swaps in the
baseline `analytics-settings.tsx`; nothing else differs. The temporary build was
deleted after the run.

The save region's `role="status"` (`aria-live="polite"`) is visually hidden, so
each capture adds a dashed **fixture readout** under the form. It is not part of
the page. It shows the status text now, every change to that text in order, the
`PATCH` bodies sent and the focused field.

| Files | What it shows |
| --- | --- |
| `enter-saved-{before,after}-{en,ar}-{1440,390}.png` | A new GA4 id, then Enter; a Plausible domain, then Enter. Both phases send the same two valid requests. Before: the status never changes, so nothing is announced. After: it says "Saved" / "تم الحفظ" after each save, clearing in between (history `["", "Saved", "", "Saved"]`). |
| `enter-invalid-{before,after}-{en,ar}-{1440,390}.png` | `UA-1234-1` in GA4, a valid domain in Plausible, then Enter in Plausible. Nothing is sent and focus moves to the GA4 field with its error. After: the status says "Fix the highlighted fields to save." |

`evidence.json` records each capture's status, status history, focus, inputs,
save-bar visibility and request bodies, plus behaviour checks on this branch in
EN and AR:

- Shift+, Ctrl+, Alt+ and Meta+Enter in GA4 send nothing, say nothing, and leave the form dirty.
- A refused save (500) sends one request, keeps the edit, and does not say Saved.
- Enter twice during a slow save sends one request; the status stays empty until that save ends, then says Saved.
- Enter while clean sends nothing and says nothing.
- Ctrl+S still saves and says Saved.

IME composition is not driven here; the unit tests cover it through the shared
key filter in `lib/forms/save-region.tsx`.
