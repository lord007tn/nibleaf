# AI chat assistant verification

Captured on 6 November 2026 with headless Chromium (Playwright) against an
isolated local stack: its own PostgreSQL database, Redis namespace, ClickHouse
database and Qdrant collection. The reader site, Start server function, Hono
chat endpoint, hybrid retrieval, worker indexing, ClickHouse conversation
records and dashboard are real. Answers were generated **live** through
OpenRouter (`openai/gpt-5.6-luna`, embeddings `openai/text-embedding-3-small`)
using a dedicated low-limit test key. The site content ("Acme Notes") and the
demo account are fictional.

## Reader

- `reader-en-desktop.gif` / `.webm`: launcher → starter question → streamed answer
  with sources → follow-up → thumbs down with a reason.
- `reader-en-desktop.png`: final state with feedback saved.
- `reader-en-desktop-launcher.png`: the floating **Ask AI** launcher and
  **Ask AI about this page** on an article.
- `reader-ar-mobile390.gif` / `.webm`, `reader-ar-mobile390*.png`: Arabic, RTL,
  full-screen sheet at 390 × 844.
- `reader-ar-desktop-page-context.png`: "Ask about this page" in Arabic with the
  page-context chip.
- `reader-en-mobile390-deeplink.png`: `?ask=` deep link answered on mobile; the
  parameter is removed without leaving the page.
- `reader-en-dark-search-dialog.png` / `reader-en-dark-search-handoff.png`: dark
  mode, hand-off from the search dialog's Ask AI tab to the chat panel.
- `reader-no-answer.png`: an unanswerable question; no model guess, suggested
  articles instead.
- `reader-quota.png`: daily quota exhausted (counter set to its limit in the local
  Redis namespace for this capture).

## Dashboard

- `dashboard-en-desktop.gif` / `.webm`: overview → conversations → transcript →
  content gaps → search settings.
- `dashboard-{en,ar}-{overview,conversations,detail,gaps}-desktop.png`, and
  `dashboard-en-*-mobile390.png`.
- `settings-search-ai-en-desktop.png`: "Save questions to improve your docs" and
  suggested questions.
