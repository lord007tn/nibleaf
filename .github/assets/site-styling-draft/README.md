# Site styling: color and radius on one draft, saving only what changed

**Component fixture, not the dashboard and not production.** Captures of Site configuration → Styling as it opens in
the editor's Configuration canvas: main's section beside this branch's, in English and Arabic at 1440 px and 390 px
(light theme), and one recording of the new form in use. Nothing here says anything about real sites, phones or screen
readers.

## How they were made

`capture.mjs` builds a temporary Vite fixture from the real code: main's section (read with `git show origin/main:…`)
and this branch's (through its compatibility re-export `components/project-settings/styling-section.tsx`), the design
system, the EN/AR catalogs, the project query and the save mutation. It opens the fixture in the local headless
Chromium through `tests/integration/lib/capture-env.mjs`, which keeps the browser local-only. It was run while holding
the repository's heavy-step lock.

The site ("Handbook") is fictional: a Harbor theme, a stored color `#5546e8`, the Theme section's appearance `dark`, and
no radius. Every request is answered by interception on the fixture origin: the project `GET` from an in-page store, a
project `PATCH` merging `config.styling` key by key (a stand-in for the API; the real validator and merge are covered by
`apps/server/src/actions/projects.test.ts`). No server, database or real site was used, and 0 requests left the fixture
origin. The temporary build was deleted after the run.

## Files

| Files | What it shows |
| --- | --- |
| `invalid-hex-{en,ar}-{1440,390}.png` | Before (main) and after (this branch), the same unsaved draft: Pill chosen and a partial `#12` typed and left. Main shows nothing until a save's toast; this branch marks the field (`aria-invalid`, described by the localized `invalidHex` message) and shows the page's save bar. The hex reads left to right in Arabic; the slider tracks run from the start side. No `PATCH` was sent and nothing overflows at 390 px (asserted for every still). |
| `flow-en-1440.webm` | The new form in use, step by step below. |
| `evidence.json` | Every still's and step's readback: the hex, its problem and description, the sliders, the radius, toasts, the save bar and its status, focus, requests and the fixture's stored styling. |
| `main-tests.txt` | The branch's query-backed component tests run against main's component: a color-only save sends `radius: "rounded"` for an unset radius, and a clean refetch leaves main's controls on the old color and radius. |

## The recording, step by step

1. Pristine: no save bar.
2. The green preset; the sliders follow it. The hue slider moved 20 steps with the keyboard.
3. A partial `#12`: nothing shows while typing; leaving the field shows the problem on it.
4. Save: refused, the field focused, the status says "Fix the highlighted fields to save.", nothing sent.
5. The short `#0ea`: the problem clears, the field keeps `#0EA`. Save sends `{ "styling": { "primaryColor": "#00eeaa" } }`
   alone; the stored appearance `dark` is kept and no radius is written. The form is clean on `#00EEAA`.
6. Pill, then Discard: back to the stored radius (unset, shown as Rounded), no save bar.
7. A preset saved while the fixture answers 503: one error toast, the edit kept, the save bar still up.

## What the reader does with these values (unchanged here)

`resolveTheme` (`packages/shared/src/themes.ts`) and `lib/site-theme.ts`:

- A site without `config.theme` (pre-v1) draws `styling.primaryColor`, or `#5546e8` when none is stored: what the
  control shows for an unset color.
- A themed site uses `primaryColor` as a mode's accent only where `config.theme.colors.<mode>.accent` is not set, nudged
  until it reads as text on that mode's canvas. With no `primaryColor`, the preset's accent applies, while the control
  still shows `#5546E8` (its existing presentation).
- A stored `styling.radius` replaces `config.theme.layout.radius`; with none stored the theme's or preset's radius
  applies, while the control shows Rounded (its existing presentation). Choosing Rounded again over an unset radius
  keeps it unset.
- `styling.theme` (the appearance) is read by `siteAppearance`; this form never sends it. The Theme section still saves
  the appearance with a spread of the query's `styling` (the duplicate control, not consolidated here).
