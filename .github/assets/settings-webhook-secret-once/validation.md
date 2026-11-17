# #855 validation and scope

## Revision and isolation

- Supplied branch: `t3/remove-webhook-secret-from-settings-query`, clean baseline
  `730fe94910528f06e66b7488bd6ffb7c068f85a9`. It lacked merged #854, so implementation stopped before edits.
- Master explicitly authorized resetting this same clean, local-only prepared checkout to fetched `origin/main`:
  `c3285e6c2de544aa251b627924f513758be0815d`. This contains #854 at
  `fe435f969657fb965370423b23c2a0b86b618193` and the direct Settings rotation command.
- Working branch: `fix/855-webhook-secret-out-of-settings`. No other checkout, borrowed dependency tree, shell-created
  worktree, subagent, deployment or merge was used. Dependencies and generated outputs belong to this checkout.
- Capture manifests record the baseline, dirty-source boundary and SHA-256 of the exact captured application sources.

## Public/private path trace

| Entry point | Actual implementation | Result |
| --- | --- | --- |
| GET/PATCH `/api/app/projects/:projectId/settings` | `project-settings/handlers.ts` → `getScopedWorkspaceSettings` | Secret-free public Git DTO, including admins/owners and legacy raw Git copies. |
| GET/PATCH `/api/app/workspace` compatibility alias | `workspace/handlers.ts` → the same action | Same DTO; sole-project resolution and existing role/tenant guards remain. |
| Explicit POST `/api/app/projects/:projectId/settings/git/webhook-secret` | Existing private rotation action | Same endpoint and empty body; the explicit response alone supplies the one-time value. |
| Public legacy webhook verification | `public/git/handlers.ts` → private `readGitWebhookSecret` and signature/token verifier | Private stored key remains available; public settings projection is not used. |
| Settings writes and rollout mirror | Existing `writeProjectSettings` | Unchanged storage behavior. No migration, read-time generation or replacement of an existing key. |

Only the two settings handler modules call the scoped public settings action outside tests. Organization metadata
is allowlisted; unclassified legacy metadata is not folded into a public DTO. The legacy raw Git secret property is
deleted, while `webhookConfigured` comes from the existing private reader. Internal private readers and crypto stay
unchanged. The shared `PublicGitSettings` addition is a TypeScript type, not a schema change.

GET and PATCH client boundaries project older-server answers before query/mutation retention, rather than using a
query observer `select`. Errors are reconstructed with a bounded status, route-code allowlist and bounded numeric
Retry-After; raw response messages, details, cause and stack are not forwarded. The newer GitWorkflow connection,
first-Connect and rotation resources were not changed.

## Runs actually performed

All heavy commands ran serially with an owner-checked lock and at least 5 GiB free RAM checked before each launch.

| Check | Observed result |
| --- | --- |
| `pnpm install` | Passed; own install only. Three optional dependency build scripts were skipped by pnpm's existing policy. |
| i18n setup | Passed after catalog changes. |
| Server dependency/RPC builds | Passed; `pnpm turbo run build --filter=@nibleaf/server^... --concurrency=1` and explicit server build. |
| Exact-main failing-first replay | Restored six task-owned modules temporarily from `c3285e6c` under try/finally; original edited bytes restored before fixed tests. Six cache/error probes and six serializer assertions failed as expected. |
| Ordinary main component reproduction | Passed: real QueryClient/query/GitTab/direct command retained a fictional stored secret in GET/default dehydration and revealed the query's rotated value. `baseline-main.json` contains labels, not credentials. |
| Synthetic sensitivity probe | Deliberately stale HTTP readback differs from the explicit response; old main displayed the query value. Clearly separate from ordinary response-shaped persistence; no manually injected cache. |
| Focused app tests | 98 unique tests across seven files covered by the initial run and targeted final reruns. Includes eight cache-boundary probes, 23 rotation-panel tests, API/busy/session tests, and existing GitTab/import/write/form regressions. |
| Focused server tests | 53 passed across six action/handler files: real serializer/action/validator/storage logic with mocked persistence/access, plus private-reader and webhook-handler verification. |
| i18n catalog/translation tests | Final run: 180 passed across `messages.test.ts` and `untranslated.test.ts`. All 12 catalogs include translated configured/one-time instructions with no placeholder changes. |
| Typechecks | App, server, validators and i18n passed. |
| Scoped Biome | Modified/new source and text fixtures checked; final source check passed with no warnings. |
| Diff/syntax | `git diff --check` and new capture script syntax passed. |
| Gitleaks | Checksum-verified v8.30.1 scanned complete modified/new text files (about 5.94 MB), then the final staged diff (82.26 KB), with redaction enabled: no leaks. |
| Browser component captures | Eight EN/AR × 390/1440 × light/dark sheets and a short reveal/copy/reload recording. Keyboard focus, RTL, no overflow, no page errors and zero nonlocal attempts asserted. See `evidence.json`. |

Earlier failures were resolved, not hidden: one panel test changed retry defaults after mount and was corrected to
configure them before mounting; the initial narrowed DTO type triggered four weak-type compatibility errors and was
replaced with the shared public type; German copy was corrected to the repository's formal Sie convention. A
validators build attempt reported that package has no build script (it exports source); its typecheck passed. The
first capture build exposed an escaped-newline error in the generated fixture source; the harness was corrected.
No application behavior was altered to silence a failed test.

Cache probes cover complete query/mutation objects and options/state, non-enumerable Error properties, Map/Set
entries, session records and default/all dehydration. Live pending requests and the owning panel are the permitted
transient holders. Function source inspection and caller/store review supplement graph probes; JavaScript closure
internals are not introspectable. Shared rotation bookkeeping retains ownership tokens/listeners, never answers.

One-time tests hold HTTP, response parsing and metadata readback; cover same-tick duplicates, keyed return,
unkeyed site changes, leave/unmount, client/session replacement, late refusals and clipboard completion. Explicit
retry works; reconnect never replays rotation. A failed post-success metadata read preserves the live one-time
answer and configured status. Remount/reload cannot reveal an existing stored value.

## Resource and evidence boundaries

The one guarded waiter acquired only after the lock disappeared, `.next` named `ui/855-builder`, and the RAM gate
passed. One later launch was refused below 5 GiB and retried only after recovery. Heartbeats rewrote owner/timestamp
content. Waiter/heartbeat PID 15780 and parent 26716 were verified, stopped gracefully, then the main lock was released
once in a standalone exact-owner-checked operation after the recorded heartbeat stop at 2026-11-17 13:29:52 UTC.
`.next` was never written or removed.
Captures run afterward under the separate canonical `editor-devstack.lock` helper and release it on completion.

AI-slop-cleanup reviewed the complete task-owned diff, callers, exports and lifetime/error paths after focused
validation. It consolidated the existing bounded error reconstruction, retained the necessary ownership guards,
and corrected misleading comments. No actionable speculative abstraction or secret-bearing cache side store
remains. No unrelated cleanup was applied.

Historical capture shims and manifests inspected versus rerun are listed in `README.md`. Only the new #855 capture
was rerun; #854's historical shim was pinned locally and its old screenshots were preserved. No full suite, real
PostgreSQL integration, provider, production, deployment or real-key acceptance is claimed. No backing service was
started, and no payment, external mail/provider request or real credential operation occurred. Independent review,
CI completion, merge and deployment remain Master's responsibilities.
