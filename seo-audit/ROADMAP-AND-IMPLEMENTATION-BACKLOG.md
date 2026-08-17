# Nibleaf SEO roadmap and implementation backlog

Date: 2026-08-17. Owners are roles, not assumed people. Traffic, conversion, rank, index, backlink, field-CWV, and AI-citation targets remain relative until trustworthy baselines are connected.

## Days 0–30: foundation and high-confidence wins

| Workstream | Action | Owner | Dependency | KPI / done condition |
|---|---|---|---|---|
| Release safety | Ship the factual, schema, metadata-manifest, and sitemap fixes in this change | Web/platform engineer | CI and review | 135/135 tests pass; dependency-aware build passes; screenshots reviewed |
| Measurement | Connect GSC and analytics; define signup, pricing, cloud, self-hosting, and contact events | Growth/analytics | Google property and analytics credentials | ≥95% of primary CTAs emit validated events; sitemap submitted |
| Drift | Retain the crawl/schema/metadata baseline and document the Windows script workaround | SEO lead + engineer | Stable production URL | Monthly baseline comparison is runnable and owned |
| Performance | Trace LCP element/subparts and reduce the largest global JS/CSS blockers | Web/platform engineer | Bundle/trace access | Representative median mobile lab LCP ≤3.0s first; CLS ≤0.1; TBT <200ms |
| Commercial depth | Expand `/cloud`, `/self-hosting`, `/about`, and `/blog` around evidence-backed user questions | Product marketer + SME | Verified product facts | Each passes an intent/accuracy rubric ≥80; no filler |
| Product proof | Add real editor, publishing, search, RTL, and deployment visuals | Design + engineer | Current approved UI | Five priority commercial pages have responsive, dimensioned, accurate media |
| Internal links | Implement pillar → spoke → sibling → commercial-next-step rules | SEO/content engineer | Final cluster map | Zero orphans; every priority page meets the link rule |
| SXO/accessibility | Validate mobile CTA visibility, keyboard use, touch targets, form errors, and table behavior | UX/design + engineer | Browser environment | No Critical defect; primary action reachable in ≤2 steps |
| Accuracy governance | Create a quarterly claim ledger: claim, source URL, checked date, owner | Product marketer | Official sources | 100% of material comparison claims have current first-party evidence |

## Days 31–60: commercial expansion and authority

| Workstream | Action | Owner | Dependency | KPI / done condition |
|---|---|---|---|---|
| Existing comparisons | Expand all six pages with current sources, workflows, migration, TCO, personas, and limitations | Product marketer + SME | Publication gate | Six pages ≥1,500 substantive words and ≥80% material-claim source coverage |
| Editorial program | Publish four assets across deployment, Markdown ownership, Arabic/RTL, and platform selection | Content lead + SME | Search-intent validation | Four publish-ready assets with pillar links and conversion paths |
| Authors and trust | Add real bylines, credentials, editorial policy, methodology, and review dates | Founder/SME + content | Willing named contributors | 100% of new/updated articles have accountable author and review date |
| Original proof | Publish one customer story, migration account, or reproducible technical benchmark | Founder/CS/DevRel | Consent or public method | One citable original-evidence asset |
| Link acquisition | Verify prospects across OSS showcases, communities, partners, and newsletters | DevRel/growth | Linkable asset and backlink baseline | 30 qualified prospects; no bought/automated links |
| GEO | Extend `llms.txt`/full with GitHub, docs, security/limitations, license/AI-use policy, and review date | SEO lead + engineer | Truthful destination pages | GEO readiness ≥75; all links resolve and agree with visible content |
| Social assets | Create page-specific OG art for six commercial pages and four top articles | Design | Approved visual system | Ten unique cards, 1200×630, compressed and meaningful |
| Funnel review | Analyze first clean 28-day organic journeys and repair broken transitions | Growth/UX | Valid analytics events | Funnel baseline documented; no untracked primary step |

## Days 61–90: validated scale and earned authority

| Workstream | Action | Owner | Dependency | KPI / done condition |
|---|---|---|---|---|
| New commercial pages | Publish only validated ReadMe, Starlight, Material/Zensical, Fern, or Arabic opportunities | SEO/content + SME | GSC/SERP evidence and publication gate | Two to four unique pages; no cannibalization or template failure |
| Original research | Publish RTL/search, ownership/TCO, or self-hosting operations dataset | DevRel/engineering + content | Reproducible methodology | One inspectable/downloadable report or test suite |
| Earned authority | Personalized outreach around research, OSS, and real community value | DevRel/growth | Qualified list and asset | Five new verified topically relevant referring domains initially |
| AI visibility | Establish a fixed 20-prompt monthly set across accessible AI-search systems | SEO lead | Manual or approved monitoring | Mention/citation baseline with URLs and screenshots |
| Performance | Re-test all major templates and resolve remaining JS/CSS/image bottlenecks | Web/platform engineer | Released content/media | Representative mobile lab LCP ≤2.5s; Lighthouse ≥90 where feasible |
| Refresh loop | Update early cluster assets from query and assisted-action evidence | SEO/content | ≥28 days of data | ≥50% of priority pages improve impressions, qualified clicks, or assisted actions |
| Drift operations | Assign and resolve monthly metadata/schema/link/performance regressions | SEO lead + engineer | Stable baseline | No unresolved Critical drift beyond one release cycle |

## KPI framework

| KPI | Baseline | 3 months | 6 months | 12 months | Source |
|---|---:|---:|---:|---:|---|
| Corrected SEO health | 81 | ≥86 | ≥90 | ≥92 | Same audit rubric |
| Crawl eligibility | 22/22 | Maintain 100% | Maintain | Maintain | Deterministic crawl |
| Google index coverage | Unknown | Establish; target ≥95% eligible once connected | ≥95% | ≥97% | GSC |
| Mobile lab LCP | 3.375–4.407s | ≤2.5s median | ≤2.5s key templates | No regression >10% | Lighthouse |
| Field CWV | Unavailable | Establish if sufficient data | ≥90% Good if measurable | ≥95% if measurable | CrUX/GSC |
| Content quality | 78 | ≥84 | ≥88 | ≥90 | Same content rubric |
| E-E-A-T authority | 9/25 | ≥14 | ≥18 | ≥21 | Evidence rubric |
| GEO readiness | 68 | ≥75 | ≥82 | ≥88 | Same GEO rubric |
| Observed AI citation share | Unknown | Establish 20-prompt baseline | ≥35% eligible prompts | ≥50% | Fixed prompt set |
| Relevant referring domains | Unknown | Establish and earn 3–5 | Baseline +15 | Baseline +35 | Moz/Bing/verified crawler |
| Organic sessions | Unknown | Establish clean baseline | +25% relative | +75% relative | Analytics |
| Organic primary-action rate | Unknown | Establish with ≥95% event coverage | +15% relative | +30% relative | Analytics |
| Commercial query visibility | Unknown | Baseline query set | ≥50% improve; three top 20 | Six top 10 | GSC + rank source |
| Priority-page media | 0 content images | Five core pages | All commercial + top ten articles | ≥90% priority landing sessions receive relevant media | Crawl + analytics |
| Comparison freshness | No ledger | 100% sourced/dated | Reviewed within 90 days | Maintain quarterly | Claim ledger |

These are planning targets, not forecasts. Reforecast after the first trustworthy 90-day dataset.

## Critical backlog

| Item | Owner | Dependency / risk |
|---|---|---|
| Connect GSC and analytics; validate conversion events | Growth/analytics | Credentials unavailable; index/traffic/conversion claims remain prohibited |
| Release the verified factual/schema fixes | Web engineer | Review-ready PR, passing CI, screenshot evidence |
| Preserve 100% crawl/canonical/sitemap/hreflang eligibility | Web engineer | Any regression blocks release |
| Establish durable crawl, schema, performance, and drift baselines | SEO lead + engineer | Identical test settings required |
| Assign an accountable owner to every roadmap item and competitor claim | Marketing lead | Undefined ownership blocks delivery |

## High backlog

| Item | Owner | Dependency / risk |
|---|---|---|
| Reduce homepage, self-hosting, and article mobile LCP | Web engineer | Do not trade for CLS/accessibility regressions |
| Deepen `/cloud`, `/self-hosting`, `/about`, `/blog` | Product marketer + SME | Add decisions, proof, and limits—not word-count filler |
| Bring six commercial pages through the source/depth gate | Product marketer + SME | Remove unverifiable claims |
| Add current real product screenshots and responsive delivery | Design + engineer | Product state must match media |
| Add named authors, methodology, editorial policy, and proof | Founder/SME + content | Never fabricate credentials or customers |
| Implement hub/spoke internal links and contextual CTAs | SEO/content engineer | Avoid repetitive exact-match anchors |
| Publish RTL/search benchmark and self-hosted operations kit | DevRel/engineering + content | Reproducible data and limitations |
| Launch ethical link acquisition through OSS/community value | DevRel/growth | No paid, automated, or irrelevant links |
| Establish fixed AI-citation monitoring | SEO lead | Keep readiness score separate from observed visibility |

## Medium backlog

| Item | Owner | Dependency / risk |
|---|---|---|
| Publish validated Markdown, deployment, Arabic, and GEO spokes | Content lead | SERP/GSC validation required |
| Create priority page-specific OG assets | Design | Favor pages with impressions/commercial intent |
| Add one original benchmark per quarter | DevRel/engineering | Methodology must be inspectable |
| Run quarterly pricing/claim reviews | Product marketer | Checked date and source are mandatory |
| Test CTA copy/layout when traffic supports inference | Growth/UX | Use qualitative testing when samples are small |
| Add explicit truthful author/publisher configuration to tenant docs | Product/platform | Do not infer entity type from project name |

## Low / conditional backlog

| Item | Owner | Dependency / risk |
|---|---|---|
| Programmatically expand comparisons | SEO + engineering | Blocked until uniqueness, sourcing, and cannibalization gates pass |
| Add `/security`, `/customers`, or solution hubs | Product marketing | Only when real evidence and user need exist |
| Generate decorative AI art | Design | Real product evidence has higher priority; image-gen extension unavailable |
| Local/maps workflows | None | Inapplicable without a physical-location objective |
| Ecommerce workflows | None | Inapplicable without catalog/transaction pages |
| Paid SEO providers | SEO lead | Optional; currently unavailable |

## Release and publication gates

1. Intent and conversion role are documented.
2. Title, description, H1, canonical, hreflang, indexability, sitemap, and internal links pass deterministic checks.
3. Material product and competitor claims have current primary sources or reproducible first-party evidence.
4. Visible content and JSON-LD agree; no invented author, organization, rating, price, customer, or benchmark.
5. Page has an accountable owner, review date, useful internal links, and intentional next action.
6. Mobile layout, keyboard use, contrast, target size, forms, and scroll containers pass.
7. Media is relevant, responsive, dimensioned, compressed, and accurately described.
8. Tests/build pass; no automatic Docker image build runs on `pull_request`.
9. CLS ≤0.1, TBT <200ms, and no LCP regression >10%.
10. User-visible changes have screenshots; video is required only for meaningful interaction/motion.

Comparison/programmatic pages additionally require ≥1,500 substantive words, ≥80% material-claim source coverage, three competitor-specific decision sections, and manual review when similarity exceeds 40%.

## Stop conditions

- Stop release on crawl/index eligibility regression, structured-data errors, failing tests/build, or material accessibility/performance regression.
- Stop programmatic expansion on cannibalization, similarity-gate failure, or lack of unique evidence.
- Do not report index, traffic, ranking, conversion, backlink, field-CWV, or AI-citation improvement while its measurement source is unavailable.
- Do not publish an unverified competitor claim.
- Do not declare an experiment winner without a predetermined sample; use qualitative evidence when traffic is insufficient.
- Review zero-impression/no-assisted-action pages after 90 days for intent mismatch or consolidation; never delete automatically.
- Do not disavow links without profile-level evidence.
- Do not manufacture stars, reviews, testimonials, credentials, citations, or adoption numbers.
