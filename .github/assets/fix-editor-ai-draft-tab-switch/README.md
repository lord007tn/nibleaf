# Keep an in-flight AI assist draft across tab switches (#294)

Before (main@ed15240e) and after captures from headless Chromium (Playwright) against
an isolated local stack with the seeded demo workspace. English and Arabic dashboard,
1440 × 900 desktop and 390 × 844 phone (where the rail is a sheet).

No AI provider is configured locally, so the browser held the drafting request for
3.5 seconds and answered it with a fixed paragraph, and public metadata reported AI
drafting as available. Everything else is the real app. No provider was called.

| File | What it shows |
| --- | --- |
| `{before,after}-en-desktop-1-working.png` | **Rephrase** clicked: the button says "Rephrasing…". Same before and after. |
| `after-en-desktop-2-comments.png` | The writer switches the side panel to **Comments** while the draft is running. |
| `{before,after}-*-3-back.png` | Back on **AI** once the draft has arrived. Before: the card is empty, so the draft (and the quota it used) is lost. After: the suggestion is waiting with **Replace** and **Insert**. English and Arabic, desktop and phone. |
| `after-en-desktop-4-other-page.png` | The writer opened another page while a draft for "Getting started" was running. The card says it is finishing a draft for another page, and its actions wait. The draft is kept for "Getting started" and never written into this page. |
| `before-en-desktop.gif`, `after-en-desktop.gif` | The whole flow on desktop: click, switch to Comments, come back. |
| `after-ar-mobile.gif` | The same flow in Arabic on a 390 px phone. |
