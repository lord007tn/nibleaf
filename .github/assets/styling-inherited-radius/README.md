# Styling: the inherited corner radius, and a choice that pins it

**Component fixture, not the dashboard and not production.** These are captures of Site configuration → Styling's corner
radius: main's Styling feature beside this branch's, in English and Arabic at 1440 px and 390 px (light theme), plus one
recording of the new behaviour. They say nothing about real sites, phones or screen readers.

## How they were made

`capture.mjs` builds a temporary Vite fixture from the real code. It takes main's Styling feature (component, model and
save hook, read with `git show origin/main:…`) and this branch's, together with the design system, the EN/AR catalogs,
the project query and the save mutation. It opens the fixture in the local headless Chromium through
`tests/integration/lib/capture-env.mjs`, which keeps the browser local-only. The run held the repository's heavy-step
lock.

The site ("Handbook") is fictional. It uses the Signal theme, whose preset radius is Sharp, a stored color `#5546e8`,
the appearance `dark`, and no stored radius. Every request is answered by interception on the fixture origin:

- the project `GET` comes from an in-page store;
- a project `PATCH` merges `config.styling` key by key, as a stand-in for the API.

The real validator and merge are covered by `apps/server/src/actions/projects.test.ts`. No server, database or real
site was used, 0 requests left the fixture origin, and the temporary build was deleted after the run.

## Files

| Files | What it shows |
| --- | --- |
| `radius-{en,ar}-{1440,390}.png` | Three panels each. **Main**: an unset radius shows Rounded, though the site draws Sharp, and clicking that Rounded registers nothing (no save bar). **This branch, as opened**: Sharp pressed, described as inherited from the theme, with no save bar and no request. **After one click on Rounded and one save**: exactly one `PATCH` `{ "styling": { "radius": "rounded" } }`, the color and appearance kept, Rounded described as the site's own. No option is disabled, Arabic lays out from the right, and nothing overflows at 390 px (asserted for every panel). |
| `flow-en-1440.webm` | The recording, step by step below. |
| `evidence.json` | Every panel's and step's readback: the pressed radius, the group's accessible name and description, disabled options, toasts, the save bar and its status, requests and the fixture's stored styling. |
| `main-tests.txt` | This branch's query-backed component tests run against main's feature: 13 of 26 fail. On Signal, main shows Rounded where the reader draws Sharp, and a click on Rounded sends 0 requests. |

## The recording, step by step

1. Opened: Sharp, inherited from Signal, with no save bar.
2. Focused the already-pressed Sharp and pressed **Space**. Sharp is now set for this site and waiting to be saved; the
   keyboard activates the selected option.
3. Discard: inherited again, with no save bar.
4. Rounded, then Save while the fixture answers 503: one error toast, Rounded kept as the site's own, the save bar
   still up, and nothing stored.
5. Save again: one `PATCH` `{ "styling": { "radius": "rounded" } }` is stored, and the form is clean with Rounded as
   the site's own.

## What this does not change

- The reader, the shared `resolveTheme`, the schema and the server merge are unchanged. A stored `styling.radius` still
  replaces `config.theme.layout.radius`.
- There is no "reset to theme": the API can't remove a stored `styling` key, so an override stays until another radius
  is chosen.
- An unset primary color still shows `#5546E8` (tracked separately in #763), and the Theme Studio's own radius control
  is untouched.
