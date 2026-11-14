# Dashboard locale screens

Per-locale captures for the dashboard translation PRs. Four dense screens, using the
actual dashboard shell and routes (`apps/app/scripts/dash-locale-screens.fixture.tsx`)
with fictional API answers from request interception. No server, database or real site:

| Screen      | What it shows                                                                    |
| ----------- | -------------------------------------------------------------------------------- |
| `settings`  | Site settings, General (`/app/projects/handbook/settings?section=general`)       |
| `analytics` | Site analytics, Overview                                                         |
| `people`    | The organization's People page (`/app/o/acme/members`): 7 members, 3 invitations |
| `publish`   | The Publish sheet, opened from the header control: 4 changes, 3 warnings         |

Each one is captured at 1440×1000 and 390×844 (touch), light theme, UTC.

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE=… LOCALES=de,fr node tests/integration/dash-locale-screens/browser.mjs
```

- `LOCALES`: comma-separated interface locales. Default: every locale in `packages/i18n/project.inlang/settings.json`.
- `OUT`: output folder. Default: `.github/assets/i18n-<locales joined by ->`.
- `AXE_CORE`: path to `axe.min.js`. When it is set, the run also checks axe's `color-contrast` rule and records the axe version.
- `ONLY=settings,people`: run only some screens, for debugging. `DEBUG_CAPTURE=1`: build without minifying.

The script takes the dev-stack lock (it fails with `EEXIST` while another run holds it)
and uses the local-only browser: `attempted` in the evidence must be 0.

## Output

The PNGs are named `<screen>-<locale>-<width>.png`. `evidence.json` holds a per-locale
`summary` (leftovers, clipped controls, page errors, overflowing captures) and, for each capture:

- `pageErrors`, `horizontalOverflow` (`scrollWidth > innerWidth`), `htmlLang` and `htmlDir`. The run fails on page errors, a wrong `lang`, or a `dir` that isn't `rtl` for ar and ur.
- `clipped`: buttons, `[role=tab]` and links in tab rows whose text is cut off (`scrollWidth > clientWidth + 1` on the control or an element inside it), or that stick out of their parent row. Scrolling rows, positioned controls and a control's own negative margin are allowed.
- `leftovers`: visible text (an element's own text, at least 3 letters) that equals an `en` catalog value, where `{placeholders}` match anything, and isn't one of this locale's own translations. A key whose locale text is a copy of the English text counts as untranslated. Values in `doNotTranslate` from `packages/i18n/glossary/terms.json`, keys the locale lists as `sameAsEnglish` in `packages/i18n/untranslated/<locale>.json`, and the fixture's own data (names, titles) are excluded. `en` has none by definition. The evidence keeps the count, the number of unique texts and the first 20 with their keys. On the Publish sheet, only the sheet is checked.
