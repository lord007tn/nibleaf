# AI answers → own provider key: Check and Save keep the key out of every cache

**These are component-fixture captures only. They are not the dashboard and not production.** They show the site's
own OpenAI key form (AI answers → a source card → Manage key), main's `ProviderKeyForm` with its TanStack key hooks
beside this branch's. Each state is shown in English and Arabic at 390 px and 1440 px (light theme), and there is one
recording of each version. They prove nothing about real sites, the server, OpenAI or OpenRouter, real keys or screen
readers. No key was sent to a provider, and a provider accepting a key is not claimed anywhere.

## How they were made

`capture.mjs` builds a temporary Vite fixture from the real code:

- main's `provider-key-form.tsx`, `features/site-ai/api/hooks.ts` and `hooks/api/workspace-ai.ts`, read with `git show`
  at the pinned base `dd302202`. Every other module the before side imports is checked to be unchanged since the base;
- this branch's `ProviderKeyForm` with its direct Check and Save;
- the design system, the EN/AR catalogs and the app's own `createQueryClient`. Each panel records how many mutations
  that QueryClient holds.

The fixture adds a Done / Manage key toggle (English in both languages; it is the fixture's, not the page's) that
unmounts and mounts the form as the source card does. It opens in local headless Chromium through
`tests/integration/lib/capture-env.mjs`, which keeps the browser local-only. The run held the repository's heavy-step
lock.

- The site (`site-a`) and the models (`fixture-model-a`, `fixture-model-b`) are fictional. The keys are low-entropy
  placeholders (`test-key-0001`, `test-key-0002`), nothing like a provider key. The key field is masked in every
  screenshot and recording (asserted), and `evidence.json` writes each request body with the key as a label (`<KEY_A>`),
  never the value (also asserted).
- Every API request is answered by interception on the fixture origin; those answers are the mock, not the server. The
  status `GET` answers a saved OpenAI key at revision 2. A Check `POST` can be held until the script releases it; it is
  then answered with the two models, refused with a 400 `integration:credentials_invalid` whose message echoes the key,
  or (offline) dropped as disconnected.

No server, database or provider was used, and no request left the fixture origin (`attempted: 0`). Save was not pressed
in any capture; Save is covered by `provider-key-form.credentials.test.tsx`. The temporary build was deleted after the
run.

## Files

| Files | What it shows |
| --- | --- |
| `states-390.png`, `states-1440.png` | Main (left) and this branch (right), EN then AR, in five states. Each panel is captioned with the key field (as a label), the Checks sent, the Check button, whether models show, the toasts and the mutations the QueryClient keeps. |
| `flow-before-en-1440.webm`, `flow-after-en-1440.webm` | Key A checked and held, the panel closed and opened again, A refused, then key B checked. |
| `evidence.json` | Every panel's and every step's readback and every request, keys as labels. |

### The five states

- **Key A, Check, models loaded (control):** the same on screen. Main keeps 1 mutation, which holds the key in its
  variables; here 0.
- **Key A, Check, refused (control):** the same on screen, the invalid-key toast once. Main keeps 1 mutation (the key
  in its variables, and in its error's message); here 0.
- **Key A checked (held), the panel closed and opened again, then A refused:** main toasts the invalid-key message
  over the new, empty form. Here closing retired the Check, so nothing shows.
- **Check pressed three times in one task (held):** main sends three Checks and keeps three mutations. Here one, busy.
- **Offline, key A, Check:** main pauses the Check (busy, nothing sent) and keeps it, with the key, for a replay on
  reconnect. Here it is tried at once, fails as a dropped connection and says so; nothing is kept.

The key field is disabled while a Check runs (on main too), so editing the key mid-Check is not reachable from the
page; the unit tests cover it as programmatic. Arabic lays out from the right and nothing overflows, which is asserted
for every panel.
