AUTH-36 writer journey evidence

Run `node tests/integration/editor-paste-and-title/browser.mjs` from the root.
The script acquires the shared capture lock, builds the actual editor/title
components, uses headless playwright-core with Chromium 1248, captures all eight
variants, closes its browser and releases the lock. It starts no server or
container. Pillow converts screenshot frames into GIFs (all below 5 MB).

Before is main at `47ddeff639238867c5ecd8fb520dba46a1072edc`; after is this PR.
Tailwind scans both baseline and current title source so removed utilities remain
available in the before capture; the baseline desktop size is asserted explicitly.
Each GIF shows the empty title, entering a wrapping title, Enter to the body,
and a synthetic ClipboardEvent carrying the Google Docs regression HTML.
The PNG shows the resulting title and pasted document. Arabic uses translated
fictional fixture text and the real Arabic catalog for editor controls.

`evidence.json` records viewport sizes, title geometry, the keyboard focus outline,
and empty paragraphs inside list items (Google Docs: two before; Notion: one
before; zero after for both). The browser also
asserts that long unbroken titles do not overflow horizontally.

These are isolated component journeys. Page-link suggestions are excluded;
there is no authenticated router, API, database or save/reload assertion.
The HTML samples are reconstructed realistic clipboard fixtures, not captures
from live Google Docs/Notion accounts; see the editor fixture README.

Main already has a borderless wrapping textarea. The before media faithfully
records that state rather than recreating the audit's older bordered input.
This PR aligns its typography with the editor H1, adds the existing translated
Untitled placeholder and strengthens keyboard focus visibility.
