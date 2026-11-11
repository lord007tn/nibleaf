# Page history evidence

Fictional fixtures, real local editor and API, isolated headless Chromium 1248.
The capture runs EN and AR at 1440×960 and 390×844. Each journey opens the editor
overflow menu, opens History, selects a saved revision, reviews the server diff,
confirms Restore and checks the updated editor content, persisted page and undo
snapshot. `capture-results.json` records the four results and page-error arrays.

For each locale/width, `*-before.png`, `*-diff.png`, `*-after.png` and
`*-journey.gif` show the flow. Every GIF is below 5 MB. Both exact stack PIDs were
stopped in the capture's `finally` block, and its fictional records were removed.
Media was captured locally with headless Playwright. The temporary capture script is not shipped.

The diff deliberately preserves the common prefix/suffix and replaces the middle
in linear time; it does not attempt a minimal edit script. Inputs over 128 KiB or
2,000 lines return a capped result. Revisions include title/content and serialized recoverable settings in their UTF-8 byte accounting,
with a 512 KiB per-revision cap, 10 MiB per-page cap and 200-row cap. An oversized ordinary
save still succeeds with `historySnapshot: "too-large"`. A restore is refused if
the current draft cannot fit its required undo snapshot.

Updated desktop diff screenshots are `en-1440-council-diff.png` and
`ar-1440-council-diff.png`. The local capture asserted the localized Added and
Removed groups through Playwright's accessibility locators before taking them.

Reader bundle comparison against main `4ac30e13` (same checkout and build
settings, gzip level 9): public-docs 277,126 -> 277,116 bytes (-10 bytes);
public-docs-index 276,341 -> 276,332 bytes (-9 bytes). The app build and bundle
boundary checks passed. History code and queries remain editor-only.
