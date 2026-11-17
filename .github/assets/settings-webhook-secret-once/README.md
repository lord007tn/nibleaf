# #855: secret-free settings and a one-time legacy webhook answer

Component-fixture evidence only. The real `GitTab`, settings query, direct Settings rotation API/command,
QueryClient, design system and EN/AR catalogs run against intercepted fictional HTTP. The newer GitWorkflow
connection renders as an empty component. No signed-in dashboard, server, database, provider or production system
is exercised. No real credential is read, created, rotated or replaced.

`capture.mjs` builds only a disposable fixture beneath this checkout, takes the canonical `editor-devstack.lock`
directory after the heavy phase, and uses the repository's local-only browser guard. No HTTP server
starts. Temporary files are removed after the browser closes.

The eight `en/ar-390/1440-light/dark.png` sheets show configured status, a held rotation, the explicit one-time answer
after settings readback, and reload with no secret/reveal path. Each uses the actual product focus/RTL behavior.
The recording `one-time-reveal-copy-reload.webm` also exercises keyboard copy, hide/reveal and reload. Fixture values
are labelled `<credential#1>` and `<site#1>` in screenshots and recordings. The clipboard double keeps only counts
and a boolean match, never the value. `evidence.json` records assertions and measured nonlocal attempts.

`baseline-main.json` records the exact accepted main baseline `c3285e6c2de544aa251b627924f513758be0815d`, replayed
against the real query, QueryClient, GitTab and legacy direct command with held HTTP. Its ordinary case models
server-shaped persistence; its separate synthetic stale-readback case deliberately differs from the explicit
rotation response to identify the source of the displayed value. This is not a manually seeded stale cache.

Server action/route unit tests replace persistence and access lookup, while exercising the real serializer,
PATCH validator, storage write logic and guards. Existing private-reader and webhook-handler tests verify the
fictional stored key independently of the public settings DTO. These checks do not constitute PostgreSQL,
external provider, deployment or production acceptance.

Historical captures inspected: `settings-git-webhook-rotate-no-cache`, `git-webhook-rotate`,
`git-workflow-first-connect`, `git-connection-draft`, `git-instant-write`, `git-import-command` and
`git-pipeline-model`. Only the #854 capture shim required a change: it now pins its historical settings disclosure
and after-side components locally at merged #854. Its old images/manifests were not regenerated. No removed
application export was restored.
