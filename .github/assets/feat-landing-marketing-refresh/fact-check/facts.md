# Nibleaf capability facts — 2026-11-07

Evidence boundary: source at `ed15240ef891115d908e44317010ea0eca4d93f1` (main, PR #293). Read-only code inspection and public GitHub metadata; no servers, browsers, databases, builds, tests, or production configuration inspection. VERIFIED means implemented on this revision, not proven enabled on nibleaf.com or present in a published image. Cloud and self-host use the same implementation; optional infrastructure and operator policy can differ. “Editor” below maps to the internal `member` role; owner > admin > member (`packages/shared/src/constants.ts:4`, `packages/shared/src/rbac.ts:1`).

## Merge receipts

All requested PRs are MERGED in `lord007tn/nibleaf` (read with `gh pr view --json state,mergedAt,mergeCommit`). Dates UTC.

| PR | Merged | Main merge prefix | Scope |
|---|---|---|---|
| #277 | 2026-11-06 12:27:03 | b5b247bc | Workspace Smart AI providers |
| #279 | 2026-11-07 00:00:01 | 7b46917b | Reader Ask AI and conversation insights |
| #280 | 2026-11-06 17:34:22 | e1244b8f | Support MCP writes, prompts, OAuth |
| #281 | 2026-11-06 15:17:14 | 50124dba | Reader search and ergonomics |
| #282 | 2026-11-06 13:13:45 | b3112ff2 | Safe settings, domains, invites |
| #283 | 2026-11-06 13:24:28 | 5a7e04a5 | Start-here home and command palette |
| #284 | 2026-11-06 13:32:43 | b02fb606 | Editor creation, organization, publish safety |
| #285 | 2026-11-06 14:00:33 | 24d2b38a | Owner analytics and AI visibility |
| #286 | 2026-11-06 12:51:30 | e3f0188c | Shared loading controls/query client |
| #288 | 2026-11-06 16:10:50 | 178fc83d | Dashboard loading and query conventions |
| #290 | 2026-11-06 18:19:24 | 869b010d | Unknown analytics values and loading |
| #293 | 2026-11-07 00:50:43 | ed15240e | Smart AI/editor AI data loading |

PR links use `https://github.com/lord007tn/nibleaf/pull/<number>`. Earlier PR associations below come from main's Git history, not assumptions that recent PRs originated every feature.

## F1. Reader Ask AI — VERIFIED; cloud availability DEPLOYMENT-DEPENDENT

Readers of an enabled published project can ask questions in a streaming chat, ask follow-ups, open cited sections, rate an answer, and start a new conversation. It uses the active published access/version/language scope and retrieved passages, rather than unpublished drafts. The server checks citations/answer structure; low-confidence or invalid answers become a refusal with suggested articles and an optional project support link. This is a grounding/refusal mechanism, **not a guarantee that a model never makes an error**.

| Detail | Implemented boundary and evidence |
|---|---|
| Grounding and citations | Scope rechecked against tenant, deployment, version, language, visibility and allowed pages: `apps/server/src/lib/ai-search/runtime.ts:73`, `:90`, `:302`; generation/validation: `packages/search/src/answer-chat.ts:566`, `:632`; section links: `apps/app/src/components/site/ai-chat/message.tsx:20`, `:54`. #279; foundation #98. |
| Reader language | Prompt selects reply language from the question, preserves names/code, explicitly handles mixed Arabic/Latin questions; Arabic-script site languages include Arabic, Persian, Urdu etc. `packages/search/src/answer-chat.ts:52`, `:69`, `:74`, `:84`. This is source/prompt behavior, not measured translation quality across all languages. #279. |
| Follow-ups | Up to three suggested questions, grounded in supplied content; bounded model call with timeout. `packages/search/src/answer-chat.ts:103`, `:510`; `apps/server/src/lib/env-extras.ts:27`. #279. |
| Refusal/support | `apps/server/src/actions/site-chat.ts:375`, `:449`, `:454`, `:461`; `apps/app/src/components/site/ai-chat/message.tsx:87`, `:149`; URL accepts safe HTTP(S)/mailto: `packages/validators/src/index.ts:102`. Support link exists only if configured. #279. |
| Entry points | Floating launcher, end-of-article card, search handoff, `?ask=` deep link. `apps/app/src/components/site/ai-chat/chat-ui.tsx:28`, `:44`, `:49`; `apps/app/src/components/site/ai-chat/provider.tsx:28`; `apps/app/src/components/site/site-search-dialog.tsx:281`, `:298`, `:445`. Launcher waits for applicable consent banner. #279/#281. |
| Prerequisites | Qdrant, a READY nonempty published search index, live project `search.aiAnswers=true`, and a usable AI connection. `apps/server/src/lib/ai-search/runtime.ts:48`, `:59`, `:350`; provider resolution below. Does not require ClickHouse to answer. #277/#279. |
| Provider | Instance path uses `OPENROUTER_API_KEY` **and** `SEARCH_ANSWER_ENABLED=true`; explicit project OpenAI/OpenRouter BYO selection uses its verified encrypted connection and project opt-in (does not require the instance answer switch). Explicit selection never silently falls back to another key. `packages/search/src/workspace.ts:13–56`. #277. |
| Spend controls | Defaults: 10 answer requests/minute/caller; 200 answer requests/project/day; 20 turns/conversation; 150,000 tokens/conversation; 2,000,000 tokens/project/UTC day; six history messages within 1,500 history tokens. Operator configurable; daily chat token budget 0 disables that budget. `packages/search/src/keys.ts:32–37`, `apps/server/src/lib/env-extras.ts:14–31`, `apps/server/src/lib/ai-search/quota.ts:43`, `apps/server/src/lib/ai-search/chat-budget.ts:109`, `:114`. Reservation/settlement includes rewrite/suggestion calls. These are request/token controls, not a promised dollar budget or free hosted AI allowance. #279. |

**Assistant dashboard:** project members can read conversation list/detail, satisfaction/reasons, unanswered/content-gap signals, usage by model, tokens and provider-reported USD costs; admin/owner can delete captured records. `apps/server/src/modules/app/ai-conversations/routes.ts:7`, `:13`; `apps/server/src/actions/ai-conversations.ts:45`, `:63`, `:105`; `apps/server/src/mcp/ai-conversations.ts:22–64`. #279. Cost can be unknown, particularly where the provider did not report all billed-call costs; do not call this a complete invoice (`packages/search/src/workspace.ts:108`).

Conversation reporting needs ClickHouse migrations/worker/analytics ingestion. `ANALYTICS_MODE=disabled` disables this store. Transcript capture additionally needs `AI_CONVERSATION_ENCRYPTION_KEY` or a derived key from `INTEGRATION_CREDENTIAL_ENCRYPTION_KEY`, the project's capture setting (default true), and applicable consent. Redacted text is sealed for queue transport; this does not prove encrypted-at-rest ClickHouse transcripts. `apps/server/src/lib/ai-search/conversation-archive.ts:73–81`, `:98`, `:173`; `packages/bullmq/src/jobs/ai-conversations.ts:4`, `:23`; `apps/server/src/actions/ai-conversations.ts:28–39`. #279.

## F2. Reader search — VERIFIED; advanced path DEPLOYMENT-DEPENDENT

Built-in full-text/fuzzy search uses Orama, requires neither Qdrant nor an AI key nor an external search subscription. It indexes the published snapshot. Search dialog supports Cmd/Ctrl+K, optional `/` hotkey, Esc/Cancel/outside-close, focus return/trapping, recent queries stored locally per project (clearable), keyboard navigation, loading/retry states, page and matching-section rows, and cross-language result labels. An unspecified language searches enabled published languages; this is not automatic translation of queries.

Evidence: `packages/search/src/index.ts:1`, `:53`, `:125`, `:217`; `apps/server/src/actions/sites.ts:560`, `:615`; `apps/app/src/components/site/site-search.tsx:33`, `:65`, `:98`, `:135`, `:141`; `apps/app/src/components/site/site-search-dialog.tsx:22`, `:265`, `:288`, `:635`, `:676`, `:692`; `packages/i18n/src/site-search.ts:26`. PR #281 (earlier Arabic/search work #136, hybrid foundation #98).

Arabic path uses Arabic tokenization, diacritic/tatweel removal, alef normalization, maqsura normalization, and bounded conservative morphology; exact spelling signal outranks fuzzy/morphological matches. It is not exhaustive linguistic analysis or a multilingual semantic guarantee. `packages/search/src/arabic.ts:44`, `:96`, `:230`; `packages/search/src/index.ts:36`, `:127`, `:248`, `:278`.

Optional Qdrant path fuses sparse BM25 and dense retrieval with tenant/access filters. Qdrant and an AI embedding connection/index are required; answer generation is a separate opt-in. `SEARCH_RUNTIME` is `legacy|shadow|hybrid`, default **shadow** (returns Orama while evaluating Qdrant), not hybrid-authoritative by default. `packages/search/src/keys.ts:21–24`; `apps/server/src/lib/ai-search/runtime.ts:73`, `:125`; `apps/server/src/actions/sites.ts:619`; `apps/worker/src/processors/search.ts:309`, `:354`. Section-level results and improved dialog UX are not exclusive to paid AI retrieval.

## F3. Support MCP — VERIFIED; enabled cloud endpoint DEPLOYMENT-DEPENDENT

This is an authenticated **project management/support MCP**, not an automatically public, anonymous MCP server on every docs domain. Members can connect to one project by scoped expiring personal keys or OAuth sign-in; server checks the actor's current membership and scope. OAuth requires HTTPS public auth origin (loopback HTTP allowed) and working auth/migrations. `packages/auth/src/mcp-oauth.ts:47`; `apps/server/src/mcp/auth.ts:1`; `packages/shared/src/mcp.ts:31`, `:98`. PR #280 (read-only foundation #108).

| Preset | Who selects it | Actual capability |
|---|---|---|
| Read only | member/editor, admin, owner | Project/pages/languages/versions, aggregate analytics, search diagnostics, deployments; no writes. |
| Support writer | member/editor, admin, owner | Read-only set + sensitive search-term scope, working-copy writes, preview and confirmed publishing. Terms still obey analytics privacy rules. |
| Full admin | admin/owner in preset UX | Every current MCP scope, including usage/add-ons/integrations/themes/exports. Name does not mean arbitrary admin power: no credential reads, code execution, deletion, or general settings writes. |

Preset evidence: `packages/shared/src/mcp.ts:67–96`; individual scopes' minimum role is currently MEMBER (`:37–55`).

Exact registered tool list (scope-filtered; optional underlying services can return unavailable):

- Capability: `get_capabilities` (`apps/server/src/mcp/capabilities.ts:113`).
- Content: `get_project`, `list_pages`, `get_page`, `list_languages`, `list_versions` (`apps/server/src/mcp/content.ts:26`, `:42`, `:53`, `:103`, `:117`).
- Analytics: `get_analytics_overview`; `get_ai_usage`, `list_ai_conversations`, `get_ai_conversation`, `get_ai_feedback_summary`, `list_ai_content_gaps` (`apps/server/src/mcp/insights.ts:47`; `apps/server/src/mcp/ai-conversations.ts:22–64`).
- Investigation: `get_top_pages`, `get_top_searches`, `get_failed_searches`, `get_page_feedback`, `get_referrers`, `get_search_health` (`apps/server/src/mcp/investigate.ts:11–18`).
- Search: `get_search_configuration`, `get_search_index_diagnostics` (`apps/server/src/mcp/search.ts:37`, `:46`).
- Usage: `get_usage_summary`, `get_entitlements`, `check_entitlement` (`apps/server/src/mcp/usage.ts:64`, `:84`, `:89`).
- Add-ons: `list_addons`, `get_addon`, `list_addon_audit_events` (`apps/server/src/mcp/addons.ts:57–72`).
- Themes: `get_theme_catalog`, `get_theme_template`, `preview_theme_import` (`apps/server/src/mcp/themes.ts:43–68`; preview does not import).
- Operations: `list_exports`, `get_export`, `list_deployments`, `get_deployment`, `get_pending_changes` (`apps/server/src/mcp/operations.ts:14–43`).
- Integrations: `list_integrations`, `get_integration`, `get_git_integration_status` (`apps/server/src/mcp/integrations.ts:111–141`).
- Support writing: `search_pages`, `create_page_draft`, `update_page`, `move_page`, `translate_page`, `set_page_visibility`, `preview_publish`, `publish_changes` (`apps/server/src/mcp/content-write.ts:24–34`). `translate_page` saves text supplied by the client; the MCP server does not invoke a translation model for it.

Exact prompts: `find_content_gaps`, `weekly_docs_health_report`, `draft_article`, `translate_article`, `review_unhelpful_pages` (`apps/server/src/mcp/prompts.ts:6–12`). Each is exposed only if the credential has all its required scopes.

Writes save to the working copy. Publishing is project-wide, including other authors' pending edits. It requires a preview token, `confirm:true`, and a fresh fingerprint; token expires after ten minutes, rejects changed input, and cannot be reused successfully. The server enforces the token/confirmation contract; it cannot prove a human actually read the preview. No page-delete or general settings-write tool. Evidence: `apps/server/src/mcp/server.ts:30–35`; `apps/server/src/mcp/content-write.ts:152`, `:668`, `:700`, `:750`, `:953`, `:973`. #280.

Limits default to 120 requests/minute, 20 writes/minute, six publishes/hour per credential **per API process**, not a distributed global ceiling (`apps/server/src/env.ts:52–57`; `apps/server/src/mcp/rate-limit.ts:18`, `:57`, `:87`). `MCP_ENABLED` defaults false and production Compose preserves false (`apps/server/src/env.ts:44`; `docker-compose.prod.yml:63`). Cloud enablement is unverified.

Documented clients: ChatGPT (OAuth custom connector/developer mode), Claude web/Desktop connectors (OAuth), Claude Code, Cursor, VS Code with MCP-capable extension (OAuth or generated personal-key configurations); Desktop key transport can use `mcp-remote`. This establishes documentation, not successful live interoperability with every client's current plan. `docs/product/ai-assistants.mdx:31`, `:62`, `:86`, `:98`, `:109`, `:194`, `:287`; setup UI/source: `apps/app/src/components/project-settings` (client setup strings referenced in docs). #280.

## F4. Docs-owner analytics — VERIFIED; advanced reports DEPLOYMENT-DEPENDENT

Members/editor/admin/owner can read project reports (`apps/server/src/modules/app/analytics/routes.ts:7`, `:19`). Admins manage settings. PR #285 adds owner insights; #290 prevents unavailable views from becoming fabricated zeros; #279 adds separate assistant reporting.

| Report | What exists | Storage/prerequisite |
|---|---|---|
| Basic project/workspace overview | Views, unique session counts, top pages/searches, referrers, language/device breakdowns and time series | Relational PostgreSQL path continues in default `ANALYTICS_MODE=disabled`; “disabled” here means ClickHouse disabled, not all product analytics disabled. `apps/server/src/actions/analytics.ts:33–98`, `:153–222`, `:239`. |
| Overview/pages/page detail | Period comparison, visits/engagement, content-health signals, popular/entry/exit pages and page details | ClickHouse read modes; `apps/server/src/actions/analytics-insights.ts:40–55`; `packages/clickhouse/src/insights/pages.ts:18`, `:166`. |
| Search | Settled searches, zero-result rate, CTR, refinements, average click position, visible terms and gap signals; typeahead collapsed | ClickHouse with known denominators; rates can be null/partial. `packages/clickhouse/src/insights/search.ts:4–49`, `:64–85`, `:131`. Raw terms are separately gated. |
| Feedback | Helpful/not-helpful counts, ratios and per-page prioritization | ClickHouse insights; basic event exists without it. `apps/server/src/actions/analytics-insights.ts:50`; `apps/server/src/mcp/investigate.ts:32`. Do not promise free-form page-feedback comments: investigation explicitly says comments are not stored. |
| AI visibility | AI training/search/assistant crawler categories, requests/crawlers/top pages; human AI-assistant referrals kept distinct from crawls | Origin-side capture + ClickHouse. CDN-only hits are invisible to this capture; UA identification is not proof of model training or a citation in an answer. `packages/clickhouse/src/insights/types.ts:298`; `packages/clickhouse/src/classifiers.ts:1`; `apps/server/src/mcp/investigate.ts:36`; `apps/app/src/server.ts:250`. |
| Performance | Web-vitals report and page-level vitals | Reader event collection + ClickHouse; not an external CrUX field score or lab performance guarantee. `apps/server/src/actions/analytics-insights.ts:54`; `apps/app/src/providers/site-analytics-provider.tsx:110`; `packages/clickhouse/src/insights/pages.ts:166`. |
| Assistant dashboard | Questions/conversations, satisfaction, unanswered/gaps, per-model usage/cost | F1 capture/reporting prerequisites. |

Modes: `disabled` (relational), `dual_write` (writes both, relational overview reads), `shadow_read` (ClickHouse read/evaluation plus relational comparison), `clickhouse` (authoritative ClickHouse). Advanced insights require `shadow_read` or `clickhouse`, schema migrations, URL/reader-writer credentials, `ANALYTICS_HASH_SALT`, worker and durable queue/ingestion setup. `packages/clickhouse/src/keys.ts:4–43`; `packages/clickhouse/src/insights/queries.ts:17`; `apps/server/src/actions/analytics.ts:371`.

Privacy: analytics envelope has no raw IP field; identities are salted/scoped hashes and accepted only with eligible consent. Denied/unknown consent can still produce content-free page/search counts without visit identity. Search text requires public-site status + `analytics.storePublicSearchTerms=true` + eligible consent; text is normalized/redacted and shown only after **two distinct visits**. `packages/clickhouse/src/events.ts:290–300`, `:328–384`; `apps/server/src/actions/analytics-insights.ts:20–25`; `packages/clickhouse/src/insights/reader.ts:8`; `packages/clickhouse/src/insights/search.ts:75`. Do not extend “no IP in reader analytics” to auth/CDN/server logs: authentication sessions use IP data (`packages/auth/src/server.ts:908`, `:922`). #285.

Custom domains resolve to the same project reader and analytics context, so no separate custom-domain analytics product or plan is needed. `apps/app/src/lib/custom-domain-rewrite.ts:6`; `apps/app/src/server.ts:291`; `apps/app/src/providers/site-analytics-provider.tsx:70`. Live domain event delivery and ingress headers remain deployment-dependent.

## F5. Bring your own AI key — VERIFIED

OpenAI and OpenRouter API keys are supported project/workspace connections. Admin/owner can save, verify, select or disable them; members can view redacted configuration/health. OAuth sign-in to OpenAI is not a delivered substitute for a key. `apps/server/src/modules/app/integrations/routes.ts:10–46`; `apps/server/src/actions/workspace-ai.ts:70`, `:116`, `:162`, `:185`, `:194`, `:247`. #277/#293.

Credentials are encrypted using AES-256-GCM, live project/provider binding checked on decrypt, old configured decrypt-only keys supported, secrets never returned by the configuration surface (`packages/shared/src/crypto.ts:4–28`; `packages/search/src/workspace.ts:38–54`). Requires operator `INTEGRATION_CREDENTIAL_ENCRYPTION_KEY`. Verification and matching embedding-model configuration required before selection; changing providers requires reindexing/readiness. Not every arbitrary OpenAI-compatible endpoint/provider is supported.

**What it pays for:** document-index embeddings, query embeddings, grounded answers, chat, follow-up/rewrite calls. Embedding model/dimension policy remains instance-configured, but the **workspace-selected connection/key** supplies embedding calls: `packages/search/src/workspace.ts:69–95`; `apps/worker/src/processors/search.ts:309`, `:354`, `:421`. Thus “embeddings remain paid by the instance” is false for BYO selection. Operator-configured OpenRouter utility model is billed to the selected OpenRouter connection (`apps/server/src/lib/env-extras.ts:24–27`).

**Editor assist is separate:** continue/rephrase/outline/summarize draft operations call instance `OPENROUTER_API_KEY` and `AI_DRAFT_MODEL`, require `AI_DAILY_LIMIT>0` (default 50/day/workspace). Its request counter fails open if Redis is unreachable, unlike reader-chat spend protection, which fails closed (`apps/server/src/lib/ai-quota.ts:37–57`; `apps/server/src/lib/ai-search/chat-budget.ts:113–116`). BYO Smart AI keys do not power editor drafting on this revision. `apps/server/src/actions/ai.ts:16–58`, `:61`; `apps/server/src/lib/env-extras.ts:32`; `apps/server/src/modules/app/ai/routes.ts:8`. #293 changes loading, not this credential boundary; #260 hides unavailable AI.

## F6. Non-technical dashboard/editor — VERIFIED

Start-here checklist uses actual project/edit/publish/team progress and links into the correct screen. Cmd/Ctrl+K dashboard palette searches pages/sites/settings and actions across routes. `apps/app/src/routes/app/(dashboard)/index.tsx:57`, `:125`, `:337–421`; `apps/app/src/components/app/command-palette.tsx:94`, `:100`, `:135–244`. #283.

TipTap visual block editor round-trips **Markdown/curated MDX text stored in the database**. It does not make arbitrary React/MDX runtime code portable. Slash components include headings, lists, task lists, quotes, code/Mermaid, callout variants, steps/cards/card groups, tabs/accordions/details, media, code groups, fields, files/folders, request/response examples and changelog-style updates. `apps/app/src/components/editor/extensions/slash-command.tsx:138–634`; `apps/app/src/components/editor/extensions/mdx-nodes.ts:10–18`, `:358`; `apps/app/src/components/editor/extensions/mdx-roundtrip.ts:1`. Unsupported source can remain protected/read-only rather than editable as every possible component. #284, earlier #46/#212/#236.

Unsaved settings/edit guards, visible save/error state, safe create/move/delete flows, preview in a separate authenticated route, publish preflight and pending-changes checks are implemented. Draft save is separate from immutable publish. `apps/app/src/routes/app/projects/$projectId/editor.tsx:157`, `:172`, `:279`, `:304`; `apps/app/src/components/project/publish-modal.tsx:1`; `apps/server/src/actions/deployments.ts:84`, `:358`. #282/#284/#286/#288/#293. No live multi-user co-editing/presence guarantee; anchored comments and Git review are supported. Editor AI: F5. Comments: `apps/server/src/modules/app/comments/routes.ts:1` and editor comment decoration source; #46/#284.

## F7. Reader themes — VERIFIED

Exactly **Harbor, Manuscript, Signal** structural templates; each has light and dark palettes, branding overrides, and direction-aware reader structure. Harbor is library/reference layout, Manuscript chapter-led, Signal code-oriented. `packages/shared/src/themes.ts:271`, `:291`, `:311`, `:393`; live reader structures `apps/app/src/components/site/documentation-theme-provider.tsx:56`, `:128`, `:211`, `:347`; exported structures `packages/shared/src/theme-repository-templates/layouts.ts:1`. Admin/owner configures/imports the project theme; project members can inspect/export it (`apps/server/src/modules/app/projects/routes.ts:34`, `:51`, `:57`). Readers use the published theme and configured appearance controls. PR #96; runnable/exportable theme repositories #101. These are three layouts, not three color swatches. Source supports RTL; no fresh browser acceptance was performed.

## F8. Arabic/RTL and languages — VERIFIED with PARTIAL translation completeness

Twelve selectable interface locales: `en, ar, zh-CN, hi, es, fr, bn, pt-BR, ru, ur, id, de`; Arabic and Urdu are interface RTL. `packages/i18n/src/locales.ts:1–15`, `:23`; `packages/i18n/project.inlang/settings.json:4`. PR #240's qualified “12 interface locale options, some strings still in English” remains correct; do not say twelve fully translated interfaces.

Fresh catalog comparison: each JSON has 3,528 keys and no keys missing relative to English. Exact English-identical values: Arabic 213; Bengali 1,175; German 1,234; Spanish 1,188; French 1,231; Hindi 1,173; Indonesian 1,200; Portuguese-Brazil 1,199; Russian 1,173; Urdu 1,180; Simplified Chinese 1,170. These are string-equality counts, **not translation-quality percentages**: include names, code, intentional same text, and Arabic strings deliberately present in EN marketing keys. Non-English catalogs contain long English usage/AI strings (`packages/i18n/messages/zh-CN.json:2644`, `ur.json:2111`). English/Arabic are the primary complete journeys; even Arabic is not wholly translated.

Content languages accept valid BCP-47 codes independently of the twelve interface options; each language has its own tree and enabled/indexing flags. Editor/member and higher roles can create/update languages, not just admins (`apps/server/src/modules/app/languages/routes.ts:7`, `:16`). Linked translation keys connect actual alternate pages; hreflang is omitted for missing/non-indexable siblings and private/noindex contexts. `packages/validators/src/index.ts:608`; `apps/server/src/actions/sites.ts:337`, `:451–476`; `apps/app/src/lib/site-seo.ts:315–334`. Thus “hreflang for every page” needs qualification. Arabic search F2; reader chat language F1. #281, earlier #136/#148/#240.

## F9. Git — VERIFIED for GitHub; PARTIAL provider breadth

GitHub two-way authoring: dedicated branch, push browser edits, create/update draft PR, pull/reconcile upstream changes, conflict handling, immutable noindex PR preview. Public GitLab and generic Git imports/legacy sync are one-way; no shipped two-way GitLab/Bitbucket workflow or arbitrary multi-repository project parity. Admin/owner connects/authorizes/disconnects; member/editor and higher can run push/pull and resolve conflicts. Requires configured Git provider auth, repository/branch access, credential encryption and working webhooks/workers. `apps/server/src/modules/app/git/routes.ts:13`, `:17`, `:35`, `:41`; `apps/server/src/actions/git/github.ts:77`; `apps/worker/src/processors/git.ts:1`; `apps/app/src/routes/git-preview.$token.tsx:1`. Main integration PR #46 (later architecture #100); import #235 is a **GitBook Git Sync importer**, not new two-way GitLab support.

## F10. Exports — VERIFIED; render delivery DEPLOYMENT-DEPENDENT

Immediate project Markdown ZIP (Markdown plus manifest), runnable theme repository ZIP, and background exports from a published snapshot in **Markdown ZIP, static HTML ZIP, PDF**. Manual export create/cancel: editor/member+; download/history: project members; schedules: admin/owner. Daily/weekly/monthly schedules with timezone, retention, run history, cancellation and private download attachments. `apps/server/src/actions/export.ts:53`, `:109`; `apps/worker/src/processors/export.ts:60–66`; `packages/shared/src/rbac.ts:23–24`; `apps/server/src/modules/app/exports/routes.ts:7–55`; `packages/shared/src/export-schedule.ts:1`, `:91`.

Requires working workers/cache/S3; PDF additionally Chromium and fonts (`apps/worker/src/processors/export.ts:63`). Max 20 schedules/project (`apps/server/src/actions/exports.ts:163–165`); active/daily/manual retention operator limits (`apps/server/src/env.ts:64`). Scheduled exports are archives, not a complete database/disaster-recovery backup. PR #46 integrates exports; #198 Arabic PDF/runtime; #211 download fixes; #220 bounds PDF; #221 language destinations; #276 graceful Chromium drain.

## F11. Self-hosting and public releases — PARTIAL distribution claim

Full application source is AGPL-3.0; installer/Compose architecture exists. Required logical services: PostgreSQL, Redis-compatible queues/cache (Compose uses **Dragonfly**), S3-compatible storage (bundled **MaxIO**), application/API/workers and migration. External compatible storage can replace bundled storage. Qdrant and ClickHouse are optional feature infrastructure; their absence does not remove basic editing/publishing/Orama. `docker-compose.prod.yml:27`, `:118`, `:138`, `:158`, `:180–270`; `docker-compose.search.yml:27`; `docker-compose.coolify.yml:189`, `:195`; license `LICENSE:1`. #241 installer validation; #247 upgrade docs; #267 release preparation; #277/#285 optional services.

Guided installer checks host/Docker architecture and Compose checksum, pulls the pinned image and refuses destructive reinstall; declared public image architecture **linux/amd64 only**, not ARM64. `scripts/install.sh:14–16`, `:81`, `:94`, `:197`, `:206`; `docker-compose.prod.yml:27`. This is source support/declared distribution, not a fresh pull/install proof.

**Fresh GitHub result (2026-11-07):** latest PUBLIC release is [v0.1.2](https://github.com/lord007tn/nibleaf/releases/tag/v0.1.2), published **2026-08-22T20:25:25Z**. Assets: `docker-compose.yml`, `install-command.txt`, `nibleaf-install.sh`, `self-host-release.json`, `SHA256SUMS`. Other public releases listed: v0.1.1 (2026-08-15), v0.1.0 (2026-07-09). Read with `gh release list` and `gh api repos/lord007tn/nibleaf/releases/latest`. `gh api .../releases/tags/v0.2.0` returned **404**. Do not infer GHCR tag availability solely from this; image registry was not pulled.

Main's `release/self-host.json:2`, `docker-compose.prod.yml:27` and `README.md:146` target **v0.2.0**, but this is preparation metadata, not a published v0.2 release receipt. README/bootstrap currently directs users to an unverified v0.2.0 release asset. Current main capabilities cannot be attributed to public v0.1.2 without inspecting that release. Owner instruction for this refresh: public launch will be **v0.1.0**. That is a future naming decision supplied by owner, not today's latest GitHub release. Master must reconcile launch assets/version manifest/upgrade docs; research made no such edits.

Every marketing version-name occurrence is inventoried in `claims-audit.md` (including both locales, README, generated i18n release keys and blog). No headline should call v0.2 current.

## F12. Additional capabilities and business claims

| Capability | Verdict; who and prerequisites | Code evidence / merged PR |
|---|---|---|
| Custom domains | VERIFIED code; admin/owner configures CNAME/TXT and verified active DNS/TLS before primary domain. Other verified hosts consolidate to primary. Wildcard project subdomains require operator DNS/TLS/ingress. Actual cloud provisioning DEPLOYMENT-DEPENDENT. | `apps/server/src/actions/domains.ts:24`, `:33`, `:203`, `:299`; `apps/app/src/server.ts:318`; #282, earlier #46/#137/#182. |
| Versions and rollback | VERIFIED: product versions and immutable publish snapshots are separate; readers keep last READY snapshot while publish queued; rollback creates new publish from earlier snapshot. “Instant” or “one click” is an overstatement of asynchronous work/confirmation. | `apps/server/src/actions/deployments.ts:84`, `:414`, `:448`, `:477–496`; #284/#46. |
| Private docs | VERIFIED: reader invitations/sessions, JWT handoff/groups/audiences and page-scoped access, distinct from dashboard membership. Requires configured reader auth; unauthorized public callers get concealed not-found. Not SAML/SCIM enterprise workforce SSO. | `apps/server/src/actions/reader-access.ts:1`; `apps/server/src/modules/public/reader-access/handlers.ts:1`; published boundary `apps/server/src/actions/sites.ts:516–525`; #46 (later #194). |
| OpenAPI reference/try-it | VERIFIED: OpenAPI 3.x import/validation/bundled external references, endpoint/schema pages with Scalar/browser try-it. Requests still depend on target API availability/CORS and supplied credentials; not API monitoring/mocking platform parity. | `apps/server/src/actions/openapi.ts:1`; `apps/server/src/modules/app/openapi/routes.ts:1`; `apps/server/src/actions/sites.ts:516`; PR #46/#75/#76/#77. |
| AI-readable docs | VERIFIED: generated per-site llms.txt, llms-full.txt, page Markdown, aliases/negotiation and discovery; eligibility/access filtering. Neither named static file exists in `apps/app/public/`; root marketing files are generated by server, so absence there is not missing feature. Reader View/Copy Markdown buttons removed (#175), while HTTP Markdown remains. | `apps/server/src/actions/sites.ts:516`, `:908–961`; `apps/app/src/server.ts:401–403`; `apps/app/src/lib/marketing-markdown.ts:44–80`; #142/#175. |
| Page feedback | VERIFIED helpful/not-helpful interaction; member reports. Separate from Ask AI answer ratings and editor review comments. | `apps/server/src/modules/public/sites/routes.ts:42`; `apps/server/src/actions/analytics.ts:323`; `apps/server/src/mcp/investigate.ts:32–34`; #46/#285. |
| SEO | VERIFIED SSR source, page title/description, canonical, OG/Twitter, Article/Breadcrumb JSON-LD, robots/sitemaps, per-page noindex, linked-page hreflang. Does not promise ranking, crawler use, AI citations, or hreflang for missing translations. | `apps/app/src/lib/site-seo.ts:217–373`; `apps/server/src/actions/sites.ts:843–890`; `apps/app/src/lib/marketing-seo.ts:23`, `:126`; #47/#142/#148. |
| No credit card sign-up | VERIFIED application flow has no payment step; self-serve availability itself depends on `DISABLE_SIGNUP`, email/auth settings. No live sign-up submitted. | `apps/app/src/routes/(auth)/sign-up.tsx:31`; `apps/server/src/lib/env-extras.ts:35`; `packages/database/src/index.ts:172–186`; #46/#240. |
| Free cloud beta / paid plans | PARTIAL: free plan provisioning and no live payment checkout integration found. Usage/plan/entitlement/billing-outbox code **does exist**. “No billing code” is literally false; “no active paid self-service purchase flow found” is supportable. Free beta price, future preferential treatment, notice promises, manual commercial arrangements and fair-use policy need owner confirmation. | `packages/database/src/index.ts:172–186`; `packages/usage/src/provider.ts:14`, `:63`; `apps/server/src/lib/usage-ingest.ts:44`; #46 and usage foundation; marketing policy is not runtime evidence. |
| Support | VERIFIED published contact is support@nibleaf.com, separate privacy/security/abuse addresses; no verified SLA, response time, mailbox deliverability or staffed bilingual support guarantee. | `apps/app/src/routes/contact.tsx:7–34`, `:141`; #47/#177. |

## Ten strongest supported differentiating facts (not exclusivity claims)

1. Full-stack AGPL self-hosting includes authoring, server and worker, whereas GitBook's GPL repo is the reader frontend and Mintlify's documented headless frontend still calls its managed services. F11; competitor sources in `competitors.md`.
2. Browser authoring + deployable full stack + exportable Markdown in one product. F6/F10/F11.
3. Concrete Arabic authoring/search pipeline: direction-aware editor/reader, code isolation, bounded morphology and independent language trees. F2/F6/F8. Do not claim competitors lack Arabic or RTL.
4. Direct OpenAI **or** OpenRouter project credentials, encrypted and project-bound, with explicit selection/no silent fallback. F5. Competitor BYO exclusivity is not established.
5. Operator-owned AI/embedding infrastructure and token controls on self-host; no mandatory Nibleaf AI credit package in this source path. F1/F5/F11. Provider charges still apply.
6. Support MCP combines investigation, revision-safe writing and fresh preview-token publishing in the same self-hostable project boundary. F3. GitBook/Mintlify also have management MCP; this is not unique merely because it writes.
7. Owner analytics implementation is self-hostable, including AI crawler/referral separation, search gaps and performance. F4. Requires configured ClickHouse.
8. Explicit sensitive-search privacy contract: public opt-in, consent, redaction and two-distinct-visit text threshold. F4. No competitor privacy superiority was measured.
9. Markdown, static HTML and PDF exports plus scheduled snapshot archives. F10. Other products also export; the useful fact is this package within the deployable stack.
10. Three structural reader layouts sharing content, light/dark and RTL, plus a guided start-here dashboard and palette for mixed technical/non-technical contributors. F6/F7.

Commercial comparisons that are conditional on confirmed beta policy: custom domains without GitBook's Essential subscription and advanced owner analytics without Mintlify Pro subscription. Compare actual operating/provider costs; neither is zero-cost self-hosting.

## Deployment confirmations needed from master/owner

- Exact nibleaf.com serving commit/image; which post-#277–#293 features are deployed.
- Cloud MCP flag, externally advertised URL/HTTPS auth origin, OAuth migrations, ingress and client interoperability.
- Cloud Qdrant/index health, authoritative search runtime, provider availability, whether each workspace can select BYO keys, project answer opt-in defaults in deployed projects.
- Whether instance-funded AI is offered in beta; provider/token limits and who pays embeddings, answer, utility calls; editor drafting separately.
- Cloud ClickHouse mode/schema/worker/salt/capture key/retention; consent policy and transcript setting; origin-versus-CDN crawler coverage.
- Actual free-beta/fair-use policy, future-price/notice/preference promises, operational support channels, sign-up gate and domain TLS provisioning.
- Reconcile owner-planned v0.1.0 launch naming with public v0.1.2 history and main's v0.2.0-preparation assets before publishing download claims.
