# Nibleaf SEO audit — 2026-08-17

Scope: the public marketing site at `https://nibleaf.com`, its 22 sitemap URLs, repository implementation, and current competitive search landscape. Evidence was collected fresh because `.seo-cache/` was absent at the start of the audit.

## Executive baseline

**Corrected SEO health score: 81/100.** Nibleaf has a strong technical base. The main constraints are mobile LCP, weak external authority and named proof, shallow commercial pages, generic media, and commercial comparison pages that need deeper source coverage.

| Dimension | Score | Evidence |
|---|---:|---|
| Technical SEO | 87 | 22/22 sitemap URLs return 200, self-canonicalize, render server-side, contain one H1, and have internal inlinks |
| Content quality | 78 | Strong technical articles; `/cloud`, `/self-hosting`, `/about`, and `/blog` are shallow |
| On-page | 96 | Unique titles/descriptions, one H1, complete social metadata, and clean internal URLs on all 22 pages |
| Structured data | 88 | Valid JSON-LD and strong breadcrumbs/articles; inaccurate tenant Organization inference was found and fixed |
| Performance | 62 | Mobile Lighthouse lab LCP is 3.375–4.407s; field CWV is unavailable |
| GEO/AI readiness | 68 | SSR, `llms.txt`, Markdown endpoints, and good structure; weak original proof and off-site authority |
| Images/media | 58 | Excellent 1200×630 OG assets, but zero content `<img>` elements across the audited corpus |

The weighted score uses the SEO router weights: technical 22%, content 23%, on-page 20%, schema 10%, performance 10%, GEO 10%, and images 5%. The automated runner returned 82/100, which corroborates the overall range, but its two canonical mismatches were false positives and its inferred interaction metric is not valid field INP evidence.

## What is already strong

- All 22 sitemap URLs return 200, have exact self-canonicals, unique titles and descriptions, one H1, SSR body content, and no accidental `noindex`.
- Every sitemap page has an inbound link; maximum crawl depth from the homepage is two.
- All 26 same-origin link targets resolve directly to 200 without redirects.
- `robots.txt` references the sitemap and excludes application/auth/API routes while allowing public marketing and AI search crawlers through the wildcard policy.
- `llms.txt` and `llms-full.txt` are unusually complete and machine-readable.
- HTTPS redirects, apex consolidation, slash normalization, security headers, CSP nonces, and a real 404 all work.
- The English/Arabic article pair has reciprocal `en`, `ar`, and `x-default`, exact canonicals, `lang`, `dir`, OG locale, and JSON-LD language signals.
- Desktop and mobile landing-page hierarchy is clear; the cloud and self-hosting CTAs remain visible and comparison tables are contained in horizontal scrollers on mobile.

## Highest-priority risks

### High

1. **Mobile LCP:** real Lighthouse 13.3 mobile lab runs measured 4.105s on `/`, 3.375s on `/self-hosting`, and 4.407s on the open-source-tools article. CLS is 0 and TBT is 0–9ms, so the focus should be the LCP resource path, global CSS, and shared JavaScript.
2. **Competitive accuracy and sourcing:** Mintlify now documents Arabic/RTL and an Enterprise custom self-hosted frontend; GitBook documents `llms.txt`, `llms-full.txt`, Markdown URLs, MCP, and limited RTL authoring; ReadMe currently shows Enterprise as contact sales. The affected source claims were corrected in this change.
3. **Commercial depth:** all six comparison/alternatives pages are below the specialist 1,500-word publication gate and material feature rows do not yet meet the 80% primary-source-coverage gate.
4. **Authority:** the E-E-A-T score is 66 and authority is only 9/25. There are no named authors, customer stories, original datasets, or demonstrated third-party recognition.
5. **Product evidence:** the site has no content images. Real editor, publishing, RTL, search, and deployment screenshots would improve trust, SXO, image search, and AI citation context.

### Medium

- `/cloud` (312 words), `/self-hosting` (348), `/about` (307), and `/blog` (345) do not answer enough decision-stage questions.
- The three alternatives pages share roughly 36.5–36.9% five-gram overlap. They need competitor-specific migration, scenarios, and evidence—not cosmetic rewriting.
- The shared client bundle is about 182KB gzip/562KB raw and global CSS about 29KB gzip/189KB raw; Lighthouse estimated 470–490ms render-blocking savings and 80–99KiB unused JavaScript.
- `llms.txt` should link GitHub, documentation, security/limitations, license/AI-use policy, and a review date.
- Legal pages do not fully identify the operator/controller, address, governing law, retention periods, or jurisdiction-specific rights.

## Page-by-page review

| Route | Approx. words | Assessment | Priority action |
|---|---:|---|---|
| `/` | 1,126 | Strong differentiated hero and two conversion paths; thin proof/media | Add real product proof; improve LCP; preserve category/brand ownership |
| `/cloud` | 312 | Clear but thin and overlaps the homepage | Add service boundaries, backups, data residency, support, fair use, and migration guidance |
| `/pricing` | 587 | Clear beta disclosure and conversion | Add fair-use boundaries and post-beta expectations when known |
| `/self-hosting` | 348 | Concrete product-specific deployment page, but too shallow for decision intent | Add requirements, architecture, backups, upgrades, rollback, security, and known limits |
| `/about` | 307 | Mission is clear; no named maintainers, credentials, legal entity, or recognition | Add truthful people/entity details and evidence |
| `/contact` | 325 | Strong role-based inboxes and ContactPage schema | Add response expectations and legal operator identity |
| `/blog` | 345 | Useful index; lacks topic hubs and editorial scope | Add cluster navigation and editorial methodology |
| `/compare/nibleaf-vs-mintlify` | 1,015–1,107 | Strong disclosure and conversion; current claims corrected | Expand source coverage, workflows, migration, and personas to 1,500+ substantive words |
| `/compare/nibleaf-vs-gitbook` | 1,133–1,247 | Most accurate current comparison; renderer distinction is strong | Cite every material row and document GitBook's LLM/RTL behavior |
| `/compare/nibleaf-vs-docusaurus` | 971–1,060 | Useful platform-vs-generator framing | Add official citations and workflow/TCO evidence |
| `/alternatives/mintlify` | 796–884 | Correct intent and candid disclosure | Expand evaluation method, migration, and best-for/not-for sections |
| `/alternatives/gitbook` | 830–929 | Correct renderer/full-workspace distinction | Add RTL/LLM evidence, migration path, and persona scenarios |
| `/alternatives/readme` | 756–849 | Honest API-tooling concession | Add on-premise qualification, API evaluation criteria, and custom Enterprise pricing |
| `/blog/arabic-technical-documentation-rtl-checklist` | 1,471 | Excellent original detail and Arabic implementation value | Add reproducible screenshots/benchmark; maintain reciprocal localization |
| `/blog/gitbook-vs-mintlify` | 1,666 | Best-sourced article; clear evaluation script | Updated self-host/RTL claims; keep current with quarterly source review |
| `/blog/arabic-documentation-rtl` | 1,431 | Strong technical specificity and primary sources | Add diagrams/screenshots and tokenization test evidence |
| `/blog/docs-should-live-in-plain-markdown` | 1,820 | Strong ownership position | Corrected Mintlify and migration claims; add source matrix and real round-trip examples |
| `/blog/introducing-nibleaf-open-source-mintlify-alternative` | 1,504 | Concrete product story and limitations | Corrected hosted-only claims and added first-party links |
| `/blog/open-source-documentation-tools` | 1,766 | Useful decision framework; currently visible for high-value queries | Replace unsupported superlatives, cite each tool, and expand carefully without changing query ownership |
| `/blog/self-host-documentation-site-docker-compose` | 1,510 | Strong operations article | Add architecture/config visuals and more primary operational references |
| `/terms` | 516 | Visible update date and ownership terms | Add operator identity, address, governing law, and jurisdiction |
| `/privacy` | 432 | Good subprocessor/EU/cookie/deletion disclosure | Add controller identity, retention periods, address, and rights detail |

Word counts vary slightly by parser boundary; conclusions do not depend on the difference.

## Performance evidence

| URL | Lighthouse performance | LCP | CLS | TBT | TTFB |
|---|---:|---:|---:|---:|---:|
| `/` | 77 | 4.105s | 0 | 2ms | 102ms |
| `/self-hosting` | 85 | 3.375s | 0 | 0ms | 80ms |
| `/blog/open-source-documentation-tools` | 73 | 4.407s | 0 | 9ms | 102ms |

These are lab-only measurements. PageSpeed/CrUX field data was unavailable: no Google credentials were configured and anonymous PSI returned HTTP 429. Do not report field LCP or INP from this audit.

## Structured-data and international findings

- Complete Article JSON-LD was accompanied by partial BlogPosting microdata; the partial layer was removed so one complete graph remains.
- Homepage markup now uses the more specific `WebApplication`, a numeric `offers.price`, `/pricing` as the offer URL, stable entity IDs, GitHub `sameAs`, and a truthful support contact.
- Do not add ratings or reviews merely to qualify for Google's software-app result.
- The published-docs template inferred each project name as an Organization author/publisher. Live `docs.nibleaf.com` therefore claimed an Organization named “Documentation.” The inferred entity was removed; explicit truthful authorship can be designed later.
- Existing commercial `FAQPage` markup is not generally eligible for Google FAQ rich results. Retain it only for visible semantic Q&A and non-Google/AI comprehension.
- The EN/AR hreflang implementation passes self, return, canonical, HTTPS, and `x-default` checks. H2 structure differs 7 vs 9, which is an editorial parity note rather than a technical error.
- The bundled hreflang analyzer sampled only the first 12 sitemap URLs and incorrectly reported “single locale.” Exact article HTML and the specialist graph audit are the authoritative result.

## Programmatic and drift findings

- The programmatic script scored the current footprint 92/100 with limited scale and no major scaled-content risk. It sampled the blog well but did not classify `/compare/*` and `/alternatives/*` as template families.
- Manual content analysis found 36.5–36.9% overlap among alternatives pages. Scale is currently low, but future programmatic publishing is blocked until pages offer unique evidence, intent, and source coverage.
- A first homepage drift baseline was stored on 2026-08-17: title, description, canonical, H1, 10 H2s, 18 H3s, one JSON-LD graph, 11 OG tags, status 200. CWV was intentionally skipped.
- The upstream drift script hardcodes `/dev/stdout` and also hits Windows code-page encoding; a local UTF-8 compatibility copy was used to create the baseline. This is a tooling portability issue, not a site issue.

## Full 26-command applicability matrix

| Specialist | Status | Result / blocker |
|---|---|---|
| `/seo audit` | Applied | Fresh 22-URL crawl, repository inspection, live research, visual and lab performance evidence |
| `/seo page` | Applied | All 22 public sitemap routes reviewed; page table above |
| `/seo technical` | Applied | 87/100; crawl/index/security/SSR strong; mobile LCP High |
| `/seo content` | Applied | 78/100; E-E-A-T 66; shallow commercial pages and authority gaps |
| `/seo schema` | Applied | Composite 88; three high-confidence schema fixes implemented |
| `/seo images` | Applied | OG technically strong; content-media richness 58 with zero `<img>` elements |
| `/seo sitemap` | Applied | 22/22 valid, 200, indexable, exact self-canonical; lastmod updated for material changes |
| `/seo geo` | Applied | 68/100 readiness; strong SSR/llms foundation, weak external authority/original evidence |
| `/seo performance` | Applied | Three real mobile Lighthouse runs; field data unavailable |
| `/seo visual` | Applied | Desktop, laptop, tablet, mobile live capture plus local 1440×900 and 390×844 verification |
| `/seo plan` | Applied | 30/60/90 roadmap and KPI framework delivered separately |
| `/seo programmatic` | Applied | Limited footprint; manual comparison-template overlap overrides script blind spot |
| `/seo competitor-pages` | Applied | Eight named competitors plus adjacent platforms researched with first-party sources |
| `/seo hreflang` | Applied | Exact EN/AR pair passes; generic script's sampling false negative documented |
| `/seo local` | Inapplicable | SaaS product has no physical-location or service-area search objective |
| `/seo maps` | Inapplicable | No GBP/maps intent; DataForSEO Maps tool also unavailable |
| `/seo google` | Blocked | Credential tier -1: no GSC, GA4, PSI, CrUX, or Indexing API access |
| `/seo backlinks` | Partially applied | Moz/Bing unavailable; Common Crawl timed out; backlink health remains **INSUFFICIENT DATA** |
| `/seo cluster` | Applied | 48 non-navigational queries, five clusters, manual SERP overlap and internal-link map |
| `/seo sxo` | Applied | Four live query sets, route/intent mapping, persona scores, mobile/conversion review |
| `/seo drift` | Applied with workaround | First baseline captured; upstream Windows `/dev/stdout` bug documented |
| `/seo ecommerce` | Inapplicable | No catalog, product-feed, Shopping, or transaction-page footprint |
| `/seo firecrawl` | Blocked / fallback used | Extension/MCP server unavailable; deterministic 22-URL crawl substituted |
| `/seo dataforseo` | Blocked / fallback used | Extension/MCP server and credentials unavailable; live web SERPs used without volume claims |
| `/seo image-gen` | Planning applied; generation deferred | OGs are sound and real product screenshots are higher value; Banana extension unavailable |
| `/seo flow` | Applied | Find/Leverage/Optimize/Win used for evidence, differentiation, implementation, and measurement; local stage inapplicable |

FLOW framework attribution: Framework and prompts © Daniel Agrici, CC BY 4.0 — [github.com/AgriciDaniel/flow](https://github.com/AgriciDaniel/flow).

## Credential and evidence blockers

- Google auth check: tier -1; GSC, GA4, PSI/CrUX, Indexing API, and verified index coverage unavailable.
- Backlinks auth check: tier 0 only; Moz and Bing Webmaster Tools unavailable. The Common Crawl graph request produced no result before timeout.
- DataForSEO and Firecrawl MCP servers/extensions were not installed or callable.
- No verified keyword volume, CPC, paid difficulty, backlink count, organic traffic, conversion, field CWV, or observed AI citation-share claims are made.
- Premium PDF generation was unavailable because the local WeasyPrint GTK runtime lacked `libgobject-2.0-0`; the Markdown reports are the durable deliverable.

## Implemented safe fixes

1. Corrected stale Mintlify, GitBook, ReadMe, self-hosting, RTL, LLM/MCP, and pricing claims using current official sources.
2. Replaced unsupported comparison superlatives and the “near zero” Markdown migration claim with conditional language.
3. Removed partial BlogPosting microdata while retaining complete Article JSON-LD.
4. Removed inferred tenant Organization authors/publishers from published-doc TechArticle markup.
5. Improved homepage entity JSON-LD with `WebApplication`, numeric price, pricing URL, GitHub `sameAs`, stable IDs, and support contact.
6. Removed the unused deprecated HowTo helper.
7. Updated article metadata manifests and sitemap lastmod values for material changes.
8. Added regression tests for marketing entity/offer markup and false tenant authorship.
9. Converted the pre-existing automatic Docker image workflow to explicit `workflow_dispatch` inputs so pull requests and pushes do not build images implicitly.

Verification:

- App tests: 135/135 passed.
- Dependency-aware production build: passed (`pnpm build:app`).
- Standalone app typecheck: passed after the normal `pnpm db:generate` prerequisite. Direct app-only build initially lacked `@nibleaf/server/rpc`; the repository's dependency-aware build produced the dependency and passed.
- Local Playwright desktop/mobile review: passed. A pre-existing development-only CSP nonce hydration warning was observed; the production build succeeded and the warning is unrelated to these changes.

## Primary sources used for volatile claims

- [Mintlify pricing](https://www.mintlify.com/pricing), [Mintlify internationalization/RTL](https://www.mintlify.com/docs/guides/internationalization), [Mintlify custom frontends](https://www.mintlify.com/blog/custom-frontends-on-mintlify)
- [GitBook pricing](https://www.gitbook.com/pricing), [GitBook LLM-ready docs](https://gitbook.com/docs/publishing-documentation/llm-ready-docs), [GitBook RTL help](https://gitbook.com/docs/help-center/editing-content/writing-and-editing), [GitBook renderer](https://github.com/gitbookio/gitbook)
- [ReadMe pricing](https://readme.com/pricing), [ReadMe plans](https://docs.readme.com/main/docs/plans-and-pricing)
- [Docusaurus docs](https://docusaurus.io/docs), [Starlight](https://starlight.astro.build/), [Material for MkDocs](https://squidfunk.github.io/mkdocs-material/), [Zensical](https://zensical.org/), [Fern pricing](https://buildwithfern.com/pricing), [Fumadocs](https://www.fumadocs.dev/), [Scalar](https://scalar.com/)
