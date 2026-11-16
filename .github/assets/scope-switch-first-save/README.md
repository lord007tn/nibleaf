# Banner: a scope's first Save while another scope's save is pending (#770)

Component-fixture captures of Site configuration → Banner. These are **not** dashboard or production screenshots.

`capture.mjs` builds the real section with Vite twice: before uses `use-server-draft.ts` from the merge base with
`main`, after uses this branch's. Nothing else differs. The build includes the design system, the EN/AR catalogs,
TanStack Query and the app's own mutations. The page runs in headless Chromium through
`tests/integration/lib/capture-env.mjs`, which takes the dev-stack lock and lets no request leave the fixture origin.

The API is answered by interception with fictional data. The Default (project) save is held until the script releases
it. A French save is answered at once. No server, database or account was used, and 0 requests went outside. The
temporary builds are deleted after the run.

The flow: edit the Default message and press Save (its request stays pending). Switch to Français, confirm the discard
prompt, and type. Then press the bar's Save, Enter in the field, and Ctrl+S. Then the Default save ends.

| File | What it shows |
| --- | --- |
| `sheet-{en,ar}-{1440,390}-{light,dark}.png` | Before \| after, right after the three save attempts. Before: the bar stays "Saving…" for French (its Save is disabled) and no French request is sent. After: French's first Save sends its request, and the bar closes on its confirmation. |
| `flow-before-en-1440.webm` | Before, EN, 1440, light. French's Save, Enter and Ctrl+S do nothing. French is sent only when Save is pressed again after the Default save ends. |
| `flow-after-en-1440.webm` | After, EN, 1440, light. French's first Save sends its request at once. Enter and Ctrl+S then add nothing. The Default save ending later changes nothing on screen and shows no toast. |
| `evidence.json` | For each capture: the requests, the message value, the bar and its Save state, toasts, focus, page errors (none) and overflow (none), both after the save attempts and after the Default save ends. Also the steps of each recording. |

Every run asserts these facts. Before: one PATCH (Default) and a disabled Save, still one PATCH after the Default
save ends. After: exactly one French PATCH, the bar closed, and nothing changed when the Default save ends. Both:
French's text is kept, there is no toast, no overflow, no page errors and no outside requests.
