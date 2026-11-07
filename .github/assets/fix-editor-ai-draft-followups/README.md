# AI assist: keep drafts after leaving the editor, and say when one is ready

Headless Chromium against an isolated local stack with the seeded demo workspace, on an English
and an Arabic sandbox page. No AI provider is configured locally, so the browser held the
drafting request for a few seconds and answered it with a fixed paragraph; public metadata
reported drafting as available. Nothing was sent to a provider.

| File | What it shows |
| --- | --- |
| `{en-desktop,ar-mobile}-1-left-editor-toast.png` | The writer started **Rephrase**, then left the editor for the project overview. When the draft lands, a toast says the suggestion for that page is ready, with **Open page**. Before this change the draft was lost here, and Continue/Outline even said "Section drafted." |
| `{en-desktop,ar-mobile}-2-back-with-suggestion.png` | **Open page** returns to the page; the suggestion is waiting with Replace and Insert. |
| `{en-desktop,ar-desktop}-3-ready-in-panel.png` | Same page, but the writer switched to **Comments** before the suggestion landed: a toast points to the AI panel. |
| `en-desktop.gif`, `ar-mobile.gif` | The whole leave-and-come-back flow. |
