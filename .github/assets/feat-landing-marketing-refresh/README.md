# Media and evidence for "rebuild the landing page around real product captures"

## Page captures

Captured on 2026-11-07 with headless Chrome (Playwright) against local production
builds served by `node .output/server/index.mjs`:

- `before-*`: `origin/main` at `ed15240e`. The landing component is unchanged on
  later `main` commits up to this PR's merge base, so the screens are the same.
- `after-*`: this branch at `92f60b96`.

| File pattern | What it shows |
| --- | --- |
| `{before,after}-home-{en,ar}-desktop-{light,dark}.webp` | First screen at 1440×900. |
| `{before,after}-home-{en,ar}-mobile390-{light,dark}.webp` | First screen at 390×844, 2× pixel density. |
| `{before,after}-home-{en,ar}-{desktop,mobile390}-light-full.jpg` | The whole page, scaled down. |
| `after-home-{en,ar}-desktop-light-scroll.gif`, `after-home-{en,ar}-mobile390-dark-scroll.gif` | A scroll through the whole page. |

## Product captures on the page

The landing's images are real captures of the running product, compressed to AVIF
and WebP in `apps/app/src/components/marketing/media/assets/`:

- **Ask AI** (hero phone and the Ask AI section): the reader chat captures from
  #279 (`.github/assets/ai-chat-assistant/`). Those answers were generated live
  through OpenRouter on a fictional "Acme Notes" site.
- **Search, insights, editor, Arabic reader and the hero's desktop page**:
  captured fresh on 2026-11-07 from a local stack (app, API, worker, Postgres,
  Redis, ClickHouse, S3) with the seeded demo account (`demo@nibleaf.test`) and
  fictional content.
  - The help articles and their Arabic translations were created and
    published through the support MCP itself: a scoped personal key, then
    `create_page_draft`, `translate_page`, `preview_publish` and `publish_changes`.
  - Reader visits, searches (some with no results), AI-assistant referrals
    and AI-crawler fetches were simulated against the local public site, so
    the insights screens show real reports of that local traffic.
- **The support MCP recording**: the real Claude Code session replay from #280
  (`.github/assets/feat-support-mcp/ai-client-journey.gif`), re-encoded as
  VP9 WebM. Lines are unedited except that Arabic text shows as `[Arabic]` in
  that terminal view and preview tokens are shortened. It plays only when a
  visitor presses play.

No API key, token or personal data appears in any file.

## Open Graph cards

`apps/app/public/brand/raster/social/nibleaf-og-home{,-ar}.png` (1200×630) were
rendered from an HTML template with the product's fonts (Geist and Noto Sans
Arabic) and two of the real captures above.

## Lighthouse

`lighthouse-summary.json` holds the median scores and metrics (performance,
accessibility, best practices, SEO, LCP, FCP, CLS, TBT, speed index, transfer)
from Lighthouse 12.8 (5 runs each) against local production builds behind a
brotli proxy. Production serves brotli through Cloudflare; the local Nitro server
doesn't compress. The full reports aren't committed: they are large and change on
every run.

- `before` is `origin/main` at `c6ae297f`; `after` is this branch at `92f60b96`.
- The two were measured back to back on the same machine.

## Audit and fact check

- `audit.md` is the ranked audit of the old landing and marketing pages, written
  from four personas: a support lead, a docs owner, a developer comparing tools
  with Mintlify, and an Arabic visitor on a 390px phone.
- `fact-check/` holds the independent fact check, done against the code at
  `ed15240e` and against official competitor pages on 2026-11-07:
  - `facts.md`: verified capabilities;
  - `claims-audit.md`: every marketing claim checked;
  - `competitors.md`: dated competitor sources;
  - `copy-notes.md`: the evidence for each claim in the new landing copy.
