# Reader accessible-name regression evidence

The source change affects hidden accessible names. The visible X icon, search prompt, drawer geometry and controls are unchanged, so screenshots or a video would not distinguish the correction. The [sanitized real-component test results](regression-results.json) provide equivalent evidence without customer content or authentication data.

The baseline `25a4b3e` reproduces four failures: the Arabic drawer announces English `Close`, and the search input's referenced hidden label is empty in English, Arabic and `ar-SA`. The library also defaults its results-list name to `Suggestions`.

The corrected components pass 24 focused tests, including these accessible-name contracts:

| Published locale | Drawer close | Search combobox | Results listbox |
| --- | --- | --- | --- |
| English | Close | Search documentation | Results |
| Arabic | إغلاق | البحث في الوثائق | النتائج |
| ar-SA | Existing Arabic Close translation | البحث في الوثائق | النتائج |

The drawer test leaves its navigation-language prop undefined while supplying its Arabic close label, matching default-language URL behavior. SiteChrome resolves that label from the active content locale rather than the optional navigation-language query value. The shared sheet keeps its English default for callers that omit the new optional label.

Tests also verify the drawer closes and restores trigger focus, the custom search placeholder remains intact, `aria-controls` points to the results list, and populated results still render. Existing navigation/CTA, search failure, debounce, answer-scope and keyboard-tab tests remain passing. No production or provider request was made.

Reproduce the final focused checks after installing dependencies and generating i18n messages:

```sh
pnpm --filter @nibleaf/i18n run setup
pnpm --filter @nibleaf/app exec vitest run src/components/site/mobile-nav.test.tsx src/components/site/site-search.test.tsx src/lib/site-i18n.test.ts
pnpm --filter @nibleaf/design-system typecheck
```

The results file summarizes actual Vitest JSON reports, stripping local paths and stack traces. It is a DOM regression receipt, not a production-browser AX capture. Root-owned live acceptance remains separate.
