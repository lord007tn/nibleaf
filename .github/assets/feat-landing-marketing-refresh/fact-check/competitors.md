# Official competitor facts — accessed 2026-11-07

Scope: public official pricing, docs and repositories, fetched directly on 2026-11-07. No paid accounts or browser trials. Amounts are USD; annual-billing monthly equivalents are not month-to-month prices. “Could not verify” is unknown, not absent. Pricing pages often lose checkmarks during text extraction; only explicit text/card descriptions are treated as plan-gating evidence. Short quotations identify subtle boundaries; all other text below is paraphrased. Vendor capabilities are vendor-reported, not independently exercised.

## Mintlify

| Topic | Verified fact / limit | Official source (accessed 2026-11-07) |
|---|---|---|
| Pricing/basis | Starter $0/month, five editor seats; Pro $450/month annual billing or $540 month-to-month, unlimited editor seats; Enterprise custom. Pro: 10,000 shared AI credits/month, $0.01/credit overage; assistant 25 credits/answer, no charge when unable to answer. | [Pricing](https://www.mintlify.com/pricing) |
| Custom domains / free plan | Starter explicitly includes custom domain, web editor, authentication, search MCP and API playground. Not a “no free plan” competitor. | [Pricing](https://www.mintlify.com/pricing) |
| Reader assistant | Cited question-answering chat with code examples; Pro and above. Organization shares credits across assistant, agent and Autopilot. | [Assistant](https://www.mintlify.com/docs/assistant/index) |
| MCP | Hosted search MCP lets clients retrieve published documentation. Separate Admin MCP has OAuth and content/settings/publish/PR operations; some management changes apply immediately. Exact plan gate not established. Do not call MCP itself Nibleaf-exclusive. | [Search MCP](https://www.mintlify.com/docs/ai/model-context-protocol), [Admin MCP](https://www.mintlify.com/docs/ai/mintlify-mcp) |
| Analytics | Pro/Enterprise analytics: traffic, assistant conversations/satisfaction/transcripts, search volume/queries/CTR, engagement, feedback; traffic distinguishes reader/agent activity and filters indexing/training bots. Advanced insights remains separately listed under Enterprise; basic analytics is not Enterprise-only. | [Analytics overview](https://www.mintlify.com/docs/analytics), [Traffic](https://www.mintlify.com/docs/analytics/traffic) |
| i18n/Arabic | Arabic is an explicitly supported locale; per-language navigation, translated UI and regional variants are documented; hreflang links represent real page translations. Current pages fetched did not confirm the older blanket claim of automatic Arabic/Hebrew RTL transformation. RTL editor/block fidelity was not tested. | [Navigation languages](https://www.mintlify.com/docs/organize/navigation#languages), [Internationalization](https://www.mintlify.com/docs/guides/internationalization) |
| Editor / Git | Browser visual/source editing, Git-backed saves/publish, feature branches/PRs, inbound Git changes, simultaneous editing/live cursors/comments. GitHub and GitLab deployments/sync are documented; Bitbucket Cloud requires Enterprise. Multi-repo exact gate remains uncertain from the extracted matrix. | [Editor](https://www.mintlify.com/docs/editor), [Collaboration](https://www.mintlify.com/docs/editor/collaborate), [GitLab](https://www.mintlify.com/docs/deploy/gitlab), [Bitbucket](https://www.mintlify.com/docs/deploy/bitbucket) |
| Open source / self-host | Could not verify a full-stack open-source/self-host distribution or full-platform license. Documented custom Astro frontend connects to Mintlify search/assistant APIs; it is not independent hosting of those services. **A second self-host output exists:** Enterprise static export is request-only, downloadable HTML/CSS/JS without runtime dependencies. Thus “only a custom frontend” is incomplete. | [Headless/custom frontend](https://www.mintlify.com/docs/guides/custom-frontend), [Static export](https://www.mintlify.com/docs/api/static-export/overview) |

Subtle phrase: static export is “only available on Enterprise plans”. The current pricing matrix also explicitly lists self-hosting as Enterprise; the [February announcement](https://www.mintlify.com/blog/custom-frontends-on-mintlify) describes enterprise custom frontends. The missing fact in Nibleaf copy is the additional static export, not a proven incorrect Enterprise gate. No verified whole-platform license text was obtained; proprietary-platform characterization should be bounded to absence of a public full-stack distribution, not a claim that Mintlify publishes no open-source components.

## GitBook

| Topic | Verified fact / limit | Official source (accessed 2026-11-07) |
|---|---|---|
| Pricing/basis | Free for individuals. Essential $65/site/month + $12/user/month, Ultimate $249/site/month + $12/user/month, advertised under annual billing; Enterprise custom. Essential lists $20 AI credits, Ultimate $100. Month-to-month amounts not verified. | [Pricing](https://www.gitbook.com/pricing) |
| Domains / AI plans | Custom domain, Assistant Ask, analytics/feedback from Essential; sidebar Assistant Chat, AI insights, authenticated access/adaptive content from Ultimate. Free includes block editor, GitHub/GitLab sync, API docs and previews. | [Pricing](https://www.gitbook.com/pricing) |
| Open source/self-host | Published reader frontend source is GPLv3. It is not the complete hosted workspace/editor/backend. Repository supports local rendering; do not confuse it with deprecated legacy GitBook. README discourages self-hosting unless certain it fits and says support/maintenance/updates cannot be guaranteed; categorical “unsupported” is stronger than that disclaimer. | [Repository README, Deployment](https://raw.githubusercontent.com/GitbookIO/gitbook/main/README.md), [GPLv3 license](https://raw.githubusercontent.com/GitbookIO/gitbook/main/LICENSE) |
| MCP | Two surfaces: published-site read-only MCP, and organization management MCP that can create/configure sites, draft/edit/restructure content and open change requests. Management supports OAuth or PAT. Published MCP needs Page actions enabled; turning it off gives 404. Public/private published endpoints differ; current docs describe OAuth for authenticated docs. | [Published docs MCP](https://gitbook.com/docs/ai-for-your-readers/mcp-servers-for-published-docs.md), [GitBook MCP](https://gitbook.com/docs/docs-as-code/gitbook-mcp.md), [Page actions](https://gitbook.com/docs/manage-your-site/customization/extra-configuration.md) |
| Analytics / AI traffic | Human Traffic report covers views/visitors/sessions/search, page ratings, traffic sources/campaigns. Separate Agents & MCP report covers LLMs/crawlers, machine page reads, MCP tool calls, MCP search queries and pages. Pricing explicitly gates search analytics/feedback at Essential and content gaps at Ultimate. Detailed Agents & MCP gate could not be verified. | [Traffic](https://gitbook.com/docs/analytics/insights/traffic.md), [Agents & MCP](https://gitbook.com/docs/analytics/insights/agents-and-mcp.md), [Pricing](https://www.gitbook.com/pricing) |
| i18n / RTL | UI localization does not translate authored content. Variants can represent languages or versions; language-specific variants move the language selector. Current pages do not establish complete Arabic editor/reader RTL fidelity; must test. | [Extra configuration](https://gitbook.com/docs/manage-your-site/customization/extra-configuration.md), [Variants](https://gitbook.com/docs/manage-your-site/site-structure/variants.md) |
| Git / editor | Bi-directional GitHub/GitLab integration; edits propagate in both directions. Configuring sync requires admin/creator. Block-based browser editor is explicitly on pricing. | [Git Sync](https://gitbook.com/docs/docs-as-code/git-sync.md), [Pricing](https://www.gitbook.com/pricing) |

Fetching the old `www.gitbook.com/docs/...` paths failed for some pages; canonical `gitbook.com` Markdown routes worked. Traffic/Agents pages failed in the web fetcher but succeeded in a direct Python HTTPS GET; that fallback was read-only, without asking the site's AI endpoint any questions.

## Fumadocs

| Topic | Verified fact / limit | Official source (accessed 2026-11-07) |
|---|---|---|
| Price/license | MIT-licensed framework, no vendor SaaS tier/billing schedule established in the reviewed framework docs. Framework can be used without a software purchase; hosting/models/search services may cost money. Do not invent a hosted “free plan”. | [License](https://raw.githubusercontent.com/fuma-nama/fumadocs/main/LICENSE), [Framework](https://www.fumadocs.dev/) |
| Hosting/domains | Deploys as a Next.js, React Router, TanStack Start, Waku or Astro app; static SPA/CDN option documented. Custom-domain capabilities/cost follow the chosen host, not a Fumadocs subscription gate. | [Deploying](https://www.fumadocs.dev/docs/deploying) |
| Reader AI | Official Ask AI integration can be added by CLI; OpenRouter/Vercel AI SDK starter, other model options and integrations. “Fumadocs doesn't provide the AI model”; operator supplies provider/service. No Fumadocs paid-plan gate verified. | [AI & LLMs](https://www.fumadocs.dev/docs/integrations/llms#ask-ai) |
| MCP | `fumadocs-core/mcp` provides `list_pages`, `get_page`, `search`; developer adds server/transport route and source renderer. Not an automatically hosted SaaS endpoint. | [MCP utility](https://www.fumadocs.dev/docs/headless/utils/mcp) |
| Search | Current default is **ZBSearch**, exposed through server API or static cached JSON. Orama Cloud remains an integration option; “default Orama in-browser index” is stale against today's official page. | [Default search](https://www.fumadocs.dev/docs/search/orama) (URL retains historical `orama`) |
| Analytics | Community analytics integration is listed, and search/AI providers can supply their own telemetry. A built-in managed owner/search/LLM-traffic analytics suite and associated plan gates could not be verified. | [Official docs index](https://www.fumadocs.dev/llms.txt) |
| i18n/RTL | Framework and Fumadocs routing must be configured; English UI default, extendable translations. A comprehensive Arabic/RTL guarantee was not established from the specific pages fetched. Do not equate this unknown with unsupported. | [i18n](https://www.fumadocs.dev/docs/internationalization), [UI translations](https://www.fumadocs.dev/docs/ui/translations) |
| Editor / Git | **Visual MDX editor exists.** Studio edits existing local docs in a browser, autosaves files; create/rename/delete stay in code editor/file manager. Embeddable UI library and editable component regions. Git review/publishing remains the site's deployment workflow; no separate hosted two-way sync service established. | [Visual editor](https://www.fumadocs.dev/docs/editor) |

This invalidates treating Fumadocs as code-editor-only. It remains a developer-integrated framework, which is a meaningful distinction from Nibleaf's ready workspace/editor/server product.

## Docusaurus

| Topic | Verified fact / limit | Official source (accessed 2026-11-07) |
|---|---|---|
| Price / license | MIT software; no Docusaurus paid SaaS tier. Host/services/staffing are separate. Documentation licensing is separate from software licensing. | [Software license](https://raw.githubusercontent.com/meta/docusaurus/main/LICENSE), [Official site](https://docusaurus.io/) |
| Self-host/domains | Builds static files; operator chooses web server/static host/CDN and domain. No vendor custom-domain plan gate. | [Deployment](https://docusaurus.io/docs/deployment) |
| Reader AI / MCP | No first-party hosted assistant plan or automatic first-party MCP service was verified in reviewed core docs. Integrations/custom React can add these. Do not claim it is impossible or that community solutions do not exist. | [Core product](https://docusaurus.io/), [Search](https://docusaurus.io/docs/search) |
| Analytics | No built-in managed owner/search/AI-traffic dashboard verified; operator adds integrations. Search providers can offer their own metrics. | [Core product](https://docusaurus.io/), [Search](https://docusaurus.io/docs/search) |
| i18n/RTL | Explicit Arabic/Hebrew RTL support, separate locale builds, theme translations and hreflang. Automatic translation SaaS and slug translation are not core goals. | [i18n introduction](https://docusaurus.io/docs/i18n/introduction) |
| Git / editor | Markdown/MDX source, React extension model, Git/translation-manager workflows; no core hosted visual editor verified. No two-way dashboard Git service to price; repo/build pipeline is owned by team. | [Official site](https://docusaurus.io/), [i18n workflow](https://docusaurus.io/docs/i18n/introduction) |
| Search | Official Algolia DocSearch integration, community Typesense/local search/custom SearchBar. Official docs now say DocSearch's service is free for eligible developer docs/technical blogs; not limited to open-source projects. | [Search](https://docusaurus.io/docs/search) |

## ReadMe

| Topic | Verified fact / limit | Official source (accessed 2026-11-07) |
|---|---|---|
| Pricing/basis | Starter $0/month; Pro $250/month billed annually; Enterprise custom/annual-only. Starter lists one project, one published version and seven-day documentation metrics. Pro lists unlimited versions, collaboration/reviews/private docs. Month-to-month Pro not verified. | [Pricing](https://readme.com/pricing) |
| Custom domain | Explicitly included on Starter. | [Pricing](https://readme.com/pricing) |
| Reader AI | Full Ask AI $150/month add-on on any plan; **Ask AI Lite included on Pro/Enterprise**, same default model answers but omits customization/model selection/analytics/API. Ask AI API Enterprise-only and not included merely by buying add-on. | [Ask AI](https://docs.readme.com/main/docs/ask-ai) |
| MCP | All projects/plans include a hosted docs/API MCP, enabled by toggle; can inspect specs, search docs and perform API calls. Separate management MCP can create/edit/maintain docs and settings from agents. | [API MCP](https://docs.readme.com/main/docs/mcp), [Management MCP](https://docs.readme.com/main/docs/readme-mcp) |
| Analytics | API usage/error metrics and doc/page/search/feedback metrics documented. MCP metrics and AI Discoverability are listed on pricing; extracted matrix did not establish their per-plan gates. Do not infer exact LLM-traffic reporting/gates from an icon-free matrix alone. | [Metrics charts](https://docs.readme.com/main/docs/using-metrics-charts), [Pricing](https://readme.com/pricing) |
| i18n/RTL | Localize integration and Enterprise localization workflow; localized navigation/search with per-language search indexing. Complete Arabic/RTL layout/editor guarantee not verified. | [Localize](https://docs.readme.com/main/docs/localize), [Enterprise localization](https://docs.readme.com/main/enterprise/language-support-and-localization) |
| Git | Two-way GitHub, GitLab or Bitbucket, all major content types. Starter pricing explicitly lists bidirectional sync. | [Bi-directional sync](https://docs.readme.com/main/docs/bi-directional-sync), [Pricing](https://readme.com/pricing) |
| Editor / self-host/license | Browser editor with visual/edit/raw content modes and MDX components. No full-platform OSS license or supported self-hosted complete workspace distribution verified; public SDKs/tools are not evidence the platform is open source. | [Editor](https://docs.readme.com/main/docs/the-editor), [Pricing](https://readme.com/pricing) |

## Current comparison-data fact reconciliation

Line references below are to `apps/app/src/lib/comparison-data.ts` on pinned main. Repeated FAQ/roundup sentences inherit the same verdict, not independent vendor facts. TRUE here means supported by today's official source above, within its stated limits.

| Locations | Competitor assertion | Verdict / needed correction |
|---|---|---|
| 138–159, 257–258, 359 | Mintlify free Starter/custom domain/web editor/auth/MCP/API playground; Pro $450 annual; Enterprise custom/SSO/SCIM | TRUE; add five Starter seats and monthly $540 if presenting full pricing. |
| 149 | Pro includes “automations” | STALE/ambiguous. Current pricing separates Pro Autopilot from Enterprise Automations. Use vendor's exact current feature names. |
| 154–159, 250, 335, 643 | Mintlify Enterprise self-hosted custom frontend; only frontend self-hosting | INCOMPLETE scope. Enterprise self-hosting is substantiated by the current pricing matrix and announcement; Enterprise **static export** is explicitly documented and omitted. Retain managed-services boundary, distinguish both outputs. |
| 159, 359 | 10,000 credits, $0.01 overage | TRUE; shared organization credits, assistant answer cost matters. Do not imply unlimited AI. |
| 255, 355 | Mintlify visual/source web editor | TRUE. |
| 265–266, 335 | Arabic locale documented; validate RTL fidelity | TRUE and appropriately qualified. |
| 270 | Analytics competitor cell only points to Enterprise “Advanced insights” | OVERSTATED implied gap. Analytics is available on Pro/Enterprise, including search and AI traffic. Keep Advanced insights distinction separately. |
| 274, 275–280, 357 | MDX portability, llms.txt, OpenAPI, Pro previews, changelog RSS | First four TRUE from docs/pricing. RSS TRUE: [official changelog guide](https://www.mintlify.com/docs/create/changelogs) describes public RSS feeds. |
| 282–283 | Real-time co-editing | TRUE, current editor/collaboration docs explicit. |
| 286–288, 317 | GitHub/GitLab/Bitbucket and Enterprise multi-repo workflows | Providers VERIFIED by deployment docs, with Bitbucket Cloud Enterprise-only. Multi-repo exact current gate remains UNVERIFIABLE from the extracted matrix; do not silently omit the Bitbucket tier. |
| 292 | Arbitrary custom components/CSS/JS | Pricing lists custom components/CSS/JS; TRUE in broad form. Runtime/security constraints should not be called literally unrestricted. |
| 297, 301–303 | Personalization/adaptive content and broad integrations/webhooks/websockets | Vendor feature categories listed; exact availability/plan breadth is UNVERIFIABLE here without category-specific docs. Do not turn “broad” into measured superiority. |
| 309, 316 | Pro assistant/agent, metered | TRUE. |
| 311 | Enterprise SSO/SCIM/organization audit logs | SSO/SCIM TRUE; audit-log detail not separately confirmed in this pass; source each conjunct. |
| 167–189, 400, 450, 467, 635, 704 | GitBook Free/Essential/Ultimate/Enterprise amounts and custom domain gate | TRUE for displayed annual-billing basis and $12 user component. Not monthly billing quotes. |
| 173, 423–425, 457 | GitHub/GitLab sync, API playground, previews on Free | TRUE pricing. |
| 186, 429, 442 | Ultimate Chat, authenticated access, adaptive content | TRUE pricing. |
| 189, 436, 444 | Enterprise SAML, custom integrations/migration/support | TRUE pricing. |
| 379, 386, 451, 457, 471, 697, 708 | GPLv3 reader renderer, not workspace | TRUE repository/license. README verifies discouragement and lack of guaranteed support; categorical “unsupported” overstates its conditional wording. |
| 389, 402 | GitBook block editor; paid per-user component | TRUE pricing. |
| 406–410, 479 | No verified comprehensive GitBook Arabic RTL guarantee | Appropriate unknown, not a feature absence; UI localization and language variants VERIFIED. |
| 411–412 | Views on every plan; search/feedback Essential | TRUE pricing. |
| 415–417 | llms/full Markdown/MCP | Pricing and MCP docs support AI-ready export/MCP; per-page Markdown exposed by official docs. TRUE; clarify Page actions must remain enabled for MCP. |
| 434, 443, 463 | Ask from Essential, Chat Ultimate; managed AI alternative | TRUE plan facts; “ahead on AI features” is subjective/STALE unless scoped to actual differences after #279. |
| 495, 500, 576–577, 611 | Docusaurus MIT, free, static MDX/React, versioning/i18n | TRUE. Documentation CC-BY-4.0 was not separately re-fetched: source that extra license if retained. |
| 504, 509, 514, 533, 547–548 | Code authoring, operator hosting/custom domain/build/Git pipeline | TRUE typical core workflow; “Node build on every deploy” overstates deployment mechanics when redeploying already built output. |
| 521, 526, 531, 534, 538, 543, 557 | Search integrations, RTL, versioning, BYO analytics, code control, community OpenAPI | Core docs substantiate search/RTL/versioning/React; exact OpenAPI plugin compatibility not checked. Mark plugin-specific promise UNVERIFIABLE pending its official docs. |
| 619 | Starlight Astro theme, Markdown/Markdoc/MDX, search/i18n/dark | TRUE [official site](https://starlight.astro.build/) (2026-11-07). “Fast/minimal setup” subjective, not a measured performance fact. |
| 627 | Scalar OpenAPI/AsyncAPI, Markdown/MDX, two-way Git, OSS client/hosted | TRUE: [official repo](https://github.com/scalar/scalar) and [current homepage](https://scalar.com/) (2026-11-07) explicitly describe OpenAPI/AsyncAPI, Markdown/MDX, two-way Git, and hosted products. This source reports support; no sync workflow was exercised. |
| 200–208, 739 | ReadMe Starter/Pro/Enterprise prices, versions/domain/sync/features | TRUE for explicit pricing cards/text; “Ask AI is separate $150” is incomplete: Lite is included on Pro/Enterprise. |

No Fumadocs-specific row exists in `comparison-data.ts`; its stale facts are in the open-source-tools blog EN/AR (`:55/:52`, `:76/:73`). Add its current framework/editor/search facts above if new comparisons use it.

## Arabic platform reconciliation

All `marketing_arabicseo_platform_*` values are identical between `en.json` and `ar.json` on main, including Arabic prose; the Arabic page forces Arabic translation (`apps/app/src/components/marketing/arabic-seo.tsx:25–27`). These aren't translations that independently diverge; they are duplicate Arabic datasets. Lines below apply to **both** catalogs.

| Catalog location | Assertion | Verdict / replacement fact |
|---|---|---|
| 2564–2565, 2567 | Mintlify managed/editor/API/AI; Starter/Pro $450 annual/Enterprise | TRUE pricing; 30 October date is historical, use fresh 7 November access date if revising. |
| 2566 | Arabic + automatic Arabic/Hebrew RTL | Arabic TRUE; automatic layout guarantee UNVERIFIABLE from current official pages. Say documented Arabic localization; test direction/layout. |
| 2568 | Enterprise frontend-only self-hosting | INCOMPLETE scope; Enterprise self-hosting is documented, but static export is also available by request. Separate it from the headless frontend. |
| 2569–2570, 2572 | GitBook block editor/GitHub/GitLab/previews/API and paid AI; annual price | TRUE current pricing/Git docs. |
| 2571, 2573 | GitBook localization/variants but no full RTL promise; test blocks | TRUE/appropriately qualified. |
| 2574–2578 | Docusaurus React static/MIT, RTL/hreflang, code workflow | TRUE docs/license. “Usually needs Git” is typical workflow, not an absolute prohibition on external CMS editors. |
| 2579–2583 | Material for MkDocs/Python/Markdown; Arabic, separate per-language sites/selector; team-operated | Supported [language/direction guide](https://squidfunk.github.io/mkdocs-material/setup/changing-the-language/) (2026-11-07). “All multilingual use must be separate projects” would overstate it: integrations/plugins exist; wording is a recommended approach. |
| 2584–2585, 2587–2588 | Apidog design/debug/mock/test/docs managed product, API-first fit, check own pricing | Supported [official Arabic article](https://apidog.com/ar/blog/documentation-tools-ar/) (2026-11-07); no exact price claimed. |
| 2586 | Many Arabic pages give clear prominence in Arabic search results | OVERSTATED/UNSOURCED. One official Arabic page proves Arabic editorial content, not SERP visibility or prominence. No search ranking study was performed. |
| 2563 (Nibleaf) | No integrated AI assistant | FALSE after #279; see F1 in facts.md. |
| 2591 | Mintlify stronger on managed AI / GitBook enterprise maturity | Subjective; if kept, name concrete plan/workflow differences. Nibleaf now has a reader assistant and support MCP; absence is no longer a valid rationale. |
| 2592 | All sources reviewed 22 August while prices say 30 October | Internally STALE evidence date. Do not imply this audit's 7 November access happened in August. |

`documentation-platforms.tsx:4–61` mostly uses qualified workflow advice rather than false absences. Its Mintlify/GitBook links redirect to new canonical documentation paths; refresh links and include the actual current facts instead of implying a localization gap.

## Facts that remain unknown

- End-to-end Arabic/RTL editor/reader fidelity for paid competitor accounts; number of complete locale strings; exact accessibility quality.
- Unpublished enterprise prices/discounts, monthly GitBook/ReadMe prices, contract-specific entitlements.
- Full-platform self-host license/availability for managed vendors beyond the explicitly documented output options.
- Mintlify's exact multi-repository gate and any icon-only audit-log entitlement; GitHub/GitLab/Bitbucket and public RSS are documented.
- ReadMe AI Discoverability/MCP-metrics exact plan matrix; precise human AI-referrer report behavior.
- Fumadocs built-in managed owner analytics or complete Arabic promise; Docusaurus first-party hosted AI/MCP plans.

None of these unknowns justify a negative competitor checkbox. MCP, AI chat, visual editing, Arabic locales, Markdown and domains by themselves are not verified exclusive differentiators.
