# Clean paste, image uploads and resizing, table alignment

Headless Chromium against an isolated local stack with the seeded demo workspace, on an English
and an Arabic sandbox page. Clipboard content is real HTML as Google Docs and Microsoft Word put
it on the clipboard (fictional text), delivered as a paste event. Image uploads go to the local
S3-compatible store; the browser slowed the upload by ~2 s so the progress card stays on screen.
The published-reader captures use `scripts/site-preview-mock.mjs` with one extra page holding
exactly what the editor now saves.

| File | What it shows |
| --- | --- |
| `before-en-desktop-paste.png`, `after-en-desktop-paste.png` | The same Google Docs + Word paste and one table-cell edit. Before (main): Word's list markers become literal "·" and "o" paragraphs, links carry `<u>`, Docs lists are loose, and editing the table drops its column alignment. After: real nested lists, plain links, a tight list, alignment kept. The saved Markdown is in the PR description. |
| `after-*-gdocs-paste.png`, `after-en-desktop-2-word-paste.png` | Pasted content in English and Arabic. |
| `after-*-3-uploading.png` | An upload card with the file name, progress and Remove. |
| `after-*-4-alt-prompt.png` | After the image lands, the description field opens with a hint. |
| `after-*-5-resized.png` | Image size presets (saved as `<img … width="480" />`). |
| `after-en-desktop-6-caption.png` | "Add caption" wraps the image in a Frame with its caption. |
| `after-*-7-table-align.png` | The table menu's alignment buttons (start / center / end, following the page direction). |
| `after-en-desktop-8-light-dark.png` | A light/dark image pair stays two images after editing; their `class` / `className` survive. |
| `after-en-desktop.gif`, `after-ar-mobile.gif` | The whole flow in English (desktop) and Arabic (390 px). |
| `reader-*.png` | The saved content on the published site: Harbor and Manuscript (light, English, desktop), Signal and Manuscript (dark, Arabic, 390 px). |
