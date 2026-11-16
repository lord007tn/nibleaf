# Import → Mintlify / GitBook: one owner per press, reported only into its own panel

**Component fixture only, not the dashboard and not production.** These captures show Settings → Import → Mintlify
and GitBook, with main's `ImportTab` beside this branch's, in English and Arabic at 390 px and 1440 px (light theme),
plus one recording. They prove nothing about real sites, the server's importers, real repositories or screen
readers. Nothing was imported anywhere.

## How they were made

`capture.mjs` builds a temporary Vite fixture from the real code. It takes main's `import-tab.tsx` and its
`useImportFromMintlify` / `useImportFromGitbook` at the pinned base `c7a98c48` (read with `git show`) and this
branch's tab, together with the design system, the EN/AR catalogs and the app's own `createQueryClient` (wrapped
to record which keys are invalidated). It opens the fixture in local headless Chromium through
`tests/integration/lib/capture-env.mjs`, which keeps the browser local-only. The run held the repository's
heavy-step lock.

- The site (`site-1`) and the repositories (`acme-fixture/handbook`, `acme-fixture/guides`) are fictional.
- The Mintlify and GitBook import `POST`s are answered by interception on the fixture origin: held until the
  script releases them, or delayed (1.5 s in the recording), then a fixed summary or the refusal the script
  queued. That answer is the mock, not the importer.

No server, database, worker, importer or GitHub was used, no request left the fixture origin (`attempted: 0`), and
the temporary build was deleted after the run. `evidence.json` names the base and the head, and records each
request with its body.

## Files

| Files | What it shows |
| --- | --- |
| `states-390.png`, `states-1440.png` | Main (left) and this branch (right), EN then AR, in four states. **Ready**: unchanged. **Import pressed twice in one task, request held**: main sends two requests; here one, and the busy button keeps focus (`aria-disabled`) in both. **Mintlify running, GitBook chosen and typed, then Mintlify succeeds**: both refresh `['pages', site]`, `['projects', site]` and `['projects']`; main's result and "Import finished" replace the GitBook form, here the GitBook form stays as typed. **GitBook running, Mintlify chosen, then GitBook is refused (409 `import:in_progress`)**: main toasts over the Mintlify form; here nothing is reported and nothing is refreshed. Arabic lays out from the right, and nothing overflows (asserted for every panel). |
| `flow-en-1440.webm` | A refused Mintlify import, its retry, a switch to GitBook while it runs, and a GitBook import (below). |
| `evidence.json` | Every panel's and step's readback: the panel and chip shown, the Import button (what it shows, busy, disabled, focus), the repository field, toasts, refreshed query keys, and every request with its body. |

## The recording, step by step

1. Mintlify chosen and `https://github.com/acme-fixture/handbook.git` typed.
2. Import: busy for 1.5 s; the fixture answers 409 `import:in_progress`: "An import is already running for this
   project…", shown once. The repository stays as typed.
3. Import again: busy, sent with the same body.
4. GitBook chosen and typed while it runs: Import stays busy. Mintlify finishes: the site is refreshed, and no
   result or "Import finished" replaces the GitBook form.
5. GitBook Import: busy, then "Import finished" and the result.

In total: two Mintlify `POST`s with identical bodies (`{ repo: 'acme-fixture/handbook', replaceExisting: false }`)
and one GitBook `POST` (`{ repo: 'acme-fixture/guides', replaceExisting: false, path: 'spaces/guides' }`).
