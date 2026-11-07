# Marketing site audit — 2026-11-07 (main @ ed15240e)

Method: production build served locally behind a brotli proxy (same compression as Cloudflare in production), Playwright captures at 1440×900 and 390×844 (light + dark, EN + AR), Lighthouse 12.8 median of 3 runs (mobile default throttling + desktop preset), a bundle report from the TanStack Start manifest, and an independent claims audit against the code (`fact-check/claims-audit.md`, 41 findings; `fact-check/facts.md`; `fact-check/competitors.md`). Each persona walked the landing → pricing → compare → blog → docs path.

## Ranked findings

| # | Severity | Finding | Who it hurts | Evidence | Fix (PR) |
|---|---|---|---|---|---|
| 1 | Critical | **The landing page doesn't show what Nibleaf does today.** None of the new capabilities appear: Ask AI answers with cited sections (#279), redesigned search (#281), the support MCP (#280), docs-owner insights (#285) and the workspace AI key (#277). The hero sells "the visual Markdown alternative to Mintlify". | Support lead, docs owner | `cloud-marketing.tsx` hero, features, showcases | New hero and feature sections built on real captures (PR1) |
| 2 | Critical | **The value proposition is unclear in the first 5 seconds for a non-technical buyer.** Jargon (Markdown, MDX, SSR, JSON-LD, S3, BCP-47) and a competitor name in the H1. The problem a support team has (customers can't find answers) isn't named. | Support lead, Arabic visitor | Hero/feature copy | Plain-language hero and benefit-led sections (PR1) |
| 3 | Critical | **False or stale public claims.** The Arabic platform page says Nibleaf has *no integrated AI assistant* (`marketing_arabicseo_platform_nibleaf_caveat`). The FAQ and comparisons call v0.2.0 current, though the latest public release is v0.1.2 and launch will be v0.1.0. Pricing says "no billing code". MCP is described as read-only after #280 shipped writes. 19 severity-A claims in total. | Everyone; credibility | `claims-audit.md` §A | Rewrite (PR1 landing; PR3 comparisons, pricing and FAQ; PR4 blog) |
| 4 | High | **No real product imagery.** Every visual is a CSS mock of grey bars, and the hero "docs preview" is a wireframe. Buyers can't see the reader, chat, search or dashboard. | All | Before screenshots | Real captures, optimized AVIF/WebP plus short loops (PR1) |
| 5 | High | **Arabic visitors on phones get the slowest page.** `/ar` loads the entire 12-locale interface catalog (`react-*.js`, 2.1 MB raw / 558 KiB gzip) via `useArabicT`. Mobile Lighthouse performance 71, CLS 0.118, LCP 6.2 s. `/pricing` and `/blog` load the same catalog. | Arabic visitor (390px), SEO | Lighthouse JSON, bundle report | Marketing copy in per-language TS modules; no `@nibleaf/i18n/react` on marketing pages (PR1 landing; PR3 pricing; PR4 blog) |
| 6 | High | **Arabic is a second-class page.** `/ar` has a different, thinner structure: no product visuals, no theme toggle, a mixed-language mobile menu, links to English-only pricing, and a five-line H1 at 390px. | Arabic visitor | `ar-mobile-light.png` | One bilingual shell and landing mirrored in RTL (PR1) |
| 7 | High | **Marketing code ships to every published docs reader.** `cloud-marketing`, `marketing-seo`, `marketing-faqs`, `blog` and `comparison-loader` sit in the root preload of `public-docs` (383.73 of 383.79 KiB budget). | Docs readers' performance | Start manifest probe | Audit thread's #295 (383.79 → 352.57 KiB); this work keeps the rule |
| 8 | High | **Unsourced comparison on the landing page.** The "Other SaaS" table claims competitors lack open source, self-hosting, data ownership, RTL and no-per-seat pricing as a group. That's false for GitBook (GPL reader), Docusaurus (MIT, RTL) and others. | Developer comparing tools | `claims-audit.md` A05 | Replace with links to sourced, dated comparison pages (PR1); refresh comparison facts (PR3) |
| 9 | Medium | **No use-case pages.** A support lead or API owner has no page that speaks to their job. There's only a blog post on support knowledge bases. | Support lead, developer | Route inventory | `/use-cases/support-teams`, `/product-docs`, `/api-docs` in EN + AR (PR2) |
| 10 | Medium | **Competing CTAs and weak trust signals.** The hero carries three equal CTAs (start, GitHub stars "9", self-host guide). The trust strip says "Beta" and "12 locales… some strings still in English". Real, verifiable proof goes unused: the AGPL source, the self-hosting installer, and Nibleaf's own docs published with Nibleaf. | All | Hero, trust strip | One primary + one secondary CTA, a docs link, a proof strip of verifiable facts (PR1) |
| 11 | Medium | **Blog teaser mixes languages.** The English home shows an Arabic post card (RTL text inside an LTR grid). | EN and AR visitors | `home-desktop-light.png` | Language-filtered teaser (PR1) |
| 12 | Medium | **Mobile LCP is slow on every marketing page** (4.2–7.1 s on simulated 4G, brotli). The LCP element is hero text, delayed by render-blocking CSS/JS. | Phone visitors, SEO | Lighthouse | Lighter landing, no full catalog, priority hints, measured after (PR1/PR4) |
| 13 | Medium | **SEO gaps.** Every page uses one generic OG card. hreflang appears only on `/` ↔ `/ar`. No per-page OG images. `label-content-name-mismatch` on the GitHub star links. Marketing HTML is served `no-store`, so pages can't use the back/forward cache. | SEO, social sharing | Lighthouse, `marketing-seo.ts` | OG images and hreflang (PR1/PR2/PR4); report `no-store` to the server owner |
| 14 | Low | **Long page.** The English landing is ~13,900 px tall at 390px, with a duplicated "how it works", "two ways to run it" and comparison. | Phone visitors | Full-page capture | Tighter structure (PR1) |
| 15 | Low | **Navigation clutter.** Seven top-level links, including the niche "RTL grader". The footer lacks the new capabilities. | All | Header | ≤ 5 nav links; RTL grader stays in the footer (PR1) |

## Persona notes

- **Non-technical support lead.** Leaves without learning that readers can ask questions and get cited answers, or that failed searches are surfaced. "Markdown", "MDX" and "SSR" read as engineering tools. Pricing is clear that the cloud is free during beta, but can't answer "what does the AI cost me?".
- **Technical docs owner.** Finds versioning and self-hosting, but nothing about insights, AI visibility, exports, Git sync or private docs on the landing page. The FAQ answer on search references Qdrant shadow mode and v0.2.0.
- **Developer comparing against Mintlify.** `/compare/nibleaf-vs-mintlify` exists and cites sources, but its AI/MCP rows predate #279/#280. There's no API-docs page, and `/developers` is good but hidden.
- **Arabic visitor, 390px.** Slowest page on the site. Thinner content. The mobile menu mixes Arabic labels with English destinations. The Arabic platform comparison carries the false "no AI assistant" caveat.

## Baseline numbers (before)

Lighthouse, brotli, median of 3 (performance / accessibility / best practices / SEO; LCP):

| Page | Mobile | Desktop |
|---|---|---|
| `/` | 81 / 100 / 93 / 100; LCP 5.1 s | 97 / 100 / 93 / 100; LCP 1.3 s |
| `/ar` | 71 / 100 / 93 / 100; LCP 6.2 s; CLS 0.118 | 95 / 100 / 93 / 100 |
| `/pricing` | 83 / 100 / 93 / 100; LCP 4.2 s | 88 / 100 / 93 / 100 |
| `/compare/nibleaf-vs-mintlify` | 80 / 100 / 93 / 100; LCP 5.3 s | 85 / 100 / 93 / 100 |
| `/blog` | 72 / 100 / 93 / 100; LCP 7.1 s | 91 / 100 / 93 / 100 |

Best practices is 93 locally because of two 502s from API calls with no local API running. Production has the API, so re-measure there before quoting.
