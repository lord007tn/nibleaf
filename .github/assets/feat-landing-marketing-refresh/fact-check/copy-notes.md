# Copy notes: landing, shell and use-case pages (2026-11-07)

> **Status.** The sections before "Round-2 scoring fixes" record the first draft, which also covered the use-case pages now in #336. Where a later round changed a claim, the later section wins. The landing title, for example, changed in round 3.

Files written (copy agent):

- `apps/app/src/components/marketing/copy/landing.en.ts`, `landing.ar.ts`
- `apps/app/src/components/marketing/copy/shell.en.ts`, `shell.ar.ts`
- `apps/app/src/components/marketing/copy/use-cases.en.ts`, `use-cases.ar.ts` (new: `useCasesEn`, `useCasesTeaserEn`, `useCasesAr`, `useCasesTeaserAr`)

Checks: `pnpm --filter @nibleaf/app typecheck` passes. `pnpm exec biome check` on the six files is clean. All six files use LF line endings.

Lengths (measured with `tsx`): landing meta titles 59 (EN) / 47 (AR) characters; descriptions 153 / 154. Use-case titles are 45–52 characters and descriptions 130–151. The EN hero H1 is 5 words and the subhead 35. The AR hero H1 is 4 words and the subhead 33.

Evidence keys: **F1–F12** are sections of `facts.md`. `path:line` items are code I checked myself on this branch (base `ed15240e`). "Brief" means a fact the owner supplied in the task brief. Arabic strings carry the same facts as their English counterparts, so one row covers both languages.

## Claim → evidence

### Product and positioning

| Claim (EN wording; AR says the same) | Where used | Evidence |
|---|---|---|
| Open source, AGPL-3.0; whole product (editor, server, workers) | hero eyebrow/assurance, proof, paths, footer, api-docs | F11 (`LICENSE:1`); facts "Ten strongest" #1 |
| Self-hosting with a guided Docker Compose installer | proof, paths, FAQ, api-docs | F11 (`scripts/install.sh:14–16`, `:81`, `:94`, `docker-compose.prod.yml`) |
| Needs PostgreSQL, a Redis-compatible cache and S3-compatible storage (bundled or your own) | paths, api-docs FAQ | F11 (`docker-compose.prod.yml:27`, `:118`, `:138`, `:158`) |
| Qdrant (Ask AI) and ClickHouse (insights) are optional | paths, notes, api-docs | F11; F1 prerequisites; F4 modes |
| Published image targets linux/amd64 | api-docs FAQ | F11 (`docker-compose.prod.yml:27`, `scripts/install.sh`) |
| Self-hosters run the servers, updates and backups and pay their own AI provider | paths footnote, FAQ | F11 (operator-run stack); F5 (provider charges apply) |
| Nibleaf's own docs at docs.nibleaf.com are published with Nibleaf | hero tertiary link, proof | Brief (owner-confirmed dogfooding) |
| Free during the beta; no credit card at sign-up; no paid cloud plan offered today | hero, paths, FAQ, footer | F12 "No credit card sign-up" and "Free cloud beta / paid plans" (`apps/app/src/routes/(auth)/sign-up.tsx:31`, `packages/database/src/index.ts:172–186`); brief |
| Cloud is "the same open-source product" | paths, FAQ | F11/facts header ("Cloud and self-host use the same implementation") |
| Cloud: visual editor, docs site, search and team roles | paths cloud points | F6, F2, RBAC (`packages/shared/src/rbac.ts:1`). Deliberately leaves out the rolling-out capabilities |
| "Newer AI features arrive as they roll out" | paths cloud points | Restates `availability.ts` (`rolling-out`); adds no new availability claim |
| Pages are stored as Markdown; export Markdown, HTML or PDF any time | proof, editor, FAQ, more | F6 (stored Markdown/curated MDX), F10 (exports) |
| Scheduled exports: daily, weekly, monthly | more | F10 (`packages/shared/src/export-schedule.ts:1`, `:91`) |
| Comparisons link official vendor pages and say what Nibleaf doesn't do yet | compare body | `apps/app/src/components/marketing/comparison-page.tsx:6–27`, `:123–124`, `:151` |

### Ask AI (reader chat)

| Claim | Where | Evidence |
|---|---|---|
| Answers only from published docs; links to the exact sections used | hero, feature, FAQ, support-teams | F1 grounding/citations (`apps/server/src/lib/ai-search/runtime.ts:73`, `:90`; `apps/app/src/components/site/ai-chat/message.tsx:20`, `:54`) |
| Replies in the reader's language, including Arabic and mixed Arabic/English questions | feature, FAQ | F1 reader language (`packages/search/src/answer-chat.ts:52`, `:69`, `:74`, `:84`). This is prompt behavior, so the copy says "replies in", not "translates perfectly" |
| Says when it can't answer; suggests articles or your support link | feature, FAQ, support-teams | F1 refusal/support (`apps/server/src/actions/site-chat.ts:375`, `:449–461`); support URL `packages/validators/src/index.ts:101–106` |
| Related questions; readers rate answers | feature | F1 follow-ups (`answer-chat.ts:103`, `:510`); rating in F1 intro; screenshot shows thumbs and "Related questions" |
| Panel tells readers that AI can make mistakes | support-teams FAQ | `packages/i18n/messages/en.json:3477` (`site_ai_caution`), visible in `media/assets/chat-en-wide-1280.webp` |
| Prerequisites: AI provider key (workspace OpenAI/OpenRouter, or the instance's); turned on per site; self-hosters run Qdrant | notes, FAQ | F1 prerequisites (`runtime.ts:48`, `:59`, `:350`); F5; brief |
| Daily limits on answers and tokens | FAQ, support-teams | F1 spend controls (`packages/search/src/keys.ts:32–37`; 200 answers/project/day and 2M tokens/project/day by default, operator-configurable) |
| Search hands a question to Ask AI in one step | search feature | F1 entry points (`apps/app/src/components/site/site-search-dialog.tsx:281`, `:298`) |
| Answers from the version and language the reader is viewing | api-docs | F1 ("active published access/version/language scope") |
| Ask AI reports: conversations, ratings, unanswered questions, usage and provider-reported cost; needs ClickHouse | insights bullet, support-teams | F1 assistant dashboard (`apps/server/src/actions/ai-conversations.ts:45`, `:63`, `:105`); F4 |
| You can turn off saving Ask AI conversations | FAQ, support-teams FAQ | `apps/server/src/actions/ai-conversations.ts:28–29` (`search.aiConversationCapture`, default on); F1 capture paragraph |
| Ask AI sends questions and matching passages to the chosen provider | privacy FAQ | F1/F5 (retrieved passages and generation run on the selected connection; `packages/search/src/workspace.ts:69–95`) |
| Editor writing assistant is separate and doesn't use the workspace key | FAQ | F5 "Editor assist is separate" (`apps/server/src/actions/ai.ts:16–58`) |

### Search

| Claim | Where | Evidence |
|---|---|---|
| Built-in search shows matching sections under their page and jumps to the heading; needs no AI key or extra service | search feature | F2 (Orama; page and section rows, `site-search-dialog.tsx:22`, `:635`, `:676`) |
| ⌘K / Ctrl+K; recent searches kept on the reader's device | search feature | F2 (`site-search-dialog.tsx:21–28`, recent queries in localStorage per project) |
| Finds Arabic words with or without diacritics and across alef/yaa spellings | search, arabic, support-teams | F2 Arabic path (`packages/search/src/arabic.ts:44`, `:96`, `:230`) |

### Insights

| Claim | Where | Evidence |
|---|---|---|
| Failed searches with a "Write an article for this" button that opens a new draft | insights feature, support-teams | `apps/app/src/components/analytics/insights/search-terms.tsx:224–254` (creates a draft page titled with the term and opens the editor); label `en.json:3027` / `ar.json:3027` |
| Helpful / not-helpful votes by page | insights, support-teams | F4 Feedback; F12 Page feedback |
| AI crawler visits kept apart from people arriving from AI assistants | insights | F4 AI visibility (`packages/clickhouse/src/insights/types.ts:298`, `classifiers.ts:1`) |
| Self-hosters need ClickHouse for these reports | note | F4 modes (`packages/clickhouse/src/keys.ts:4–43`) |
| Search terms kept only if you turn that on; shown only after two different visits | note, privacy FAQ | F4 privacy (`storePublicSearchTerms`, `packages/validators/src/index.ts:388`; `packages/clickhouse/src/insights/search.ts:75`) |
| Reader analytics store no IP addresses; visits linked only with consent | privacy FAQ | F4 privacy (`packages/clickhouse/src/events.ts:290–300`, `:328–384`). Scoped to reader analytics only, as F4 requires |

### Support MCP

| Claim | Where | Evidence |
|---|---|---|
| Connect an AI assistant to one docs project; sign-in (OAuth) or scoped expiring key | feature, FAQ, use cases | F3 (`packages/auth/src/mcp-oauth.ts:47`, `packages/shared/src/mcp.ts:31`, `:98`) |
| Looks up failed searches, drafts and translates, publishes after a confirmed fresh preview | hero, feature, support-teams | F3 tool list (`get_failed_searches`, `create_page_draft`, `translate_page`, `preview_publish`, `publish_changes`); publish contract (`apps/server/src/mcp/content-write.ts:668`, `:700`, `:750`) |
| Presets: Read only, Support writer, Full admin | feature, use cases | F3 presets (`packages/shared/src/mcp.ts:67–96`); UI labels `en.json:5–7` / `ar.json:5–7` |
| Support writer can draft and publish but not change settings | support-teams | F3 preset table |
| Changes save as drafts; no tool to delete pages or change general settings | feature, use cases | F3 ("Writes save to the working copy… No page-delete or general settings-write tool") |
| Prompts include finding content gaps and a weekly docs health report | support-teams | F3 prompts (`apps/server/src/mcp/prompts.ts:6–12`) |
| Off by default for self-hosters | note, FAQ | F3 (`apps/server/src/env.ts:44`, `docker-compose.prod.yml:63`) |
| Docs cover ChatGPT, Claude (web, desktop, Claude Code), Cursor, VS Code | FAQ, mcp title | F3 documented clients (`docs/product/ai-assistants.mdx`). Worded as "our docs cover", not "works with every plan" |
| The assistant writes the translation; Nibleaf doesn't machine-translate pages | product-docs FAQ | F3 (`translate_page` saves client-supplied text); F5 editor ops are continue/rephrase/outline/summarize only |
| UI name "AI assistants (MCP)" | eyebrow, alt | `en.json:1102`; `ar.json:1102` |

### Editor, publishing, themes, languages

| Claim | Where | Evidence |
|---|---|---|
| Type / for callouts, steps, tabs, cards, tables, code, images | editor feature, product-docs | F6 slash list; tables/images `apps/app/src/components/editor/extensions/slash-command.tsx:727–743` |
| Code groups, request and response examples | api-docs | F6 slash list (`slash-command.tsx:561–594`) |
| Review comments on the text | editor, product-docs | F6 (anchored comments; `apps/server/src/modules/app/comments/routes.ts:1`). Avoided "any block" (A09) |
| Preview privately, then publish; every publish is a snapshot you can roll back to | editor, product-docs | F6 (preview route), F12 versions/rollback (`apps/server/src/actions/deployments.ts:477–496`). No "instant" or "one click" (A17) |
| Separate docs per product version | more, product-docs, api-docs | F12 ("product versions and immutable publish snapshots are separate") |
| ⌘K dashboard palette; start-here checklist | product-docs | F6 (`apps/app/src/components/app/command-palette.tsx:94`; dashboard `index.tsx:337–421`) |
| Three reader themes Harbor/Manuscript/Signal; light and dark; RTL; same content; Signal is code-oriented | more, arabic, product-docs, api-docs | F7 |
| Logo, colors, custom domain on themes | product-docs | F7 (branding overrides); logos `packages/validators/src/index.ts:262–265`; F12 custom domains |
| Custom domains with guided DNS checks | more | F12 (CNAME/TXT verification, `apps/server/src/actions/domains.ts:24`, `:203`) |
| RTL editor, dashboard and docs site; per-language page tree; content in any language | arabic, FAQ | F8; content languages take any BCP-47 code |
| Code and English terms stay readable inside Arabic text | arabic feature | Facts "Ten strongest" #3 ("RTL code isolation") |
| Linked translations tell search engines the page language | arabic feature | F8 (linked hreflang only, `apps/app/src/lib/site-seo.ts:315–334`). Avoided "every page" (A08) |
| 12 interface languages, some strings still in English | FAQ only | F8 (qualifier required) |
| GitHub two-way sync via dedicated branch and pull requests; per-PR preview links hidden from search engines; conflicts resolved in Nibleaf | more, product-docs, api-docs | F9 (`apps/server/src/modules/app/git/routes.ts:13`, `:43`; `apps/app/src/routes/git-preview.$token.tsx:1`) |
| Public GitLab and other Git repos import one way | product-docs, api-docs FAQ | F9 |
| No live co-editing with shared cursors today | product-docs FAQ | F6 ("No live multi-user co-editing/presence guarantee") |
| Private docs for invited readers, page-scoped; not SAML/SCIM | more, product-docs | F12 Private docs |
| OpenAPI 3.x import (upload, URL or repository); external refs bundled; endpoint/schema pages with try-it | more, api-docs | F12 OpenAPI; sources `packages/validators/src/index.ts:556–571` |
| Try-it depends on the target API's CORS and reader credentials; no mocking or monitoring | api-docs FAQ | F12 OpenAPI boundary |
| llms.txt, llms-full.txt and page Markdown per site; private pages excluded | more, api-docs | F12 AI-readable docs (`apps/server/src/actions/sites.ts:908–961`) |
| Your own OpenAI or OpenRouter key, stored encrypted | more, FAQ | F5 (AES-256-GCM, `packages/shared/src/crypto.ts:4–28`) |

### Importers (checked in code; not in `facts.md`)

| Claim | Where | Evidence |
|---|---|---|
| Import from a public GitHub repo of Mintlify docs (docs.json or mint.json) | how-it-works, FAQ, use cases | `apps/server/src/actions/importers/index.ts:14–18`; `apps/server/src/modules/app/imports/routes.ts:11–16`; `apps/server/src/actions/importers/mintlify.ts` (header comment: navigation groups, pages, assets); UI `apps/app/src/components/settings/import-tab.tsx:26` |
| Import a GitBook Git Sync repo from GitHub (pages, navigation, images; redirects) | same | `imports/routes.ts:17–22`; `importers/gitbook.ts` header; UI `import-tab.tsx:27`; F9 mentions #235 GitBook Git Sync importer |
| Ghost exports can be imported | FAQ | `imports/routes.ts:23–27`; `import-tab.tsx:28` |
| "Check custom components after the import" | FAQ | Honesty caveat from D04/A09 (bounded component vocabulary) |
| Imports are admin-only | (not stated in copy) | `imports/routes.ts:9–10` |

### Support-teams positioning

| Claim | Where | Evidence |
|---|---|---|
| Nibleaf has no ticket inbox, live human chat or CRM | support-teams FAQ | claims-audit blog review (`customer-support-knowledge-base.mdx` row: "no ticket inbox/live human chat/CRM") |

## Deliberately left out, and why

- **Speed or performance words** ("fast", "instant"). There's no measured evidence (F4 performance caveat, A17). The brief's "fast, searchable docs site" became "searchable docs site".
- **Version numbers.** None appear anywhere (brief, B01).
- **GitHub star count in copy.** Only the shell's `starsLabel` formatter exists, for the component's live count.
- **"Fair use during the beta" and "custom domains and analytics on Cloud".** These are unverified cloud policy and provisioning claims (A14, A15, F12). The cloud card lists core features only.
- **"Your data never leaves your infrastructure"** (A03) and any statement about model providers' training or data policies. The privacy FAQ was retitled "What happens to my readers' data?" because no fact covers training.
- **"No tracker"** (A06). The copy describes first-party analytics controls instead.
- **"Suggested pages" in the search dialog.** The `suggestions` prop exists (`site-search-dialog.tsx:36`), but `site-search.tsx` doesn't pass it, so it isn't claimed.
- **Mobile "full screen" search.** Not in the facts.
- **Competitor absences.** No line says a competitor lacks Arabic, RTL, MCP or AI. Compare descriptions state what Nibleaf is, not what others lack.
- **Hosted CLI / npm package.** It isn't published (claims-audit `/developers` row).
- **"12 interface languages" outside the FAQ.** It appears only in the Arabic-support FAQ answer (EN and AR), with the qualifier.
- **Use-case pages in the shell nav.** Not linked, because the routes don't exist yet. Use-case pages link to each other only through their `related` lists, which point at `/use-cases/...` (EN) and `/ar/use-cases/...` (AR).

## Things the master should know

1. **Search improvements may not be on Cloud yet.** Section-level results, recent searches and the Ask AI handoff landed in #281 (merged 2026-11-06), after the last known Cloud deploy. `availability.ts` has no key for search, and I didn't write my own availability sentence. If Cloud predates #281, consider adding a `readerSearch` capability. The Ask AI handoff bullet already says "when Ask AI is on".
2. **Media alt text assumes certain captures:**
   - `chat` / `hero-chat` EN alts match `chat-en-*` (Export your notes, three sources, related questions).
   - The AR alts are worded to fit both captures: `chat-ar-wide` shows the CLI-install article and `chat-ar-phone` shows the export article.
   - The `search`, `insights`, `mcp`, `editor` and `arabic` alts follow the capture plan in the brief.
   - The `themes` alt ("Harbor, Manuscript and Signal showing the same docs") and the `dashboard` alt ("The Nibleaf dashboard for a docs project") are my assumptions. Adjust them if the captures differ.
   - The insights and MCP alts in Arabic avoid quoting UI labels, in case the AR page reuses the English screenshot.
3. **The Arabic comparisons** link `/ar/documentation-platforms` first. That page currently carries the false "no integrated AI assistant" caveat (A01) through `marketing.arabicSeo.*`. Make sure that dataset is fixed before linking it prominently. English-only targets in the Arabic copy are marked "(بالإنجليزية)" in their descriptions.
4. **`docs.nibleaf.com?lang=ar`** is used as the brief specified. I didn't verify that the parameter switches the language.
5. **Ask AI on docs.nibleaf.com.** I don't know whether it's enabled there, so no copy suggests readers can try Ask AI on our docs.

## Suggested type changes (optional)

- An `api-reference` key in `MarketingMediaKey` (a capture of an OpenAPI endpoint page with try-it). The api-docs page currently reuses `themes` and `editor`.
- An optional `media` on `FeatureSection`, or a `media?: MediaRef | null` escape hatch. Some use-case solutions (Git sync, self-hosting) have no fitting capture, so they reuse `dashboard`/`editor`.
- Optionally, a `readerSearch` entry in `CLOUD_AVAILABILITY` (see item 1 above).

## Round-2 scoring fixes — 2026-11-07

| Claim | Change | Evidence |
| --- | --- | --- |
| Reader themes, GitBook import and the reader-data FAQ were presented as part of the self-hosted product | They now carry the same centralized availability note as Ask AI (`copy/availability.ts`: `readerThemes`, `gitbookImport`, `readerAnalytics`). The how-it-works step names only Mintlify import. | `gh release list`: v0.1.2 (2026-08-22) is the latest release, and the installer pins it (`scripts/install.sh`). `git grep -il harbor v0.1.2` finds nothing (themes are #96, #101 and #104). `importers/gitbook.ts` and the ClickHouse search-term pipeline (`storePublicSearchTerms`) are absent from v0.1.2. |
| "The same open-source product either way" | "One open-source codebase. New features reach the self-hosted release when a version that includes them ships." The Cloud vs self-host FAQ says the same. | `main` is 172 commits ahead of v0.1.2. |
| "Public pages are listed in llms.txt" | "Indexable public pages…" in English and Arabic. | Pages that are noindex, have external canonicals, or sit on sites or languages with indexing off are excluded: `packages/shared/src/public-markdown.ts:10`, `apps/server/src/lib/llms-txt.ts:19`, `apps/server/src/actions/sites.ts`. |
| MCP poster frame showed "Set up SAML 2.0 single sign-on between Okta and Nibleaf" | The poster is now the gap-finding frame (frame 14 of #280's `ai-client-journey.gif`). The caption says the demo's product facts, such as the Okta steps, are made up. | Nibleaf has no SAML code (`git grep -i saml origin/main -- apps packages` finds only marketing and comparison copy). |
| Final CTA paragraph contrast in the light theme (about 4.2:1) | `text-foreground/80` instead of muted grey on the tinted panel. | `packages/design-system/src/styles/globals.css` tokens. |
| Recording focus | Pressing play moves focus to the video instead of the page body. | `media/marketing-media.tsx`. |
| Arabic wording | "يصرّح بذلك حين لا يجد إجابة". Reading time is "مدة القراءة: …" with the nominative count. | Reviewer suggestions. |

## Round-3 scoring fixes — 2026-11-07

| Claim | Change | Evidence |
| --- | --- | --- |
| Meta title, description and OG cards advertised AI answers with no qualifier | Title: "open-source docs and help center in English and Arabic". The descriptions and both OG cards say AI answers are "rolling out" (Arabic: «تصل تدريجيًا»). | `copy/availability.ts`: `askAi` is `in-source`, and `site-chat.ts` and `answer-chat.ts` are absent from v0.1.2 |
| "…and each has a Markdown version" | "…with their full text in llms-full.txt" | Per-page Markdown arrived with #142 (2026-09-03, `packages/shared/src/public-markdown.ts`). v0.1.2 has `llms.txt` and `llms-full.txt` only. |
| How-it-works steps 3–4 and the Arabic-support FAQ ("Ask AI replies in Arabic") had no note | Both carry the central note | `copy/availability.ts` |
| Hero caption said "rolling out to the self-hosted release" | Now the approved wording: "arriving in the next self-hosted release and on Nibleaf Cloud as they roll out" | Owner-approved phrase |
| The Cloud vs self-host FAQ opened "It's the same open-source product" | "It's one open-source codebase." | Matches the paths section |
| `/cloud` claimed "automatic upgrades, custom domains, analytics", and its code comment said "live on Cloud" | "upgrades handled for you"; custom domains and analytics removed from the hero and the route description. The comment now says it omits capabilities still rolling out. | Cloud is a manual, pinned deploy, and its feature set is unverified (A14 and A15 above) |
| `/cloud` intro contrast in the light theme (about 4.2:1) | `text-foreground/80` | Same tokens as the final CTA fix |

## Round-4 scoring fixes — 2026-11-07

| Claim | Change | Evidence |
| --- | --- | --- |
| `/cloud` listed "Custom domains" and "GitHub two-way sync" under "What you get on Nibleaf Cloud" | Both items are now `deploymentDependent`, so `/cloud` leaves them out; the landing page still lists them, since every install has them. The test rejects either phrase on `/cloud`. | `facts.md` F12: Cloud custom-domain provisioning is deployment-dependent. F9: Git sync needs a configured provider app and webhooks. |
| Hero subtitle, assurances and caption on the tinted gradient (about 4.2–4.4:1) | `text-foreground/80` for the subtitle and `/70` for the small text | Computed from the tokens: `#737373` on 2–5 % `primary` over `#fafafa` gives 4.23–4.42:1, `foreground/70` gives 7.3:1 |
| Footer tagline on every page: "AI answers, search insights" | "Open-source documentation and help center, with first-class Arabic." | Same release rule; the footer also renders on `/cloud` |
| Arabic Full admin preset | «صلاحيات مشرف كاملة», the product label on `main` (#318/#319) | `settings_apikeys_full_admin` |
| Language switch on English pages without an Arabic twin | The accessible name is «Nibleaf بالعربية» instead of «اقرأ هذه الصفحة بالعربية», because the link goes to `/ar` | `MarketingShell` sets `alternateHref="/ar"` |
| Manifest comment | It now says the MCP asset is rendered from a session transcript | `media/manifest.ts` |
