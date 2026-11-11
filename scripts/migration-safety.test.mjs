import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkMigration, contractOptOut, findContractStatements } from './migration-safety.mjs';

const ids = async (sql) => (await findContractStatements(sql)).map((finding) => finding.id);

test('provably expand-only migrations pass', async () => {
  const sql = `
    -- CreateTable
    CREATE TABLE "edge_record" ("id" TEXT NOT NULL, "revision" INTEGER NOT NULL, CONSTRAINT "edge_record_pkey" PRIMARY KEY ("id"));
    CREATE UNIQUE INDEX "edge_record_revision_key" ON "edge_record"("revision");
    ALTER TABLE "edge_record" ADD CONSTRAINT "edge_record_check" CHECK ("revision" >= 0);
    INSERT INTO "edge_record" ("id", "revision") VALUES ('a', 0);
    ALTER TABLE "project" ADD COLUMN "deliveryRevision" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "note" TEXT;
    ALTER TABLE "project" ADD COLUMN "token" TEXT;
    CREATE UNIQUE INDEX "project_token_key" ON "project"("token");
    ALTER TABLE "project" ADD COLUMN "grantId" TEXT;
    ALTER TABLE "project" ADD CONSTRAINT "project_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "edge_record"("id") ON DELETE SET NULL;
    CREATE INDEX "project_note_idx" ON "project"("note");
    ALTER TABLE "page" ALTER COLUMN "title" DROP NOT NULL, ALTER COLUMN "slug" SET DEFAULT 'x';
    CREATE TYPE "Role" AS ENUM ('A', 'B');
    ALTER TYPE "Kind" ADD VALUE 'NEW';
    BEGIN; SET LOCAL lock_timeout = '5s'; COMMIT;
  `;
  assert.deepEqual(await ids(sql), []);
});

// Sol council regressions on #439: every one of these used to pass.
const cases = [
  ['drop', "SELECT '--'; ALTER TABLE project DROP COLUMN slug;"],
  ['unanalyzable', 'DO $$ BEGIN DROP TABLE project; END $$;'],
  ['retype', 'ALTER TABLE "project" ALTER COLUMN "Order Index" TYPE TEXT;'],
  ['retype', 'ALTER TABLE project ALTER COLUMN "x" SET DATA TYPE BIGINT;'],
  ['tighten-constraint', 'ALTER TABLE "page" ADD CONSTRAINT "page_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id");'],
  ['tighten-constraint', "ALTER TABLE member ADD CHECK (role <> 'x');"],
  ['tighten-constraint', "ALTER TABLE member ADD CONSTRAINT c CHECK (role <> 'x') NOT VALID;"],
  ['tighten-constraint', 'ALTER TABLE member ADD CONSTRAINT u UNIQUE (a, b);'],
  ['tighten-constraint', 'ALTER TABLE member ADD CONSTRAINT u UNIQUE USING INDEX member_ab;'],
  ['data-change', 'UPDATE project SET slug = lower(slug);'],
  ['data-change', 'WITH gone AS (DELETE FROM session RETURNING id) SELECT count(*) FROM gone;'],
  ['data-change', 'DELETE FROM "session";'],
  ['data-change', 'TRUNCATE "job";'],
  ['data-change', "INSERT INTO project (id) VALUES ('x');"],
  ['drop-constraint', 'ALTER TABLE "page" DROP CONSTRAINT "page_projectId_fkey";'],
  ['drop-constraint', 'DROP INDEX "page_slug_idx";'],
  ['tighten-constraint', "ALTER TABLE project ADD COLUMN token TEXT DEFAULT 'fixed'; CREATE UNIQUE INDEX k ON project (token);"],
  ['tighten-constraint', 'ALTER TABLE project ADD COLUMN token TEXT; CREATE UNIQUE INDEX k ON project (token) NULLS NOT DISTINCT;'],
  ['tighten-constraint', 'ALTER TABLE project ADD COLUMN token TEXT; CREATE UNIQUE INDEX k ON project (lower(slug), token);'],
  ['drop', 'CREATE TABLE scratch.project (id int); DROP TABLE public.project;'],
  ['drop', 'CREATE TABLE "Project" (id int); DROP TABLE project;'],
  ['drop', 'DROP TABLE IF EXISTS "waitlist_entry";'],
  ['drop', 'ALTER TABLE project DROP legacy_flag;'],
  ['drop', 'DROP TYPE "Role_old";'],
  ['rename', 'ALTER TABLE "project" RENAME COLUMN "slug" TO "handle";'],
  ['rename', "ALTER TYPE \"Role\" RENAME VALUE 'ADMIN' TO 'OWNER';"],
  ['set-not-null', 'ALTER TABLE "page" ALTER COLUMN "languageId" SET NOT NULL;'],
  ['drop-default', 'ALTER TABLE "page" ALTER COLUMN "slug" DROP DEFAULT;'],
  ['add-required-column', 'ALTER TABLE "project" ADD COLUMN "tenant" TEXT NOT NULL;'],
  ['validate-constraint', 'ALTER TABLE member VALIDATE CONSTRAINT c;'],
  ['unanalyzable', 'CREATE FUNCTION f() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN DELETE FROM x; RETURN NEW; END $f$;'],
  ['unanalyzable', 'CREATE TRIGGER t BEFORE INSERT ON project FOR EACH ROW EXECUTE FUNCTION f();'],
  ['unanalyzable', "SELECT setval('project_id_seq', 1);"],
  ['unknown', 'ALTER TABLE project SET UNLOGGED;'],
  ['unknown', 'GRANT SELECT ON project TO reader;'],
];

for (const [id, sql] of cases) {
  test(`flags ${id}: ${sql}`, async () => {
    const found = await ids(sql);
    assert.ok(found.includes(id), `expected ${id} in ${JSON.stringify(found)}`);
  });
}

test('keywords inside comments and string literals cannot hide or fake a statement', async () => {
  assert.deepEqual(
    await ids("-- DROP TABLE project;\n/* ALTER TABLE page DROP COLUMN title; */\nCREATE TABLE t (note text DEFAULT 'DROP COLUMN x; TRUNCATE y');"),
    [],
  );
});

test('unparseable SQL fails even with an opt-out', async () => {
  const sql = '-- nibleaf-migration: contract reviewed by the team in #439\nALTER TABL project;';
  const result = await checkMigration('m.sql', sql);
  assert.equal(result.ok, false);
  assert.ok(result.parseError);
});

test('the contract opt-out needs a real reason', async () => {
  const statement = 'ALTER TABLE "project" DROP COLUMN "color";';
  assert.equal((await checkMigration('m.sql', statement)).ok, false);
  assert.equal((await checkMigration('m.sql', `-- nibleaf-migration: contract tbd\n${statement}`)).ok, false);
  const marked = `-- nibleaf-migration: contract color unused since release 0.9 (#410)\n${statement}`;
  assert.equal(contractOptOut(marked), 'color unused since release 0.9 (#410)');
  assert.equal((await checkMigration('m.sql', marked)).ok, true);
});

test('every existing migration parses', async () => {
  const root = 'packages/database/prisma/migrations';
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const result = await checkMigration(entry.name, readFileSync(join(root, entry.name, 'migration.sql'), 'utf8'));
    assert.equal(result.parseError, null, entry.name);
  }
});

test('known historical contract migrations are recognised', async () => {
  const sql = readFileSync('packages/database/prisma/migrations/20260710130000_remove_legacy_compatibility/migration.sql', 'utf8');
  const found = await ids(sql);
  assert.ok(found.includes('drop'));
  assert.ok(found.includes('set-not-null'));
});
