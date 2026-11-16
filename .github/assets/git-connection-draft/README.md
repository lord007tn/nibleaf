# Git → Repository settings: one draft per site

**Component fixture only, not the dashboard and not production.** These captures show Settings → Git → Repository
settings (the legacy one-way import's connection form), with main's `GitTab` beside this branch's, in English and
Arabic at 390 px and 1440 px (light theme), plus two recordings. They prove nothing about real repositories, the
server, imports, the worker or deployments. Nothing was imported, built or deployed.

## How they were made

`capture.mjs` builds a temporary Vite fixture from the real code. It takes main's `git-tab.tsx` at the pinned base
`b5c9c797` (read with `git show`) and this branch's tab, with the design system, the EN/AR catalogs, the app's own
`createQueryClient`, the settings query and the mutations. The per-site connection above the form (`GitWorkflow`)
renders as nothing on both sides. It opens the fixture in local headless Chromium through
`tests/integration/lib/capture-env.mjs`, which keeps the browser local-only. The run held the repository's
heavy-step lock.

- The site (`site-1`) and the repositories (`acme-fixture/*`) are fictional.
- The settings `GET` and `PATCH` are answered by interception on the fixture origin. A `PATCH` can be held until the
  script releases it, or refused once with a 500. Otherwise it goes through the real body validator
  (`updateWorkspaceSettingsBody`, bundled for the run) and is stored as main's server stores it: `git` replaced
  wholesale, the import and push-sync bookkeeping carried over. "Another writer" is the script changing the stored
  settings, then asking the page to refetch.
- Branches, languages, deployments and the per-site connection get fixed answers. Any other API call fails the run.

No server, database, worker or Git host was used, no request left the fixture origin (`attempted: 0`), and the
temporary build was deleted after the run. `evidence.json` names the base and head, and records every state's
readback, each `PATCH` body, and what was stored.

## Files

| Files | What it shows |
| --- | --- |
| `states-390.png`, `states-1440.png` | Main (left) and this branch (right), EN then AR, in six states. **Ready**: unchanged. **Repository and path edited, then another writer changes the branch**: main resets both edits; here they stay and the branch follows the server. **Save held, path edited during it, then it succeeds**: main drops the path edit; here it stays, dirty, with Discard and no "Repository saved". **Save refused, then another writer changes the branch**: main wipes the failed values; here they stay. **Another writer saves a different repository**: main silently shows theirs; here the edit stays with "Someone else changed this…" and Use their version / Keep mine. **Repository cleared, then Save**: main sends it and the server refuses it (toast only); here nothing is sent, "Repository path is required" shows on the field and focus moves there. The same save sends the same body on both versions (asserted). Arabic lays out from the right, and nothing overflows (asserted). |
| `flow-before-en-1440.webm`, `flow-after-en-1440.webm` | The same steps on both versions: repository and path edited → Enter, save held (busy) → another writer changes the branch and the page refetches while it is held → the save is refused (500) → Save again. Main loses both edits at the refetch, so the retry saves nothing of them. Here both survive the refetch and the refusal, the branch follows the server, and the retry stores `acme-fixture/handbook`, `guides` and `release` with auto publish and the bookkeeping kept. |
| `evidence.json` | Base and head SHAs, every state's readback (fields, Save busy, buttons, field errors, toasts, focus, overflow), each `PATCH` body and the stored settings, and each recording step. |
