# AI chat assistant verification

Captured with headless Chromium (Playwright) against an isolated local stack with
its own PostgreSQL database, Redis namespace, ClickHouse database and Qdrant
collection. Everything shown is real: the reader site, the Start server function,
the Hono chat endpoint, hybrid retrieval, worker indexing, ClickHouse records and
the dashboard. Answers were generated **live** through OpenRouter
(the then-default models for answers, rewriting, suggestions and embeddings)
with a dedicated low-limit test key. The site content ("Acme Notes") and the demo
account are fictional.

The reader and dashboard captures were refreshed on 7 November 2026 at 6d98ec3d
(prompt `chat-v5`). The search hand-off, search settings, theme cards, typing
indicator, quota state and dashboard skeleton are from 6 November; their UI did
not change since.

## Reader

- `reader-en-desktop.gif` / `.png`: a starter question, the answer with
  section-level sources, suggested questions that arrive after the answer, one of
  them asked by tapping it, and a thumbs down with a reason.
- `reader-en-desktop-follow-ups.png`: sources that name the exact section, rating
  buttons and **Related questions**.
- `reader-typing-en-desktop.png`: the typing indicator before the first words. The
  response was held for 3.5 s in the browser to make it visible.
- `reader-ar-mobile390.webm` / `.png`: Arabic, right-to-left, full-screen at
  390 × 844: «كيف أصدر دفتراً واحداً بصيغة PDF؟» answered with the steps from an
  open notebook, and Arabic suggestions.
- `reader-sync-ar-mobile390.png`: «ملاحظاتي لا تظهر على هاتفي», worded nothing
  like the page, answered with the sync causes and steps from **Fix sync
  problems**: the page's other sections were read because it matched only thinly.
- `reader-stopped-en-mobile390.png`: an answer stopped before its first words,
  kept as **You stopped this answer** with **Retry**. The response was held for
  6 s in the browser so Stop could land while the assistant was working.
- `reader-mixed-ar-desktop.png`: a question mixing Arabic and English, answered in
  Arabic with the English names kept.
- `reader-vague-en-desktop.png`: "How do I set it up?" answered with one clarifying
  question listing the options (first attempt).
- `reader-no-answer.png`: an out-of-scope question with no guess, suggested
  articles and **Contact support** (the site's support link).
- `reader-ar-desktop-page-context.png`: **Ask AI about this page** in Arabic, with
  the page-context chip.
- `reader-en-mobile390-deeplink.png`: an `?ask=` deep link answered on a phone; the
  parameter is removed without leaving the page.
- `reader-quota.png`: the daily quota reached. The counter was set to its limit in
  the local Redis namespace for this capture.

## Search hand-off (after #281)

The redesigned search dialog hands a question to the chat; the legacy answer tab
is gone. Captured after merging main@178fc83d.

- `search-handoff-en-desktop.gif`: typing a question in search, **Ask AI about
  "…"** selected first, Enter opens the chat with that question answered (cited
  sections, related questions), and closing returns focus to the launcher.
- `search-ask-ai-row-en-desktop.png` and `search-handoff-answer-en-desktop.png`:
  the two ends of that flow.
- `search-ask-ai-row-ar-mobile390.png`: the same row in Arabic on a phone.
- `deep-link-ar-mobile390.png`: an Arabic `?ask=` deep link answered once the
  lazily loaded chat arrives; the address keeps `?lang=ar` and drops `ask`.

## "Ask AI about this page" in every theme

The end-of-article card in the three documentation shells. Each was published
locally with that theme, then rolled back.

- `reader-page-card-harbor-en-desktop.png` and
  `reader-page-card-harbor-ar-dark-mobile390.png`: Harbor (reference shell).
- `reader-page-card-manuscript-en-mobile390.png`: Manuscript (editorial shell).
- `reader-page-card-signal-en-dark-desktop.png` and
  `reader-page-card-signal-ar-mobile390.png`: Signal (console shell).

## Dashboard

- `dashboard-en-desktop.gif`: overview with engagement, conversations, a
  transcript, content gaps and the search settings.
- `dashboard-en-skeleton-desktop.png`: the first-load skeleton, shaped like the
  overview. The summary request was delayed for this capture.
- `dashboard-{en,ar}-{overview,conversations,detail,gaps}-desktop.png` and
  `dashboard-en-*-mobile390.png`. The Arabic set is the dashboard in Arabic,
  right to left. The overview includes reader actions, how readers
  open the assistant, and typical first-word and answer times, read from the
  `chat_*` events in `analytics_events`.
- `settings-search-ai-en-desktop.png`: **Save questions to improve your docs**,
  suggested questions and the new **Support link**.

## Search settings (data loading conventions)

Captured in Arabic (the demo account's language), dark mode.

- `search-settings-skeleton-ar-desktop.png`: first load, a skeleton shaped like the
  form (inputs, hotkey switch, toggle rows, starter questions). The settings
  request was delayed in the browser for this capture.
- `search-settings-ar-desktop.png`: the loaded section.
- `search-index-diagnostics-ar-desktop.png`: index diagnostics after **Rebuild
  index** (which now shows the button's loading state), ready with 44 chunks.
