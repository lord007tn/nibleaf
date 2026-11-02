# Page coverage visual verification

Refreshed November 2, 2026 against the local production build of this PR, after
merging current main. These assets contain public marketing content only.
They are local QA evidence, not production deployment, indexing, or traffic evidence.
The original September captures have been replaced because they showed stale
release and pricing copy.

- [English integration article, mobile](refresh-20261102/nibleaf-integrations-390.jpg)
- [Arabic support article, mobile](refresh-20261102/customer-support-knowledge-base-ar-390.jpg)
- [Guide academy, desktop](refresh-20261102/guides-1440.jpg)
- [Arabic guide academy, desktop](refresh-20261102/ar-guides-1440.jpg)
- [Integration article, desktop](refresh-20261102/blog-nibleaf-integrations-1440.jpg)
- [GitBook comparison, desktop](refresh-20261102/compare-nibleaf-vs-gitbook-1440.jpg)
- [Corrected GitBook RTL evidence boundary](refresh-20261102/compare-gitbook-rtl-1440.jpg)
- [Mintlify comparison, desktop](refresh-20261102/compare-nibleaf-vs-mintlify-1440.jpg)
- [Keyboard-scroll table region, 320px](refresh-20261102/table-keyboard-320.jpg)
- [Short keyboard-scroll capture](refresh-20261102/table-keyboard-scroll.webm)
- [Browser measurements](refresh-20261102/browser-checks.json)

The gallery also includes both new articles in each language at 390px and an
Arabic desktop view. The WebM shows actual right/left key actions in the focused
table region, captured at three frames per second. Focus remains on the region.

Browser checks covered four new articles, both guide hubs, all six comparison
and alternative pages, and pricing at 320px, 390px, and 1440px: 39 combinations.
Every view had one H1, its expected production canonical, no noindex meta, and
no document-level overflow. New Arabic articles declare Arabic/RTL and retain
real reciprocal translations. Shared marketing chrome remains partly English,
as on the existing Arabic articles; the article bodies and metadata are Arabic.
HTML/Markdown parity passed for all 60 sitemap URLs.
The choose/publish guide filters show the correct new article in both English
and Arabic. The final app build, typecheck, and all 811 existing app tests passed
on Node 22.23.4; no assertions were weakened to accommodate the local runtime.

The local preview has no API/database. The article account CTA navigated to
`/sign-up`, where the incomplete local configuration reports an environment
error. Account creation, publishing, and provider delivery are outside this PR
acceptance. Both integration article heads declare reciprocal EN/AR alternates;
neither loaded optional tracker script elements before opt-in. This is DOM
evidence, not a network or provider-delivery acceptance test. No customer records
or credentials appear in these assets.

Official pricing and feature references were rechecked November 2:
[Mintlify pricing](https://www.mintlify.com/pricing),
[GitBook pricing](https://www.gitbook.com/pricing),
[ReadMe pricing](https://readme.com/pricing),
[Mintlify editor](https://www.mintlify.com/docs/editor/tutorial),
[Mintlify languages](https://www.mintlify.com/docs/guides/internationalization),
[Mintlify custom frontend boundary](https://www.mintlify.com/blog/custom-frontends-on-mintlify),
[GitBook reader renderer](https://github.com/GitbookIO/gitbook), and
[Docusaurus i18n](https://docusaurus.io/docs/i18n/introduction).
The removed GitBook editing/RTL source now returns 404. Its unverified RTL
editing guarantee is marked unknown; translation plan claims were removed
because the current pricing page did not substantiate them.
Mintlify documents Arabic locales, but the current language guide did not
substantiate the previous automatic RTL-layout guarantee. Comparison copy now
asks readers to test their required editing and reader layouts.
