# Page history evidence

Fictional fixtures, real local editor and API, isolated headless Chromium 1248.
The capture runs EN and AR at 1440×960 and 390×844. Each journey opens the editor
overflow menu, opens History, selects a saved revision, reviews the server diff,
confirms Restore and checks the updated editor content, persisted page and undo
snapshot. `capture-results.json` records the four results and page-error arrays.

For each locale/width, `*-before.png`, `*-diff.png`, `*-after.png` and
`*-journey.gif` show the flow. Every GIF is below 5 MB. Both exact stack PIDs were
stopped in the capture's `finally` block, and its fictional records were removed.
Reproduction: `tests/integration/page-history/README.md`.

The diff deliberately preserves the common prefix/suffix and replaces the middle
in linear time; it does not attempt a minimal edit script. Inputs over 128 KiB or
2,000 lines return a capped result. Revisions include title/content UTF-8 bytes,
with a 512 KiB per-revision cap and 10 MiB per-page cap. An oversized ordinary
save still succeeds with `historySnapshot: "too-large"`. A restore is refused if
the current draft cannot fit its required undo snapshot.

Reader bundle comparison against main `775a1840` (same checkout and build
settings, gzip level 9): public-docs 277,084 → 277,082 bytes; public-docs-index
276,300 → 276,298 bytes, both −2 bytes. All rendered source-module lengths in
the reader's eager chunk are unchanged. History code and queries are editor-only.
