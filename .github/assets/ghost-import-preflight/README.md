# Import → Ghost: one owner from reading the file to sending the import

**Component fixture only, not the dashboard and not production.** These captures show Settings → Import → Ghost,
with main's `ImportTab` beside this branch's, in English and Arabic at 390 px and 1440 px (light theme), plus one
recording. They prove nothing about real sites, the server's importer, real Ghost exports or screen readers. Nothing
was imported anywhere.

## How they were made

`capture.mjs` builds a temporary Vite fixture from the real code. It takes main's `import-tab.tsx` and its
`useImportFromGhost` at `ab86db55` (read with `git show`) and this branch's tab, together with the design system and the
EN/AR catalogs. It opens the fixture in local headless Chromium through `tests/integration/lib/capture-env.mjs`, which
keeps the browser local-only. The run held the repository's heavy-step lock.

- The site and the Ghost export (`journal.ghost.2025-11-16.json`, one published post) are fictional.
- `FileReader` is replaced in the page before the app loads. Each read really reads the chosen file, then waits until
  the script finishes it, fails it, or lets a timer run (1.5 s in the recording).
- The Ghost import `POST` is answered by interception on the fixture origin: a fixed summary, or the refusal the
  script queued. That answer is the mock, not the importer.

No server, database, worker or importer was used, no request left the fixture origin, and the temporary build was
deleted after the run. `evidence.json` names the base and the head, and records each request with its body.

## Files

| Files | What it shows |
| --- | --- |
| `states-390.png`, `states-1440.png` | Main (left) and this branch (right), EN then AR, in four states. **Ready**: unchanged. **Import pressed with Enter, the read held**: main shows nothing and Import stays pressable; here it is busy with the existing "Importing…" and keeps keyboard focus (`aria-disabled`). **The read fails**: main says "That file is not valid JSON."; here "Import failed". The URL and file stay in both. **Mintlify chosen during the read, then the read finishes**: main still sends the import, and its result replaces the Mintlify panel; here the read is abandoned (aborted once), nothing is sent and the Mintlify panel stays. Arabic lays out from the right, and nothing overflows (asserted for every panel). |
| `flow-en-1440.webm` | A slow read that fails, then a slow read pressed twice that the server refuses, then a retry that imports (below). |
| `evidence.json` | Every panel's and step's readback: the panel shown, the Import button (what it shows, busy, disabled, focus), the URL and file, toasts, reads started and aborted, and every request with its body. |

## The recording, step by step

1. Ghost chosen, its URL typed and the export picked.
2. Import: busy for the 1.5 s read, which fails. "Import failed"; the file and URL stay.
3. Import double-clicked: one read, busy throughout. The import is sent once and the fixture answers 409
   `import:in_progress`: "An import is already running for this project…", shown once. The file and URL stay.
4. Import again: busy for the read, then sent with the same body. "Import finished", and the result.

In total: three reads and two Ghost `POST`s with identical bodies (the export plus `__nibleafImport.ghostUrl`).
