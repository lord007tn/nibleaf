# Organization migration operator tools

Contract: `operations/organizations-design.md` sections 3 and 10. Run production
merges only through the release owner's maintenance-window procedure, after PRs
2 and 3, a verified `pg_dump`, and reviewed plan output. These tools do not stop
the app or take a backup. Restore requires the app to be stopped.

```powershell
pnpm --filter @nibleaf/server org:merge -- plan --out reviewed-plan.json
pnpm --filter @nibleaf/server org:merge -- apply reviewed-plan.json
pnpm --filter @nibleaf/server org:merge -- verify <runId>
$env:ORG_MERGE_OFFLINE='1'
pnpm --filter @nibleaf/server org:merge -- restore <runId>
```

`POSTGRES_URL` must identify the intended database. Commands use process
environment variables; they do not load an arbitrary checkout's `.env`.
The plan command writes JSON and prints the human report. It uses a PostgreSQL
read-only, repeatable-read transaction. JSON contains row fingerprints and
permission sets, not raw metadata, token hashes, settings or credentials.
Keep the plan private: it contains member identifiers and owner email addresses.

If plan assignments differ, edit only that group's `decision`, for example:

```json
{
  "plan": "chosen-usage-plan-id",
  "organizationId": "org-with-the-reviewed-status-and-expiry",
  "reason": "Owner reviewed this exact assignment"
}
```

The chosen organization identifies the exact plan/status/expiry tuple when plan
IDs alone are ambiguous. Apply recomputes decisions and permission sets from
locked rows. A digest mismatch skips the group. It never trusts edited permission
sets. Pending provider receipts and conflicting unknown metadata still block the
merge. Existing org-admin rights are materialized as site grants; org-admin
invitations likewise become member invitations with their original site's admin
grants. No new organization admin is inferred.

Apply holds a global advisory lock on a dedicated transaction connection and
commits each group in its own transaction on another connection. Allow at least
two database connections. All organization locks are taken in ID order.
Integrating admission/transfer actions must take the same organization row locks.
The CLI reports each group as applied, skipped or failed. Read those results;
successful groups remain committed if another group fails.

Redis uses the existing BullMQ connection settings. Apply sums today's
`nibleaf:ai-quota:<orgId>:<YYYY-MM-DD>` counters into the survivor, atomically with
an idempotency marker. Source counters remain intact. Quota failures roll back
that database group. Tests inject `QuotaStore`; deployments with drafting
disabled can explicitly set `ORG_MERGE_DRAFT_AI_DISABLED=1` to omit Redis.
Restore leaves counters conservative; it never resets quota. A restored run
cannot be applied again: make a new plan after reviewing counters.

The journal stores mutations in the same transaction. Project rows retain their
settings in place: journal images contain an unchanged-field fingerprint instead
of copying `Project.config`. Legacy organization Git secrets/settings are
restored by fingerprinted references to their existing website-owned copies.
Object-key shapes preserve the original JSON text without storing secret values.
Groups with missing/different copies, or noncanonical secret-bearing metadata,
are refused until the operator repairs the copies/normalizes formatting. This is
a conservative limitation needed because PR 1 retains the legacy secret mirrors.
Do not normalize live metadata merely to bypass this check without reviewing it.

Restore checks the complete group snapshot and every changed row before writing.
A new website/invitation, changed grant/account/metadata, or missing copy refuses
the group. It replays journal sequence in reverse, retaining original IDs, and
compares the restored snapshot with the original digest. The undo rows remain
intact, with a restored marker, so the run retains its audit history. `verify` compares
permissions and calls production `resolveSiteAccess` and account checks for each
person/site pair, including denied siblings.

## Legacy writer compatibility

Migration `20261110140000_legacy_writer_compat` uses the database default
`__legacy__` for `Member.orgRole`, `Invitation.kind/orgRole`, and `JoinLink.orgRole`.
BEFORE triggers resolve the sentinel before NOT NULL/CHECK constraints run.
New writers explicitly supply these fields and get no automatic grants.
`legacyWriter` records legacy insert provenance. For updates, ordered
`UPDATE OF role` / `UPDATE OF orgRole` triggers detect the SQL SET list, even if
the explicit value is unchanged. A role-only update synchronizes the single-site
grant, including a row originally created by new code. The merge's transaction
local `nibleaf.org_merge_restore` setting disables compatibility side effects
while replaying its explicitly computed rows.

Missing slugs use the design's ASCII slug/fallback/reserved-word/suffix rules.
Handle registration is deferred to allow new nested handle writes in the same
transaction. Members created before the website get grants when the old project
insert finishes. Old invitations/links get only single-site grants; zero-site
admissions are canceled/revoked. A second legacy owner becomes a member with a
site-admin grant. Usage partition defaults remain in the previous expand
migration. Old settings/webhook-secret edits copy into the single site's storage;
unsupported legacy JSON text remains intact and is not copied into JSONB.

## Reproduce the old-release check (Windows)

Use a clean detached worktree at `8a3ce21713890bfe99d6e1ed3d4101ba82a71d46`, under
`C:/Users/raedb/AppData/Local/OpenAI/Codex/worktrees`, and an owned disposable
`orgs_legacy_*` database on **127.0.0.1:5562**. Never migrate/reset another database.

```powershell
git worktree add C:/Users/raedb/AppData/Local/OpenAI/Codex/worktrees/nibleaf-legacy-check --detach 8a3ce217
# In that old worktree:
pnpm install --frozen-lockfile
pnpm db:generate
pnpm --filter @nibleaf/i18n run setup
pnpm exec turbo run build --filter="@nibleaf/server^..."
# Back in this new worktree, after creating the owned database:
$env:POSTGRES_URL='postgresql://nibleaf:nibleaf@127.0.0.1:5562/orgs_legacy_example'
pnpm --filter @nibleaf/database exec prisma migrate deploy
node scripts/legacy-schema-compat.mjs C:/Users/raedb/AppData/Local/OpenAI/Codex/worktrees/nibleaf-legacy-check .cache/legacy-check
git worktree remove C:/Users/raedb/AppData/Local/OpenAI/Codex/worktrees/nibleaf-legacy-check
```

The harness runs the eight previous-release PostgreSQL suites sequentially,
then old `createProject`, invite/OTP sign-in/accept, join-link redemption, role
change and removal. New-code tests check the resulting roles and denials.
Then the rollback steps (design §10.1, "Rollback compatibility"): the new
release demotes a legacy Admin, removes one, creates a website and prepares
one for deletion (`legacy-rollback-setup.postgres.test.ts`); the previous
release runs `legacy-rollback-scenario.fixture` against that database
(demote/remove/create/delete, then roll back); new code re-reads the result.
Artifacts include command exit codes, suite counts and full logs.
The harness removes its temporary test/config/setup files in `finally`.

`project → organization` stays `ON DELETE CASCADE` in this release, so the old
suites tear down without help. `--cleanup-adapter` is kept only for re-running
against databases from the earlier `RESTRICT` draft. The optional adapter
changes only `organization.deleteMany({where:{id:{in:exactFixtureIds}}})` cleanup,
deleting those fixture projects first. It does not change the old assertions or
the app's transaction paths. The auth suite and scripted journey are unadapted.
Raw results and adapted results must be reported separately. This check is not
in CI because the second checkout/install/build adds substantial cost.

## Focused checks

```powershell
$env:ORG_MERGE_INTEGRATION='1'
pnpm --filter @nibleaf/server exec vitest run src/scripts/org-merge.postgres.test.ts src/scripts/org-merge-credentials.postgres.test.ts src/scripts/legacy-writer.postgres.test.ts --maxWorkers=1
node --test scripts/legacy-schema-compat.test.mjs
```

The credentials test uses a local cryptographic JWT verifier and real PostgreSQL
grant/credential lookup. It does not contact an OAuth provider. Redis is injected.
ClickHouse/queued analytics execution, partition erasure against external storage,
post-merge browser invite/join pages, and the integrating agent's admission races
remain integration acceptance checks; these tests do not claim those outcomes.

## Verification recorded on 2026-11-10

- Base: `2b4909c7`; old writer: `8a3ce21713890bfe99d6e1ed3d4101ba82a71d46`.
- All eight old suites: 105 assertions passed. Raw server-suite teardown fails
  only on the intentional organization-delete restriction. With the cleanup-only
  adapter, all eight suite processes exit zero. The unadapted scripted journey
  passes, as do both new-resolver checks. All 152 surviving old member/site
  roles in the raw-run database matched; all 23 in the adapted-run database
  matched. Zero access mismatches.
- Focused merge/credential/legacy-trigger suite: 21 passed on a fresh database.
- `pnpm turbo run typecheck`: 27 tasks passed.
- `node --test scripts/*.test.mjs`: 131 passed, 20 skipped, zero failures.
- Fresh `migrate deploy`: all 52 migrations applied. Prisma diff has no
  task-owned differences. Four pre-existing schema differences remain unchanged:
  the domain provider index, project add-on and translation `updatedAt` defaults,
  and the usage-provider index's truncated name. These were present before this
  migration and are intentionally outside its scope.

The compatibility rerun caught and fixed rejection of unrepresentable legacy
JSON text. Exact-restore testing caught and fixed JSONB key-order changes, and
zero-website testing covers the non-deferrable unique slug mirror. No provider,
Redis, ClickHouse or production acceptance is inferred from these local checks.
