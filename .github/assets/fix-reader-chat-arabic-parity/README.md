# Reader chat: Arabic answers lay out English terms correctly

Captured with headless Chromium against an isolated local stack, taken under the shared dev-stack lock with the app on
`--strictPort`, and removed right after. The site was built from this repo's EN/AR product docs. "Connect a custom
domain" is English-only.

No AI provider key is configured locally. The reader, the panel and this PR's code are real. The answers were replayed
into the panel in the chat API's SSE/AG-UI wire format (as in `operations/ux/reader-ask-ai.md` §1).

- `ar-*-02-answer`: an Arabic answer from English docs, at 1440 and 390, light and dark.
  - **Settings → Custom domain**, **Add domain** and **Check again** read left to right inside the Arabic sentences.
  - `docs.example.com` (code) and a plain-text link are their own left-to-right islands.
  - Every citation number stays on the line of the word before it.
- `ar-*-01-panel-empty`: the panel's subtitle and intro call the docs «هذا التوثيق».
- `ar-1440-light-03-not-in-docs`: the Arabic refusal says «لم أجد إجابة واضحة في التوثيق» and offers «تواصل مع الدعم».
  The replay reads this text from `packages/i18n/messages/ar.json`, so the shot shows the string this PR ships.
- `en-*-02-answer`: the same layout in English (regression check).

Before, on main, from `operations/ux/reader-ask-ai/shots` (#522): `ar-1440-light-04-answer-ar-on-en.jpg` (a citation
number alone on a line, labels unisolated) and `ar-1440-light-02-panel-empty.jpg` / `ar-1440-light-07-not-in-docs.jpg`
(«الوثائق» and «الدليل»).
