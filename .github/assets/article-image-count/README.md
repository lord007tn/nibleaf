# Article image-count visual evidence

Captured in Chrome on2026-09-08. These are local synthetic fixtures of the actual `SitePageView` component and design-system styles, using its real English/Arabic article strings. The before component is from90539120d9b306f128ec66d6f1afdfc77ac59bcd; after uses this PR.

The Markdown body is deliberately a source-only stub; analytics/alternate-page hooks, layout wrapper, URL helper and locale helper are controlled fixtures. No production account, API calls, asset fetches or customer data are involved. These screenshots verify article metadata and responsive layout, not the full Markdown renderer.

- `before-en1440.png` / `after-en1440.png`: two code examples stop being counted as screenshots.
- `before-ar320.png` / `after-ar320.png`: same correction with Arabic strings and RTL layout; document width320/viewport320.
- Actual prose image positive control retains one screenshot; also covered by the component test.

The real production import/publish regression was verified separately on905391: the fenced image renders as code without a browser image request, and the English/Arabic readers remain usable. This PR corrects the remaining metadata count. No interaction or motion changes require video evidence.
