# Public page coverage

Reviewed: **2026-09-11**. Canonical origin: **https://nibleaf.com**.
This is a contributor-facing inventory of reader decisions and public product evidence, not a traffic forecast or a deployment record. Paths below are canonical owners; `/blog/…-ar` pairs are real Arabic translations. English-only comparison pages do not advertise Arabic alternates.

| Type | Canonical owner(s) | Decision / action | Reason and public proof |
| --- | --- | --- | --- |
| 1. Competitor alternatives | `/alternatives/mintlify`, `/alternatives/gitbook`, `/alternatives/readme` | **Improve**: shortlist a replacement by authoring and hosting needs | Existing multi-product roundups own discovery intent. Refresh shared pricing, correct ReadMe Pro project count, clarify GitBook annual billing, retain competitor strengths. Sources below. |
| 2. Honest comparisons | `/compare/nibleaf-vs-mintlify`, `/compare/nibleaf-vs-gitbook`, `/compare/nibleaf-vs-docusaurus` | **Improve**: choose between Nibleaf and a named tool | Keep pairwise owners distinct from multi-vendor roundups. Clarify source release versus pinned image, analytics language, billing, and poor-fit cases. Proof: `apps/app/src/lib/comparison-data.ts`, `release/self-host.json`, vendor sources below. |
| 2. Honest comparisons | `/blog/gitbook-vs-mintlify` | **Keep**: compare the two hosted vendors directly | Existing editor/review/API/ownership decision with linked primary sources and annual-billing context. Do not add another landing page for the same pair. |
| 3. Real integrations | `/blog/nibleaf-integrations`, `/blog/nibleaf-integrations-ar` | **Add**: select a connection by task, direction, and availability | The existing source-release note and operator reference do not answer a buyer's connection decision. Proof: `packages/shared/src/integrations.ts`, `docs/reference/integrations-engine.mdx`, `apps/server/src/actions/integrations`, `release/self-host.json`. Catalog presence is not live provider proof. |
| 3. Real integrations | Same integration guide | **Not applicable**: individual Slack, Discord, Zapier, storage-provider landing pages | No distinct, verified end-to-end use case warrants a page per logo. Webhook lifecycle/tests do not prove automatic publish events or a marketplace application. Instance-managed services are not customer-connect buttons. |
| 4. Truthful constraints | `/self-hosting`, `/blog/open-source-documentation-tools`, `/blog/open-source-documentation-tools-ar` | **Keep**: own the full stack or choose a static generator | Existing owners distinguish full-stack operations from static hosting. Proof: `LICENSE`, `release/self-host.json`, Compose release and `scripts/self-host-release.mjs`. No new open-source keyword page. |
| 4. Truthful constraints | `/cloud`, `/pricing` | **Keep / improve pricing**: begin in a browser without a local install or credit card | Hosted authoring needs no local installer; self-hosting does. Beta is not a permanent free-tier or enterprise guarantee. Proof: sign-up route, `packages/auth`, public pricing, and `apps/app/src/components/marketing/pricing.tsx`. |
| 5. Pricing / free vs paid | `/pricing` | **Improve**: compare free beta with self-host operating costs | Remove unspecified future discounts, explain release differences, separate software fee from infrastructure/services/operator time. No paid plan invented or packaging changed. Shared FAQ keeps visible and structured answers aligned. |
| 6. Use cases | `/blog/customer-support-knowledge-base`, `/blog/customer-support-knowledge-base-ar` | **Add**: turn recurring support questions into published answers | A help-center workflow needs article selection, escalation, review, translation, and maintenance. Distinct from choosing a platform. Proof: editor in `apps/app/src/components/editor`, worker publishing, `docs/product/publishing.mdx`; explicitly excludes ticketing, CRM, and live chat. |
| 6. Use cases | `/blog/openapi-try-it-security-versioning`, `/blog/openapi-try-it-security-versioning-ar` | **Keep**: publish API references with safe try-it behavior | Existing guide owns API-docs workflow. Proof: Scalar reference components and OpenAPI domain actions, linked specification sources. No duplicate API-docs landing page. |
| 6. Use cases | `/blog/private-documentation-ai-access-verification`, `/blog/private-documentation-ai-access-verification-ar` | **Keep**: evaluate restricted documentation access | Existing guide includes negative authorization checks; not an unsupported enterprise identity claim. Proof: reader access and scoped retrieval implementation cited in guide. |
| 7. Problems | `/blog/documentation-migration-seo-cutover-lab`, `/blog/coolify-documentation-502-503-recovery` and their `-ar` pairs | **Keep**: avoid broken migration URLs or recover an unavailable docs site | Existing task-complete guides with fixtures; do not create generic problem pages that repeat them. Proof: migration fixture and recovery procedure references in each article. |
| 7. Problems | `/tools/rtl-documentation-readiness`, `/blog/arabic-technical-documentation-rtl-checklist` | **Keep**: diagnose Arabic/RTL readiness | Existing tool and practical checklist own diagnostic intent. The tool is a self-assessment, not a certification or crawling service. |
| 8. Differentiating features | `/blog/docs-should-live-in-plain-markdown`, `/blog/docs-should-live-in-plain-markdown-ar` | **Keep**: combine visual authoring with portable source | Concrete round-trip workflow and fixture. Proof: Markdown editor persistence and exports. Does not claim other tools lack Markdown. |
| 8. Differentiating features | `/blog/arabic-documentation-rtl`, `/blog/arabic-technical-documentation-rtl-checklist` | **Keep**: author and review Arabic documentation | Existing English explanation and Arabic checklist. Differentiation is the authoring/search workflow; Mintlify and Docusaurus also support RTL. |
| 8. Differentiating features | `/blog/versioned-documentation-release-lifecycle` and `-ar` pair; `/blog/documentation-templates-harbor-manuscript-signal` and `-ar` pair | **Keep**: decide publication lifecycle or template structure | Existing meaningful decisions. New source capabilities remain bounded by the source-release notice; no universal image-parity or AI-inclusion claim. |
| 9. Company size | No dedicated owner | **Not applicable**: startup/SMB/enterprise keyword pages | Team size alone does not change the verified workflow or offer. Use editorial roles, access needs, and operating responsibility in existing guides. No doorway pages, invented enterprise plan, SLA, or SAML/SCIM support. |

## Vendor references

Checked September 11, 2026. Prices are vendor-controlled and must be rechecked when editing these pages. GitBook's displayed starting prices use annual billing; ReadMe Pro is one project with unlimited published versions. Do not convert a displayed monthly equivalent into a month-to-month offer.

- [Mintlify pricing](https://www.mintlify.com/pricing), [editor](https://www.mintlify.com/docs/editor/tutorial), [internationalization](https://www.mintlify.com/docs/guides/internationalization), [custom frontend boundary](https://www.mintlify.com/blog/custom-frontends-on-mintlify).
- [GitBook pricing](https://www.gitbook.com/pricing), [published-site renderer](https://github.com/GitbookIO/gitbook).
- [ReadMe pricing](https://readme.com/pricing).
- [Docusaurus introduction](https://docusaurus.io/docs), [internationalization](https://docusaurus.io/docs/i18n/introduction).
- [Starlight](https://starlight.astro.build/), [Scalar API references](https://scalar.com/products/api-references).

## Discovery and maintenance

New articles are linked from both `/guides` and `/ar/guides` and the blog index. They inherit article canonical URLs, metadata, reciprocal translation links, sitemap dates, and Markdown representations from the existing registries. The shared marketing footer links the existing comparisons and alternatives. A crawlable hub is a discovery path, not proof of Google indexing.

When changing product capabilities or public wording:

1. Revisit the applicable rows above and preserve one canonical owner per decision. Record a reason for adding or declining a page; never require a page per category.
2. Verify the implemented path and release artifact. Distinguish optional source capabilities from an enabled Cloud workspace, current pinned image, or successful provider delivery.
3. Recheck changed competitor facts at the official source. Update the visible source date and affected sitemap `lastmod` only when reviewed or materially changed.
4. Update MDX frontmatter and `blog-manifest.ts` together. Add new guide links in `guides.ts`; only declare `translationOf` for complete reciprocal translations.
5. Run blog/guide/sitemap tests, lint, typecheck, and the app build. Review changed routes at 320px, 390px, and desktop; scroll tables and verify CTAs. Keep optional analytics quiet until opt-in.
6. Inspect the full staged diff and run secret scanning. Use sanitized public-only screenshots under `.github/assets/`; keep private analytics, credentials, browser state, and operational evidence outside this repository.
