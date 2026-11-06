# Analytics parity: screenshots and walkthroughs

Captured on 2026-11-06 from a local stack (app, API, worker) built from this branch. It ran against an isolated namespace on shared development containers: PostgreSQL 18, Dragonfly, and ClickHouse 26.9.

## Data shown

The data is fictional:
- The project "Documentation" is the repository's demo seed. The demo user and email are invented (`*.test`).
- 60 days of history are synthetic: about 26,000 events from humans, AI crawlers, search engines and headless bots. They were written through the real envelope builder (`buildAnalyticsEvent`) and insert path (`insertAnalyticsEvents`), so classification, hashing and redaction are real.
  - This history was generated with search-term storage on. That's why older search terms appear right after "Turn on search terms" is confirmed. On a real site, only searches made after the switch are shown, which is what the dialog says.
- On top of the history, live traffic went through the real reader, API and worker:
  - browser sessions arriving from ChatGPT (`utm_source=chatgpt.com`), Perplexity and Google
  - searches with zero results and refinements, result clicks, and "Was this helpful?" answers
  - GPTBot, ClaudeBot, PerplexityBot, ChatGPT-User, Googlebot and `curl` requests for pages, Markdown, `llms.txt`, `llms-full.txt`, robots and sitemap
  - headless Chromium, which is classified as a bot

## Files

| File | What it shows |
|---|---|
| `before-*.png` | The analytics page on `main` (6a71e996) with the same project: English and Arabic, desktop and 390 px |
| `overview-*.png` | Overview: plain-language questions, comparisons, pages needing work, channels, AI teaser. Includes dark mode |
| `pages-*.png`, `page-detail-*.png` | Every page in a sortable, filterable table, and one page's drill-down |
| `search-hidden-en-desktop.png` | Search with term storage off: counts and rates still work, the reason is explained, and terms can be turned on in place |
| `search-visible-*.png` | Search with terms on: failed searches with "Write an article for this" |
| `feedback-en-desktop.png`, `performance-*.png` | Helpfulness trend and pages, real-user loading speed (p75) |
| `ai-*.png` | AI visibility: crawler categories, bots, machine files, most crawled pages, visits from AI assistants |
| `outage-*.png` | ClickHouse unreachable: the dashboard says analytics is temporarily unavailable and the docs site is unaffected. The reader page served normally at the same moment |
| `overview-to-page-en.gif` | Overview → 7-day range → Pages → a page's drill-down |
| `search-write-article-en.gif`, `search-write-article-en.webm` | Search → turn on search terms (confirm) → "Write an article for this" → the draft opens in the editor |
| `ar-mobile-overview-ai.gif` | Arabic, 390 px: Overview and AI visibility |

The "Some figures are incomplete" note on these captures is accurate. Early live searches were made before a consent fix in this branch, so they have no visit identity. Rates are computed from the searches that support them, and the response is marked partial.
