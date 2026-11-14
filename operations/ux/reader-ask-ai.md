# Reader "Ask AI" from the reader's side

Status: proposal, no product code yet. Reader-side counterpart of the plan of record
[`ai-and-integrations.md`](ai-and-integrations.md) (#506), which covers the owner's side (turning AI on, keys, limits).
Assets: [`reader-ask-ai/`](reader-ask-ai/) (52 captures in `shots/`, 6 low-fi mockups, [`mockups.html`](reader-ask-ai/mockups.html)).

## Summary

The owner called the reader's Ask AI widget "one of the worst I've seen". From the reader's side, the main problems
are **not** the model. The pipeline is already generative and grounded: GPT-6 Luna, `[S#]` markers, a citation
validator, follow-ups and a "no answer" sentinel. What fails is everything the reader touches around the answer:

- **Citations look like footnotes but behave like anchors inside the widget.** Each `[S1]` becomes a tiny "1" chip.
  Clicking it scrolls to a card *inside the panel*, not to the docs (§2.2). The cards repeat the page title once per
  section. Opening a card lands the page behind a blurred modal, so the reader still can't see the section.
- **The answer can write itself and then vanish.** Text streams before it is checked. When the check fails, the whole
  answer is swapped for "I couldn't find a clear answer" (§2.3). For the reader, the AI wrote a confident claim and
  then took it back.
- **"Not in the docs" is a dead end.** It offers no search results and no next step, only "Contact support" when the
  site set a link. #452 removed the suggested articles because they were unrelated, and nothing replaced them.
- **Arabic is a second-class reader.** The site's starter questions are hidden in Arabic, three different words mean
  "docs", and citation chips wrap onto their own line. English-only sources are not labeled as English.
- **Ask AI is missing on first visit** on any site with a consent banner, and it sits behind a modal that blurs the
  page the reader is trying to follow.

**Proposal:** check each block *before* it is shown, then stream it. Every citation must resolve server-side to a real
section with an anchor, or it is dropped. Citations become numbered links that open the exact section beside a
non-modal panel. A real "These docs don't cover that" state hands off to search. Arabic follows the same rules as
English, with bidi isolation. The work ships as **9 small PRs** (§8), with **10 owner decisions** in §9.

## 1. How this was tested

- Branch `main` at `2df8cf12`, one local stack under the shared dev-stack lock: Postgres and Dragonfly in an isolated
  compose project (`nibleaf-askai`, own DB `nibleaf_askai`), API on :4410 and the reader on :4310 (filtered
  `turbo dev -F @nibleaf/app`). The API ran under plain `tsx`: `tsx watch` hung silently under turbo on this machine.
  The stack, containers and volumes were removed right after the captures.
- **Site:** "Nibleaf Docs", built from this repo's own product docs and published as one deployment. It has 9 English
  pages and 8 Arabic translations. **Connect a custom domain is English-only on purpose**, so an Arabic question about
  it has to cross languages. The site's consent banner is on, which is the starter default.
- **No AI provider key is configured locally** (`OPENROUTER_API_KEY` is empty), so no live answer could be generated.
  What was real and what was replayed:
  - **Real:** the reader, the launcher and its consent behavior, the search hand-off, the panel, every client state,
    and the real server path. The server path answers **"unavailable"** (shots `*-18-unavailable-real`,
    `ar-*-08-unavailable-real`), plus offline.
  - **Replayed:** answers, refusals and limit errors. They are replayed into the real panel in **the exact SSE/AG-UI
    wire format the API emits**: same event types, same `nibleaf.chat.*` payloads, same `x-tss-raw` response. A fetch
    shim was injected only for the chat server function.
  - **Content of the replays:** written as prompt `chat-v8` instructs, from the seeded pages' real sections, with
    their real heading ids. The "unverified" replay reproduces what `validateCitedAnswer` does to an answer whose first
    paragraph is uncited. **Its wording is illustrative, not a recorded model output.**
- **Local-only patch, reverted:** the reader shell's `capabilities.answer` was forced on so the launcher renders
  without a provider or index. It was reverted with `git checkout` before this branch was committed.
- **Captures:** EN and AR, 1440 and 390 (390 is 2× DPR, touch), light and dark. Names follow
  `<locale>-<width>-<theme>-<step>-<state>.jpg`. `shots/en-copied-answer.txt` is what **Copy answer** put on the
  clipboard.
- **Production was not touched.** No request went to any AI provider.
- **Competitive patterns** come from public docs and code of Mintlify, GitBook, Inkeep, Kapa and Algolia DocSearch Ask
  AI. Only patterns were used, no look or branding. None of the five documents numbered inline citations with
  section deep links, or any RTL support, so §4 goes beyond them on purpose.

## 2. The broken journeys

### 2.1 "How do I add a custom domain?" Find it, read it, trust it

| Step | What the reader sees | Reader's words |
|---|---|---|
| Lands on the page (first visit) | No "Ask AI" anywhere. The launcher returns `null` while the consent banner holds its corner (`chat-ui.tsx:229`). The header has search only. ![](reader-ask-ai/shots/en-1440-light-01-first-visit-no-ask-ai.jpg) | "Where's the AI thing everyone has?" |
| Answers the banner | The floating **Ask AI** appears bottom-right. ![](reader-ask-ai/shots/en-1440-light-02-launcher.jpg) | "Oh, there it is." |
| Opens it | A modal sheet blurs the page. The starters are generic plus the site's two. ![](reader-ask-ai/shots/en-1440-light-04-panel-empty.jpg) | "I can't read the page I was on anymore." |
| Asks | "Looking through the docs…", then text streams with its markers stripped. ![](reader-ask-ai/shots/en-1440-light-06-streaming.jpg) | (fine) |
| Reads | Markers reappear as small chips when the checked answer replaces the stream. Paragraphs run together because the answer's `p` elements have no spacing. ![](reader-ask-ai/shots/en-1440-light-07-answer-top.jpg) | "What are these little 1s?" |
| Looks for sources | Three cards, each repeating **Connect a custom domain** with a different section. ![](reader-ask-ai/shots/en-1440-light-08-answer-sources-followups.jpg) | "Is this three pages or one?" |

### 2.2 "Where did that come from? Show me." Verify the answer

- **Clicking a chip doesn't open the docs.** It scrolls to the card inside the panel and focuses it
  (`message.tsx:76-80`). ![](reader-ask-ai/shots/en-1440-light-09-marker-click-jumps-to-card.jpg)
  Reader: *"I clicked the source and nothing happened."*
- **The card's link does reach the exact section.** It opens `custom-domains?lang=en#add-your-domain`, so section
  anchors already work server-side (`withSectionAnchors`, `site-chat.ts:104`). But on desktop the modal stays open
  over a blurred page, so the reader can't see the section it scrolled to.
  ![](reader-ask-ai/shots/en-1440-light-21-after-source-click.jpg) On a phone the sheet closes and the section shows,
  but the conversation is now one tap away with no "back to answer".
  ![](reader-ask-ai/shots/en-390-light-08-after-source-tap.jpg)
- **Copy answer pastes internals.** It copies raw Markdown with `[S1]`, `[S2]` and `**bold**`. The source list below
  it has no numbers, so `[S2]` maps to nothing ([`en-copied-answer.txt`](reader-ask-ai/shots/en-copied-answer.txt)).
  Reader: *"I pasted it into Slack and it's full of [S1]."*
- **Anchors are matched by heading text at answer time.** The match is on normalized heading text across the page's
  headings (`site-chat.ts:96-126`). A chunk under a duplicated heading, or one whose heading text differs from the
  rendered id, silently becomes page-level. Nothing tells the reader which kind of link they got.

### 2.3 Follow-up, and a question the docs don't cover

- **"Can I use a wildcard domain like `*.example.com`?"** The model declines, correctly. The reader gets "I couldn't
  find a clear answer in the docs. Try searching with different words, or contact support for help." plus **Contact
  support**. There is no search link, even though the copy says to search. The final event's `suggestions` is
  hard-coded `[]` (`site-chat.ts:469`, `:515`; removed in #452 because they were irrelevant).
  ![](reader-ask-ai/shots/en-1440-light-12-not-in-docs.jpg) Reader: *"OK, so where do I search? This is a dead end."*
- **Stale follow-ups.** The first answer's **Related questions** stay on screen under two later "couldn't find"
  replies (`panel.tsx:337,446` keys them to the latest *answered* turn). They look like suggestions for the current
  question.
- **The stream-then-vanish problem (P0).** The reader asks "Can I keep Cloudflare's proxy turned on?". A confident,
  uncited claim streams onto the screen. ![](reader-ask-ai/shots/en-1440-light-13-unverified-streaming.jpg)
  At the end the validator withdraws the whole answer and the reader sees the generic refusal.
  ![](reader-ask-ai/shots/en-1440-light-14-unverified-withdrawn.jpg)
  - Mechanism: `streamGroundedChat` releases deltas as soon as 24 characters prove they aren't the sentinel
    (`answer-chat.ts:618-626`). Validation runs only after the stream ends (`:653`).
  - Truncation (`seen.truncated`) withdraws the answer the same way. On GPT-6 reasoning models the 1,200-token
    `answer` cap counts reasoning tokens too (`CHAT_OUTPUT_TOKEN_LIMITS`).
  - Reader: *"It literally told me yes and then deleted it. Which one is true?"* That is the worst possible trust
    signal, and it is exactly what "hallucination" looks like to a reader, even though the system caught it.

### 2.4 Arabic

- **Arabic question, English-only docs** («كيف أربط نطاقًا مخصصًا بموقعي؟»). The cross-language retrieval from
  #452 works: the answer is in Arabic and cites the English page.
  ![](reader-ask-ai/shots/ar-1440-light-04-answer-ar-on-en.jpg) But:
  - **The source cards are in English with no signal that the page is English.** The reader taps and lands on an
    English page (`?lang=en`). ![](reader-ask-ai/shots/ar-1440-light-05-sources-ar-on-en.jpg)
  - **English UI labels inside Arabic sentences aren't isolated.** `Settings → Custom domain` and `Add domain.` sit in
    the RTL run, so the period and the following citation chip reorder around them. A chip ("1") wraps alone onto its
    own line (item 2 in the shot).
  - **Numerals are mixed.** Answers and chips use 0–9 («24 ساعة», "1"). The panel's own copy uses Arabic-Indic digits
    in one string («٥٠٠ حرف», `site_ai_invalid`). The marker's accessible name is «المصدر 1».
- **Arabic question, Arabic docs** («كيف أنشر التغييرات على موقعي؟»). The answer and sources are Arabic with correct
  anchors (`publishing?lang=ar#انشر`). The repeated-page-title cards and chip wrapping are the same as in English.
  ![](reader-ask-ai/shots/ar-1440-light-06-answer-ar-on-ar.jpg)
- **Three words for "docs" in one panel.** The subtitle and intro say «الوثائق». The refusal says «الدليل» («لم أجد
  إجابة واضحة في الدليل»). The glossary says **«التوثيق»** (`docs/ARABIC_GLOSSARY.md`).
  ![](reader-ask-ai/shots/ar-1440-light-07-not-in-docs.jpg)
- **The Arabic empty state has two generic starters only.** Site starter questions show only in the default language
  (`panel.tsx`, `options.lang === options.defaultLanguage`), so an Arabic reader gets «كيف أبدأ؟» and «ما الذي يمكنني
  فعله هنا؟». ![](reader-ask-ai/shots/ar-1440-light-02-panel-empty.jpg)
- **What works:** the RTL layout mirrors correctly, the panel opens from the left, the composer's send arrow flips,
  and `dir="auto"` per paragraph keeps an English answer inside an Arabic panel readable. Dark mode holds in both
  directions. ![](reader-ask-ai/shots/ar-1440-dark-01-answer-ar-on-en.jpg)

### 2.5 Mobile (390)

- First visit: no Ask AI (consent banner), then a round icon launcher.
  ![](reader-ask-ai/shots/en-390-light-02-launcher.jpg)
- The full-screen sheet and its composer work. The keyboard is not opened on touch, which is correct.
  ![](reader-ask-ai/shots/en-390-light-03-panel-empty.jpg)
- A long answer is a wall of 13 px text with 1-character chips that are smaller than a 24 px tap target.
  ![](reader-ask-ai/shots/en-390-light-05-long-answer-top.jpg)
  ![](reader-ask-ai/shots/en-390-light-07-sources-followups.jpg)
- Tapping a chip scrolls within the sheet. Tapping a card closes the sheet and navigates. Coming back means opening
  the launcher again, which keeps the conversation but doesn't say so.
  ![](reader-ask-ai/shots/ar-390-light-07-marker-tap.jpg)
  ![](reader-ask-ai/shots/ar-390-light-08-after-source-tap.jpg)

### 2.6 Errors and limits

| State | Today (EN / AR) | Problem |
|---|---|---|
| AI unavailable (real) | "The assistant isn't available right now." + **Retry** ![](reader-ask-ai/shots/en-1440-light-18-unavailable-real.jpg) | Retry loops on a state that won't change. There's no path to search. The launcher was offered even though AI can't answer. |
| Rate limited | "You're asking quickly — wait a moment and try again." + Retry ![](reader-ask-ai/shots/en-1440-light-15-rate-limited.jpg) | No wait time. Retry fails again if pressed early. |
| Daily quota | "…reached today's limit… You can still search the docs." ![](reader-ask-ai/shots/en-1440-light-16-quota.jpg) ![](reader-ask-ai/shots/ar-390-dark-02-quota.jpg) | Says "search the docs" but gives no search button. |
| Conversation limit | "This chat is getting long…" + **New chat** (question carried over) ![](reader-ask-ai/shots/en-1440-light-17-conversation-limit.jpg) | Good. Keep. |
| Offline | "You're offline…" + Retry, question kept ![](reader-ask-ai/shots/en-1440-light-19-offline.jpg) | OK. Copy can say the question is kept. |
| Slow (7 s to first word) | Dots + "Looking through the docs…" ![](reader-ask-ai/shots/en-1440-light-20-slow-typing.jpg) | No reassurance after a few seconds. |
| Revoked reader (private site) | Not reproduced locally. From the code: a `401`/`403` from the chat route becomes `failed` ("Something went wrong. Please try again.") and a `404` becomes `unavailable` (`upstreamError`, `helpers.ts:62`). | The reader is told something broke, or that AI is down, when their access ended. Retry can't fix it. They should be told to sign in again. |

### 2.7 Issue list

| # | Sev | Issue | Where |
|---|---|---|---|
| 1 | P0 | Unchecked text streams, then the whole answer is withdrawn | `answer-chat.ts:618-653` |
| 2 | P0 | Citation chips don't open the docs; the modal hides the opened section | `message.tsx:66-85`, `panel.tsx:339` |
| 3 | P0 | "Not in docs" and quota are dead ends: no search hand-off | `site-chat.ts:469,515`; `panel.tsx` error box |
| 4 | P1 | No Ask AI on first visit with a consent banner; no header entry or shortcut | `chat-ui.tsx:229` |
| 5 | P1 | Copy pastes `[S#]` and Markdown with unnumbered sources | `message.tsx:180` |
| 6 | P1 | Sources repeat the page title per section; no page grouping or language label | `message.tsx:131-160` |
| 7 | P1 | Arabic: English UI labels and code not bidi-isolated; chips wrap alone; mixed numerals; three words for "docs" | `message.tsx`, `ar.json` |
| 8 | P1 | Stale follow-ups under later turns | `panel.tsx:337,446` |
| 9 | P1 | Anchors matched by heading text at answer time; silent page-level fallback | `site-chat.ts:96-126` |
| 10 | P2 | Rate limit without wait time; Retry on states that can't recover; revoked reader reads as "something went wrong" | `helpers.ts`, `functions/site-chat.ts` |
| 11 | P2 | Answer paragraphs have no spacing; headings flattened to bold `p` | `message.tsx:100-111` |
| 12 | P2 | Arabic readers lose the site's starter questions | `panel.tsx` (starters) |
| 13 | P2 | Low-confidence "no answer" (no model call) still consumes a daily answer | gate before retrieval, `site-chat.ts` |

## 3. Patterns from strong docs products (and where we go further)

- **Keep (already good):**
  - streaming over SSE;
  - search → "Ask AI about '…'" hand-off (exists, shot `en-1440-light-03`);
  - up to 3 follow-ups after an answer only;
  - thumbs down with optional reasons;
  - a Stop button with a "you stopped this answer" state;
  - consent-aware capture;
  - a conversation cap that carries the question into a new chat.
- **Adopt:**
  - A header entry next to search, plus **Ctrl/Cmd + I**. Matched on `event.key`, and ignored while the reader is
    typing in a field.
  - **Esc steps back one level:** source preview, then panel.
  - A side panel that doesn't hide the page.
  - A full-screen sheet below 768 px.
  - Copy that produces clean text.
  - A per-code-block copy.
  - A one-line AI disclosure.
  - Errors that name the wait time and keep a path to search.
  - An escalation link only when uncertain: no answer, or thumbs down.
  - Deflected "not covered" replies that don't spend the quota.
- **Go further (nobody documents these):**
  - numbered inline citations that are links to **section anchors**, validated server-side;
  - sources grouped by page with section names;
  - a language label on cross-language sources;
  - **checking blocks before they are shown**;
  - Arabic parity rules (§5).
- **Avoid:**
  - sources collapsed behind a count;
  - a captcha on page load;
  - locking the input while streaming;
  - announcing every token to screen readers;
  - an always-visible "talk to support" button.

## 4. Target experience

### 4.1 Principles

1. **Nothing is shown that hasn't been checked.** Text appears block by block, already cited. A block that fails the
   check is never drawn, so nothing can "un-say" itself.
2. **A citation is a door to the docs.** **[1]** opens the cited section in the page, highlighted, with the answer
   still beside it. Its label names the page and section.
3. **"Not in these docs" is an answer, not an error.** It says so plainly, never guesses, and gives the next step:
   search results for the reader's words, then support if the site set a link.
4. **Same quality in Arabic and English.** The same states, the same citation behavior, the reader's language for the
   answer, and isolated technical text.
5. **Capabilities decide what is drawn** (plan of record §4.6). Ask AI appears only when this site can answer now.
   There is never an `isCloud` branch.

### 4.2 Layout and entry points (mockups A, F)

![](reader-ask-ai/mockup-f-entry-points-en-1440.png)

- **Entry points:**
  - a **header button "Ask AI"** beside search, server-rendered from `capabilities.answer`, so it exists on first
    visit even with the consent banner;
  - **Ctrl/Cmd + I**;
  - the existing search hand-off row;
  - the end-of-article card;
  - on phones, the floating launcher (unchanged behavior).
- **≥ 1280 px:** a **docked panel, 420 px**, with no backdrop and no blur. The page stays interactive and scrollable
  (`aria-modal` off; landmark `complementary`, named "Ask AI"). Focus goes to the input on open and returns to the
  trigger on close.
- **768–1279 px:** an overlay panel without blur, so the page is still visible.
- **< 768 px:** the full-screen sheet as today.

### 4.3 An answered question (mockups A, D)

![](reader-ask-ai/mockup-a-answer-en-1440.png)

- **Status line** (`role=status`, announced once per phase): "Looking through the docs…", then "Writing…". After 8 s
  it adds "Still working. Answers can take up to 20 seconds."
- **Streaming:** checked blocks appear one at a time, with their **[n]** links already live. Nothing reflows when the
  answer completes.
- **Citations:**
  - Numbered **1, 2, 3** by first use. The same section always gets the same number.
  - Each is a real `<a>` to `page#anchor`, accessible name "Source 1: Connect a custom domain, Add your domain".
  - Tap target is at least 24 × 24 px (WCAG 2.5.8).
  - A citation never wraps alone: it is joined to the preceding word with a no-break.
- **Opening a citation:**
  - **Desktop:** navigates the page to the section (same tab, the client router keeps the panel and conversation).
    It highlights the section for 2 s (`prefers-reduced-motion`: no animation) and keeps focus in the panel.
  - **Phone:** a **source preview** sheet shows the page, section and a 3-line excerpt, plus **Open section**.
    Opening it minimizes the chat to a pill, "Back to answer" / «العودة إلى الإجابة».
- **Sources:**
  - Grouped by page: the page title once, its sections numbered underneath.
  - A page in a language other than the answer's gets a label ("English" / «بالإنجليزية»).
  - Snippets live in the preview, not the list, which keeps the list short.
- **Actions:**
  - **Copy** produces clean Markdown or plain text: `[1]` markers and a numbered source list with absolute URLs.
  - **Copy** on every code block.
  - 👍 / 👎 (👎 opens optional reasons, as today).
- **Follow-ups:** up to 3, only under the latest turn, cleared when a newer turn starts.
- **Disclosure:** an "AI" pill in the header, plus a one-line footer: "AI answers come only from these docs and can
  still be wrong. Check the sources." The retention line shows only when questions are kept (unchanged rule).

### 4.4 Not in these docs (mockups B, E)

![](reader-ask-ai/mockup-b-not-in-docs-en-1440.png)

- "**These docs don't cover that.** I didn't find anything about it in these docs, so I won't guess."
- **Search the docs for "{query}"**: opens the existing search dialog prefilled with the condensed standalone query
  (`searchQuery` from the server), so the reader sees real results.
- **Contact support ↗**, only when the site set `aiSupportUrl`.
- *Optional (D3):* "Closest sections (not an answer)". Shown only when reader search returns hits above
  `readerRelevanceFloor`; otherwise absent.
- **👎 "I expected an answer"** feeds the content-gaps report owners already have.
- **The same state is used for** retrieval below confidence, a model decline, and an answer whose every block failed
  the check. In the last case the copy is "I couldn't back this answer up with these docs, so I'm not showing it."
  (mockup C, cell 5). It is never shown *after* text was streamed.

### 4.5 States, errors and limits (mockup C)

![](reader-ask-ai/mockup-c-states-en.png)

Every error keeps the reader's question in the field and offers **Search the docs**. **Retry** appears only where
retrying can work.

## 5. Arabic parity rules

1. **Answer language = the question's language** (server, `replyLanguage`), not the UI language. UI chrome follows
   the site language. An English question on the Arabic site gets an English answer inside an RTL panel. Each block is
   `dir="auto"` (kept).
2. **Cross-language sources are labeled.** A source in a language other than the answer's carries «بالإنجليزية» /
   "Arabic". When *every* source is in another language, one line above the answer says: «هذه الإجابة من صفحات متوفرة
   بالإنجليزية فقط.» / "This answer comes from pages available only in Arabic." Links open that page in its own
   language (kept from #452).
3. **Bidi isolation in answers.** A small remark plugin wraps these in `<bdi>` (or `dir="ltr"` for code):
   - inline `code`, fenced code;
   - URLs, paths, emails;
   - and any **bold** run with no Arabic letters (UI labels such as **Settings → Custom domain**).

   Arrows inside an isolated LTR label keep their LTR meaning. Punctuation that ends the Arabic sentence stays outside
   the isolate.
4. **Citation markers:**
   - in-flow after the isolate, joined with a no-break so they never wrap alone;
   - numerals per D4;
   - accessible name «المصدر ١: اربط نطاقًا مخصّصًا، أضف نطاقك» built with the same numeral system;
   - order of numbers follows reading order in both directions.
5. **One term per concept** (glossary):
   - docs = **«التوثيق»** («هذا التوثيق»), never «الوثائق» or «الدليل»;
   - Ask AI = **«اسأل المساعد»**;
   - grounded answer = «إجابة موثّقة».
6. **Layout:**
   - The panel opens from the start side (left in RTL), which is kept.
   - Source groups, chips and the composer use logical properties only.
   - The preview sheet and "Back to answer" pill mirror.
   - The shortcut hint shows "Ctrl I" in both languages (key names are not translated).
7. **Starter questions per language.** Owners can set starters per site language. The plan-of-record PR 5 moves them
   to AI answers, so add the language field there. A language with none gets the localized generic pair. We never
   show a starter in a language the reader didn't choose.
8. **Parity check per PR:** the same questions in EN and AR (§8, eval set) at 1440 and 390, with screenshots of every
   state in both directions.

## 6. Technical approach

### 6.1 Streaming protocol (CSP-safe, budget-safe)

- **Keep the transport.** It is AG-UI events over SSE from the same-origin Start server function `chatSiteFn`, which
  proxies to `POST /api/public/sites/:id/chat`. It needs no new origin (`connect-src 'self'`), no inline script and
  no nonce. EventSource is not used, so cookies and credentials follow the existing SSR fetch patch.
- **New `CUSTOM` event `nibleaf.chat.sources`**, sent once after retrieval and before any text. It lists the turn's
  candidate sections, which the client uses to resolve markers as blocks arrive:

  ```ts
  {
    sources: Array<{
      id: 'S1';
      pageId: string;
      title: string;
      path: string;
      section?: string;
      anchor?: string; // resolved server-side
      language: string;
      direction: 'ltr' | 'rtl';
    }>;
  }
  ```

  Bounded at 12 entries. It carries no snippets (they come with `final`).
- **Text arrives as checked blocks.** `TEXT_MESSAGE_CONTENT` deltas stay, but the server releases a Markdown block
  (paragraph, list item, heading, code fence) only after it passes §6.2. The client shows each block as soon as it
  arrives.
  - Uncited blocks are dropped before they are sent.
  - Time to first visible text grows by about one block, roughly 1–2 s at current speeds, against the alternative D1
    options.
  - A code fence is held until it closes.
- **`final` keeps its schema plus four fields:**
  - `removed` (blocks dropped, for "I removed one sentence…");
  - `searchQuery` (the condensed standalone query, for the search hand-off);
  - `retryAfterSeconds` (rate limit);
  - `citations` that are always section-resolved (§6.2).

  `suggestions` stays `[]` (D3 decides on "closest sections").
- **Bundle:**
  - The panel stays in its lazy chunk (`load-chat-ui.ts`); the header button is a server-rendered `<button>` that
    opens the existing hydration island, so the 337.01 KiB (345,100 B gzip) direct-navigation budget is unchanged.
  - The remark bidi plugin is about 40 lines in-repo, with no dependency.
  - **Acceptance:** `bundle:check` passes with unchanged public profiles, and the panel chunk grows by at most 6 KiB
    gzip (reported in the PR).

### 6.2 Citation extraction and validation

Server, `packages/search/src/answer-validation.ts` and `answer-chat.ts`:

1. **Anchors at index time.** Each indexed chunk stores `anchor` (the github-slugger id the reader's TOC uses, from
   `extractHeadings`) and `headingPath`.
   - Chunks before the first heading get `anchor: undefined` and section = "Introduction" (page top).
   - Until a reindex, the current text match (`withSectionAnchors`) is the fallback.
   - Section anchors don't change embeddings, so this is a payload backfill, not a re-embed.
2. **Incremental block check.** As tokens arrive, split on block boundaries (the existing fence-aware `markdownBlocks`
   logic, made incremental). A block is released when one of these holds:
   - it ends with one or more known `[S#]` markers;
   - it is a heading or label line followed by a cited block (held until then);
   - it is a code fence immediately followed by a cited line (held).
3. **Claim check (new, cheap, deterministic).** In a cited block, these must appear in the cited source's text (after
   normalizing case, Arabic letters via `normalizeArabicSearchText`, whitespace and quotes):
   - every **bold** run with no spaces-only content (UI labels);
   - every inline `code` span;
   - every number with a unit or 3 or more digits.

   If one doesn't appear, the block is dropped (D8). This catches invented button names, commands and limits, the
   most common docs hallucination.
4. **Resolution.** `S#` must be in the turn's context; otherwise the block is dropped (unknown ids today withdraw
   the whole answer). The cited section's `anchor` must exist among the headings of the page **in the published
   deployment and language the reader can read**. If it doesn't, the citation is page-level with label = page title.
   A citation to a page the reader can't read is impossible by construction (retrieval is grant-filtered) and is
   asserted in a test.
5. **Withdraw rule.** If dropped blocks exceed 1/3 of substantive blocks (current rule), or no cited block survives,
   the turn ends as "held back". The client has received only checked blocks, so the turn collapses into the held-back
   card with its search hand-off, and nothing it showed was wrong. Numbers are assigned by first use, on the server
   (`final.citations` order = display order). The client never renumbers.

### 6.3 Prompt and grounding (`chat-v9`)

- **Keep every chat-v8 rule.** Add:
  - "Copy UI labels, commands and numbers exactly as they appear in the sources; never write a label or value the
    sources don't contain." (pairs with the claim check)
  - "Cite the most specific section; one marker per block is enough."
  - "When the sources are in another language than your reply, keep their UI labels in the sources' language."
- **Output cap.** GPT-6 is a reasoning model, and its reasoning tokens count against `CHAT_OUTPUT_TOKEN_LIMITS.answer`
  (1,200). A cut-off answer is withdrawn today. PR 2 records the truncation rate (`truncated` is already in the
  result) on the eval set. D7 decides the new cap.
- **Language.** Keep `replyLanguage` and cross-language retrieval from #452. Add a per-language eval of grounded
  answers: 20 EN, 20 AR, 10 mixed, 10 out-of-scope per language. It extends
  `packages/search/scripts/evaluate-openrouter.ts`, with pass criteria per §8.
- **No-answer.** The sentinel stays. `searchQuery` = the condensed query (or the question on a first turn), so the
  hand-off searches what the reader meant in a follow-up.

### 6.4 Availability from runtime capabilities

- The reader shell already gets `capabilities.answer = search.aiAnswers && answerSearchAvailable(...)`
  (`sites.ts:553`), which is runtime, not edition. Keep it as the single source for:
  - the header button;
  - the launcher;
  - the search row;
  - the end-of-article card.
- **Stale hint guard.** The search endpoint's `publishedSearchAnswerHint` returns false for 5 s after a cold start, so
  the hand-off row can be missing. Prefer the shell's value.
- If a turn returns `unavailable` while the panel is open, the panel switches to "AI answers aren't available right
  now. Search still works." and the header button hides on next navigation. No Retry loop.
- **Private sites.** The chat proxy maps upstream `401/403` to a new code `access_ended`: "Your access to these docs
  has ended. Sign in again to keep asking." with a sign-in link. A real outage stays `unavailable`.

### 6.5 Cost and rate limits

Today:
- `SEARCH_ANSWER_DAILY_PER_PROJECT` = 200
- `SEARCH_ANSWER_RATE_LIMIT_PER_MIN` = 10 per visitor
- `SEARCH_CHAT_MAX_TURNS` = 20
- 150k tokens per conversation
- 2M tokens per day per project
- a per-turn reservation sized from the prompts

Changes:
- **Low-confidence no-answer doesn't spend an answer** (D6). Retrieval already ran without a model call. Move the
  quota consumption after the confidence gate; the token budget is still reserved and settled as today.
- **`retryAfterSeconds`** comes from the rate-limit window, so the copy can count down.
- **Daily limit copy** follows plan-of-record D8: owners see "Up to {limit} answers a day". Readers see "AI answers
  are paused for today on this site. Search still works." Readers never see numbers or money.
- **Block checking adds no model calls.** The claim check is string work, about 1 ms per block. Follow-ups stay one
  small utility call after the answer.

### 6.6 Conversation capture and privacy

- **Keep the existing rules:**
  - question text is stored only when the site enables capture, the instance has `AI_CONVERSATION_ENCRYPTION_KEY`,
    and the reader's consent allows it;
  - the policy revision is checked per turn;
  - retention is `AI_CONVERSATION_RETENTION_DAYS`;
  - analytics events carry no content.
- **Add redaction before storage.** Emails, phone numbers, and strings that look like secrets (key prefixes, long
  high-entropy tokens, `Authorization:` values) become `[redacted]` in stored questions and answers. The text sent to
  the model is unchanged (needed to answer). A test covers EN and AR text.
- **Disclosure stays factual and conditional:** the retention line only when stored, plus "Please don't include
  personal details" (existing copy).
- **Copy and feedback** don't add new storage. A 👎 comment follows the same rules as questions.

## 7. Final copy (EN / AR)

New or changed keys. Arabic follows the glossary: docs = «التوثيق».

| Key | English | العربية |
|---|---|---|
| `site_ai_title` (button, panel) | Ask AI | اسأل المساعد |
| `site_ai_badge` (new) | AI | ذكاء اصطناعي |
| `site_ai_subtitle` | Answers come from these docs, with links to each source. | تأتي الإجابات من هذا التوثيق، مع رابط لكل مصدر. |
| `site_ai_intro` | Ask anything about these docs. | اسأل أي شيء عن هذا التوثيق. |
| `site_ai_caution` (footer) | AI answers come only from these docs and can still be wrong. Check the sources. | تأتي إجابات الذكاء الاصطناعي من هذا التوثيق فقط، وقد تخطئ. راجع المصادر. |
| `site_ai_searching` | Looking through the docs… | جارٍ البحث في التوثيق… |
| `site_ai_writing` | Writing… | جارٍ الكتابة… |
| `site_ai_still_working` (new) | Still working. Answers can take up to 20 seconds. | ما زلت أعمل على الإجابة. قد تستغرق حتى 20 ثانية. |
| `site_ai_sources` | Sources | المصادر |
| `site_ai_sources_pages` (new, plural) | from {count} page / pages | من صفحة واحدة / صفحتين / {count} صفحات |
| `site_ai_source_label` (new) | Source {n}: {page}, {section} | المصدر {n}: {page}، {section} |
| `site_ai_source_lang` (new) | {language} | {language} (e.g. «بالإنجليزية») |
| `site_ai_other_language` (new) | This answer comes from pages available only in {language}. | هذه الإجابة من صفحات متوفرة {language} فقط. |
| `site_ai_open_section` (new) | Open section | افتح القسم |
| `site_ai_back_to_answer` (new) | Back to answer | العودة إلى الإجابة |
| `site_ai_not_covered_title` (new) | These docs don't cover that. | لا يغطي هذا التوثيق ذلك. |
| `site_ai_not_covered_body` (new) | I didn't find anything about it in these docs, so I won't guess. | لم أجد شيئًا عنه في هذا التوثيق، لذا لن أخمّن. |
| `site_noanswergrounded` (server copy) | These docs don't cover that, so I won't guess. | لا يغطي هذا التوثيق ذلك، لذا لن أخمّن. |
| `site_ai_held_back` (new) | I couldn't back this answer up with these docs, so I'm not showing it. | لم أستطع إثبات هذه الإجابة من هذا التوثيق، لذا لن أعرضها. |
| `site_ai_removed` (new, plural) | I removed {count} sentence / sentences I couldn't back up with these docs. | حذفت جملة / جملتين / {count} جمل لم أستطع إثباتها من هذا التوثيق. |
| `site_ai_search_for` (new) | Search the docs for "{query}" | ابحث في التوثيق عن «{query}» |
| `site_ai_search` (new) | Search the docs | ابحث في التوثيق |
| `site_ai_support` | Contact support | تواصل مع الدعم |
| `site_ai_expected_answer` (new) | I expected an answer | كنت أتوقع إجابة |
| `site_ai_rate` | You're asking quickly. You can ask again in {seconds} seconds. | الأسئلة متقاربة. يمكنك السؤال مجددًا بعد {seconds} ثانية. |
| `site_ai_quota` | AI answers are paused for today on this site. Search still works. | توقفت إجابات الذكاء الاصطناعي لهذا اليوم على هذا الموقع. لا يزال البحث متاحًا. |
| `site_ai_unavailable` | AI answers aren't available right now. Search still works. | إجابات الذكاء الاصطناعي غير متاحة الآن. لا يزال البحث متاحًا. |
| `site_ai_access_ended` (new) | Your access to these docs has ended. Sign in again to keep asking. | انتهى وصولك إلى هذا التوثيق. سجّل الدخول مجددًا لمتابعة الأسئلة. |
| `site_ai_offline` | You're offline. Your question is kept here; send it when you're back. | أنت غير متصل. سؤالك محفوظ هنا؛ أرسله عند عودة الاتصال. |
| `site_ai_stopped` | You stopped this answer. | أوقفت هذه الإجابة. |
| `site_ai_retry` | Ask again | اسأل مجددًا |
| `site_ai_copy` / `site_ai_copied` | Copy / Copied | نسخ / نُسخت |
| `site_ai_copy_code` (new) | Copy code | نسخ الشيفرة |
| `site_ai_invalid` | Please ask a question between 2 and 500 characters. | يُرجى كتابة سؤال بين حرفين و500 حرف. |
| `site_ai_shortcut` (new, tooltip) | Ask AI (Ctrl I) | اسأل المساعد (Ctrl I) |

The keys left out keep their current copy. The plural forms use the existing CLDR plural mechanism (`aiSaved`).
All 12 locales are covered in PR 9.

## 8. Plan of small PRs

One at a time, in this order. Each PR includes:
- the full test suite of the touched packages;
- EN and AR screenshots at 1440 and 390, light and dark (media convention: `.github/assets/<branch-slug>/`);
- a user-journey check against §2.

| # | PR | Content | Acceptance checks |
|---|---|---|---|
| 1 | `fix(reader-chat): honest dead ends and clean copy` | Client only, plus `searchQuery` in `final`. Search hand-off from not-in-docs, quota and unavailable. No Retry on unavailable (quota already has none). Stale follow-ups cleared. Copy emits `[n]` and a numbered source list. Paragraph spacing. Arabic «التوثيق» everywhere. Starters per language fallback. | Not-in-docs shows **Search the docs for "{query}"** and opens search prefilled (test) · copied text contains no `[S` and no `**` (test) · follow-ups only under the latest turn (test) · `ar.json` has no «الوثائق»/«الدليل» in chat keys (test) |
| 2 | `feat(ai-chat): show only checked blocks` | Server incremental block check (§6.2.2 and .5), `removed` count, held-back state. Unknown ids drop the block, not the turn. `chat-v9` prompt. Truncation recorded. | A replayed stream with an uncited first paragraph never sends it (test on the generator) · held-back turn sends zero text deltas · EN/AR eval: no regression in answered rate, held-back rate reported · prompt-version bump recorded |
| 3 | `feat(ai-chat): claim check for labels, code and numbers` | §6.2.3, with an Arabic normalizer. | Invented **Button** or `command` in a cited block drops the block (EN and AR tests) · eval false-drop rate ≤ 5% on correct answers |
| 4 | `feat(search): section anchors in the index` | `anchor` and `headingPath` per chunk at index time (payload backfill job, no re-embed). `nibleaf.chat.sources` event. Citations section-resolved or page-level. | Every citation `anchor` exists in the deployment's page headings (property test over the fixtures) · duplicate headings resolve to the right id · backfill is idempotent and resumable |
| 5 | `feat(reader-chat): citations open the docs` | Numbered `<a>` citations with live resolution while streaming. Sources grouped by page with language labels. Desktop open-in-page with highlight. Phone source preview and "Back to answer". | A citation's `href` = `path?lang#anchor` (test) · accessible name includes page and section · 24 px targets · no lone-chip wrap at 390 (visual check EN/AR) · reduced motion respected |
| 6 | `feat(reader): Ask AI in the header, non-modal panel, Ctrl/Cmd+I` | Header button from `capabilities.answer` (SSR). Docked panel ≥ 1280, overlay without blur 768–1279, sheet < 768. Shortcut and Esc layering. | Button present on first visit with the consent banner (test) · page scrolls and links work with the panel open at 1440 · focus in on open, back to trigger on close · `bundle:check` public profiles unchanged |
| 7 | `feat(reader-chat): Arabic parity` | Remark bidi plugin (§5.3), numerals per D4, cross-language banner and labels, AR copy. | Snapshot tests of mixed AR/EN blocks (labels, code, URLs, arrows) · marker names in AR numerals per D4 · AR eval set passes the same thresholds as EN |
| 8 | `feat(ai-chat): fair limits and access errors` | Quota consumed after the confidence gate. `retryAfterSeconds`. `access_ended`. Redaction before storage. | Low-confidence turn leaves the daily count unchanged (test) · countdown copy · 401/403 maps to `access_ended` · redaction tests EN/AR, model input unchanged |
| 9 | `chore(i18n): reader Ask AI copy in every locale` | §7 keys in 12 locales; remove dead keys. | `pnpm --filter @nibleaf/i18n run setup` clean · knip clean · AR reviewed against the glossary |

PRs 1 and 6 need no server change and can merge first. PRs 2→3 and 4→5 are the core of "proper citations".
The plan-of-record's PR 5 (move reader options to AI answers) should land before this plan's PR 1 adds per-language
starters, or PR 1 skips that item.

**Quality bar for "real answers" (measured on the §6.3 eval set, against a real provider, before PR 5 ships):**
- ≥ 85% of in-scope questions answered with every block cited;
- 0 answers to out-of-scope questions (every one is "not covered" or held back);
- ≥ 95% of citations open a section whose text contains the cited label or value;
- median time to the first block ≤ 4 s;
- the same thresholds in Arabic.

## 9. Owner decisions

| # | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | **How answers stream** | (a) checked blocks only; (b) raw tokens shown as a grey "draft" until checked; (c) no streaming | **(a) Checked blocks.** About 1–2 s more before the first words, but nothing is ever un-said. (b) still shows unchecked claims, and that is the exact moment trust breaks. |
| D2 | **Desktop panel** | docked, non-modal / keep the modal sheet | **Docked, non-modal at ≥ 1280** (overlay without blur below). The point of a citation is reading the section next to the answer. |
| D3 | **What "not covered" offers** | search link + support / also "closest sections" / nothing | **Search link plus support link; "closest sections" only when search finds hits above the relevance floor.** The irrelevant articles #452 removed must not come back. |
| D4 | **Numerals in the Arabic chat** | Western digits 0–9 / Arabic-Indic ٠–٩ | **Western digits (0–9)**, as `docs/ar` content, code and versions already do. Fix `site_ai_invalid`. One system per panel. |
| D5 | **Header "Ask AI" on every site with AI answers** | yes / floating launcher only / owner setting | **Yes, always when capable.** Search and Ask AI side by side, with the launcher kept for long pages on phones. An owner toggle can come later if asked. |
| D6 | **Does a "not covered" reply (no model call) count against the daily limit?** | count / don't count | **Don't count.** The reader got no generated answer, and Mintlify does the same. |
| D7 | **Answer output cap** (reasoning tokens count) | keep 1,200 / 2,000 / per-model | **2,000 for GPT-6 Luna, after PR 2 measures truncation.** It is bounded by the existing turn reservation and daily token budget; it costs more only on long answers. |
| D8 | **Claim check strictness** (bold label, code or number not in the cited source) | drop the block / drop the whole answer / only log | **Drop the block** and say "I removed one sentence…". The whole answer goes only under the existing 1/3 rule. |
| D9 | **Arabic question, English-only docs** | answer in Arabic, keep English UI labels, label sources / answer in English / refuse | **Answer in Arabic with English labels kept and a one-line "from pages available only in English".** The reader asked in Arabic, and the labels must match the screen they'll see. |
| D10 | **Redact personal details and secrets before storing conversations** | yes / no | **Yes.** It costs nothing for readers, and it lowers the risk of keeping question text. |

## 10. Out of scope and risks

- **Out of scope:**
  - the owner-side AI page (plan of record);
  - drafting AI in the editor;
  - the dashboard's conversation views (only the redaction rule touches them);
  - embeddings changes (#355).
- **Risk: block checking feels slower.** Mitigation: the status line and "Still working" copy, plus the D1 measurement
  in PR 2. If the median time to the first block is over 4 s, release the first block on its first marker instead of
  its end.
- **Risk: the claim check drops correct answers** (paraphrased labels). Mitigation: the check applies only to bold
  runs, code and numbers, never to prose. PR 3 gates on a false-drop rate of 5% or less.
- **Risk: the non-modal panel collides with themes** (sticky TOC, wide layouts). Mitigation: the panel docks in the
  reader layout's own grid, PR 6 screenshots all three themes, and below 1280 px it overlays.
- **Not verified here:** live model behavior, latency and cost, because no provider key was available locally, and the
  revoked-reader path. PR 2's eval run against a real provider (capped temporary key, deleted after) closes that gap.
