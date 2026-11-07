# Smart AI settings and editor AI assist: data loading conventions

Before (main@7b46917b) and after captures from headless Chromium (Playwright) at
1440 × 900, against an isolated local stack with the fictional "Acme Notes" demo
workspace. Requests were held in the browser for a few seconds so each loading
state stays on screen. The failures are real:

- the workspace AI key check sent a made-up key to OpenRouter, which refused it;
- the editor drafted through an API process started with a placeholder OpenRouter
  key, so the provider call failed.

No real key was used and no request was billed.

| File | What it shows |
| --- | --- |
| `smart-ai-loading-{before,after}.png` | Opening **Smart AI** from the settings nav. Before: two grey blocks and no heading. After: the heading at once, over a skeleton shaped like the status card, both provider cards and the index card. |
| `smart-ai-verifying-{before,after}.png` | **Verify key and load models** while it runs. Before: a spinner added next to the label by hand. After: the Button `loading` state, the same width, every other action waiting. |
| `smart-ai-verify-failed-{before,after}.png` | The key is refused. Before: an inline box under the card. After: one plain-language toast from the hook's `meta.errorMessage`. |
| `editor-ai-working-{before,after}.png` | **Rephrase** in the editor's AI assist. Before: every action replaced by one status row, so the card jumps. After: the actions stay where they are; the clicked one shows "Rephrasing…". |
| `editor-ai-failed-{before,after}.png` | The draft fails: one toast before and after, now worded by `useAiDraft`'s `meta.errorMessage` (a daily-limit 429 gets its own message). |
| `editor-ai-assist-after.gif` | The editor flow after the change: click, working, failure toast, actions back. |
