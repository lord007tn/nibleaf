# Search and AI regression evidence

Captured 2026-11-08 from the actual search, reader-chat and saved-transcript
components in an isolated Vite fixture on port 4430. The fixture used fictional
data, mocked network calls, English/Arabic and default/named version choices.
It was not a deployed site or a live AI-provider evaluation. The screenshot
shows original joined Arabic text highlighted through conservative stemming
at a 390 CSS-pixel viewport. The recording shows the search interaction.

Browser readback confirmed `الإعدادات` highlights `إعداد` and the original
`الإعدادات`, and pressing Enter opens `/setup?lang=ar`. A second query,
`المستخدمين`, highlighted `مُستخدِم` and `المستخدمون`. No horizontal overflow
was observed. The temporary harness was not shipped.

Further recording attempts failed with `Preview automation recordingStart
timed out` and `No preview automation host is available`. The owner then
stopped native Computer Use with Escape. English screenshots, remaining live
version switching, and a screen-reader pass were therefore not captured.
Equivalent automated checks cover English/Arabic exact, folded and stemmed
highlights, exclusions, keyboard selection, no-match states, version links,
rating-save ordering, and numbered saved section links.

Provider-free real-Qdrant tests index real English/Arabic docs in `main` and
`v2`, retrieve the upgrade guide in the top three, and pass retrieved sources
through the production citation pipeline with a deterministic text adapter.
These checks do not measure live embedding or answer-model quality.
