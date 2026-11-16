# Settings → Integrations → Slack, Discord, Zapier: Connect and Save keep the webhook URL out of every cache

**Component fixture only, not the dashboard and not production.** These captures show the Slack panel of the
Integrations tab, main's beside this branch's, in English and Arabic at 390 px and 1440 px (light theme), plus one
recording. Nothing reached Slack, Discord or Zapier, and every webhook URL is a fictional `.example.test` fixture.

**Reachability today:** production lists Slack, Discord and Zapier as `coming_soon` (`INTEGRATION_CATALOG`), which
shows only Remove, and the server refuses Connect and Save for them with `integration:provider_unavailable`. So the
form below is reachable only in this fixture (whose catalog answers `available`) and once publish-result delivery
turns `comingSoon` off. The retention on main is real client behavior, but latent in production today.

## How they were made

`capture.mjs` builds a temporary Vite fixture from the real code. It takes main's `integrations-tab.tsx` and
`hooks/api/integrations.ts` at the pinned base `dd302202` (read with `git show`) and this branch's tab, with the
design system, the EN/AR catalogs, the app's own `createQueryClient` and API module (the Hono RPC client). It opens
the fixture in local headless Chromium through `tests/integration/lib/capture-env.mjs`, which keeps the browser
local-only. The run held the repository's heavy-step lock.

- `GET …/integrations` answers the webhook manifests as `available`, with the fixture's stored Slack connection.
- `POST …/integrations` and `PATCH …/integrations/slack` are answered by interception: held or delayed, then
  stored with a new revision, refused with a 409 `integration:revision_conflict` when the revision is stale, or
  refused with a 422 the fixture invents that echoes the URL it was sent.
- The **fixture probe** strip above the tab is not product UI: it names where the app still holds a fixture URL
  (mutation variables or error, query cache, `dehydrate`, `console.error`), never the value.

No server, database, worker or provider was used, and no request left the fixture origin (`attempted: 0`).
`evidence.json` names the base and the head, and records every request with its body, the URL written as
`<fixture-url:A>` or `<fixture-url:B>` and each idempotency key as `<synthetic-idempotency-key#n>`.

## Files

| Files | What it shows |
| --- | --- |
| `states-390.png`, `states-1440.png` | Main (left) and this branch (right), EN then AR, in five states. **Ready**: the same form. **Connect held, URL corrected during it**: both busy; main's mutation holds the URL. **Its answer**: main wipes the corrected URL and says connected; here the corrected URL stays (masked) and nothing is said, since the URL was edited. **A refusal echoing the URL**: the same message; main keeps the echo in the mutation error. **Label and URL edited, someone else saved first**: one conflict message in both; main's reread remounts the panel and drops both edits; here they stay. Arabic lays out from the right, nothing overflows, and the URL field is masked (asserted for every state). |
| `flow-en-1440.webm` | This branch only, below. |
| `evidence.json` | Every state's readback: the label, the URL by its label, the button and whether it is busy, toasts, the probe, catalog reads and every request with its body. |

## The recording, step by step

1. Ready. Label `Releases`, URL A, Connect (1.8 s): busy.
2. The URL is corrected to B while Connect runs: still busy, so nothing more is sent.
3. Connect is stored; the panel switches to Save, URL B stays, and nothing is said for the retired press.
4. Save sends URL B over it (`replaceCredential`), revision 1: "Integration updated." once, and the URL is cleared.
5. The label is changed to `Mine`; someone else saves first. Save meets the conflict: one message, and the site is
   reread, the label edit kept.
6. Save again on the new revision: stored.

In total: one `POST` and three `PATCH`es, each with its own idempotency key, and the probe says `none` throughout.
