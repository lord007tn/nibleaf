# Media for "add use-case pages for support, product and API teams"

Captured on 2026-11-07 with headless Chrome (Playwright). The source was a local
production build of this branch, served by `node .output/server/index.mjs`.

The six use-case pages are new, so they have no "before". The landing page
before this PR is the "after" of #332: see `after-home-*-full.jpg` in
`.github/assets/feat-landing-marketing-refresh/`.

| File pattern | What it shows |
| --- | --- |
| `after-{use-cases,ar-use-cases}-<slug>-{desktop,mobile390}-{light,dark}.webp` | First screen at 1440×900, or at 390×844 with 2× pixel density. |
| `after-{use-cases,ar-use-cases}-<slug>-{desktop,mobile390}-light-full.jpg` | The whole page, scaled down, to read the copy in context. |
| `after-{use-cases,ar-use-cases}-support-teams-desktop-light-scroll.gif`, `…-mobile390-dark-scroll.gif` | A scroll through the support-teams page in English and Arabic. |
| `after-home-{en,ar}-use-cases-teaser-{desktop,mobile390}-{light,dark}.webp` | The new "Use cases" section on the landing page. |
| `after-home-{en,ar}-nav-desktop-light.webp` | The header with its new "Use cases" link. |

Slugs: `support-teams`, `product-docs`, `api-docs`.

The captures inside the pages are #332's product captures plus two new ones,
the reader themes and the dashboard. All of them show the same fictional demo
notes app.

The API use case has no API reference capture yet. Its OpenAPI section is
text only, so it doesn't borrow an unrelated image. No personal data appears in
any file.
