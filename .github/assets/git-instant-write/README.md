# Git → instant writes: the stored connection, not display defaults (#780)

**Component fixture only, not the dashboard and not production.** These captures show Settings → Git's instant writes
(the auto-publish switch, Disconnect, and the new connection switching the legacy import off), with main's `GitTab`
beside this branch's, in English and Arabic at 390 px and 1440 px (light theme), plus one recording. They prove nothing
about real repositories, the server, imports, webhooks or deployments. Nothing was imported, built, deployed or
rotated.

## How they were made

`capture.mjs` builds a temporary Vite fixture from the real code. The "before" side is built only from the pinned base
`a716947c` (read with `git show`): main's `git-tab.tsx` and the whole `features/site-git` slice it imports, so a later
refactor of today's files can't change or break it. The "after" side is this branch. Both use today's design system,
EN/AR catalogs, the app's own `createQueryClient` and the settings query. The per-site connection above the legacy
import renders as nothing. The script only calls the hand-off it makes when a new connection is saved. The fixture
opens in local headless Chromium through `tests/integration/lib/capture-env.mjs`, which keeps the browser local-only.
The run held the repository's heavy-step lock.

- The site (`site-1`) and the repositories (`acme-fixture/*`, `*.acme-fixture.test`) are fictional. The webhook secret
  is a fixture value. It is returned by the settings `GET`, as to an admin, and the run asserts it appears in no body,
  readback or step.
- The settings `GET` and `PATCH` are answered by interception on the fixture origin. A `PATCH` goes through the real
  body validator (`updateWorkspaceSettingsBody`, bundled for the run). It is answered as the route answers: **500**
  when the validator throws, **422** when it refuses, otherwise stored as the server stores it. The server replaces
  `git` wholesale, carries the import and push-sync bookkeeping over, and keeps the secret apart.
- Branches, languages, deployments and the per-site connection get fixed answers. Any other API call fails the run.

No server, database, worker or Git host was used, and no request left the fixture origin (`attempted: 0`). The temporary
build was deleted after the run. `evidence.json` names the base and head, and records every state's readback, each
`PATCH` body with its status (and the validator's message when it refused), and what was stored.

## Files

| Files | What it shows |
| --- | --- |
| `states-390.png`, `states-1440.png` | Main (left) and this branch (right), EN then AR, in four states. Under each panel is the `PATCH` status and the toast. **GitHub with no stored clone URL, auto publish switched on**: main sends `cloneUrl: ''` and gets a 500, says "Could not save Git settings", and the switch stays off. Here it stores `autoPublish: true` and nothing else changes. **The same connection, Disconnect confirmed**: main gets a 500 and stays connected. Here it stores `connected: false`, and the legacy import is gone (the blank panel: with the per-site connection rendered as nothing, the tab is empty). **Self-hosted GitLab with a blank content path, switched off by the new connection**: main gets a 500. Here it stores `connected: false` and keeps the instance and the blank path. **Git URL with no stored repository, auto publish never set, switched on**: main sends `repo: ''` and gets a 422. Here it is stored. Each "after" body is asserted to be the stored client fields with that one change, accepted by the validator unchanged, and stored with the bookkeeping and the secret kept. Arabic lays out from the right, and nothing overflows (asserted). |
| `flow-after-en-1440.webm` | This branch, on the GitHub connection with no clone URL: auto publish on → off → Disconnect (confirmation, then confirmed). Each write is intercepted and answered 200, and each step's stored settings are asserted: only `autoPublish`, then only `connected`, changes. |
| `evidence.json` | Base and head SHAs, every state's readback (switch, legacy import shown, toasts, overflow), each `PATCH` body, status and validator result, the stored settings, and each recording step. |
