# Search and AI regression evidence

Captured 2026-11-08 with headless `playwright-core` and a fresh, isolated
Chromium context. No owner browser profile, desktop or shared browser session
was used for these artifacts. The actual search, reader-chat and transcript
components ran on an owned Vite fixture at port 4430, with fictional data and
mocked network calls. The temporary harness is not shipped.

`checks.json` records successful English and Arabic checks at 390×844:

- Original joined Arabic words and diacritics stay intact: `الإعدادات` highlights
  `إعداد`, and `المستخدمين` highlights `مُستخدِم` and `المستخدمون`.
- Arrow Down selects the section, Arrow Up returns to the page, and Enter opens
  the page. The same flow works after selecting named version `v2`.
- Saved transcript links retain `v2` and the exact `#users` section.
- A no-match query produces no marked text. Neither language overflows sideways.
- The rating-save status appears while details wait, then disappears when the
  save completes and details become sendable. All new copy exists in 12 locales.
- No browser page errors were recorded.

Mobile search, no-match and feedback screenshots, desktop chat screenshots,
English/Arabic accessibility-tree snapshots, and short interaction recordings
are included. Accessibility-tree and keyboard checks are not a claim that an
external screen-reader application was run.

Provider-free real-Qdrant tests separately index real English/Arabic docs in
`main` and `v2`, retrieve the upgrade guide in the top three, and pass retrieved
sources through the production citation pipeline with a deterministic adapter.
These are component/browser and indexed-fixture checks, not a deployed-site or
live embedding/answer-model quality measurement.
