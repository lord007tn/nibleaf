# Media for "correct comparison, pricing, FAQ and llms.txt facts"

Captured on 2026-11-07 with headless Chrome (Playwright) against local production
builds served by `node .output/server/index.mjs`:

- `before-*`: `origin/main` at `cfee7a37`.
- `after-*`: this branch with the round-2 scoring fixes (`95e7c324`).

Pages: `/pricing`, `/compare/nibleaf-vs-mintlify` (English) and
`/ar/documentation-platforms` (Arabic, right to left).

| File pattern | What it shows |
| --- | --- |
| `{before,after}-<page>-desktop-{light,dark}.webp` | First screen at 1440×900. |
| `{before,after}-<page>-mobile390-{light,dark}.webp` | First screen at 390×844 (2× pixel density). |
| `{before,after}-<page>-{desktop,mobile390}-light-full.jpg` | The whole page, scaled down, to read the changed copy in context. |
| `after-<page>-desktop-light-scroll.gif`, `after-<page>-mobile390-dark-scroll.gif` | A scroll through the whole page. |

Layouts are unchanged apart from a new "AI and support (rolling out)" group and a second search row in the pricing table. The other differences are the corrected facts, sources and dates.
No personal data appears in any file.
