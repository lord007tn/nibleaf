import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkMigration, contractOptOut, findContractStatements } from './migration-safety.mjs';

const ids = (sql) => findContractStatements(sql).map((finding) => finding.id);

test('expand-only migrations pass', () => {
  const sql = `
    -- CreateTable
    CREATE TABLE "edge_record" ("id" TEXT NOT NULL, "revision" INTEGER NOT NULL, CONSTRAINT "edge_record_pkey" PRIMARY KEY ("id"));
    CREATE UNIQUE INDEX "edge_record_revision_key" ON "edge_record"("revision");
    ALTER TABLE "project" ADD COLUMN "deliveryRevision" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "note" TEXT;
    ALTER TABLE "project" ADD COLUMN "token" TEXT;
    CREATE UNIQUE INDEX "project_token_key" ON "project"("token");
    CREATE INDEX "project_note_idx" ON "project"("note");
    ALTER TABLE "page" ALTER COLUMN "title" DROP NOT NULL, ALTER COLUMN "slug" DROP DEFAULT;
    ALTER TABLE "page" DROP CONSTRAINT "page_projectId_fkey";
    ALTER TABLE "page" ADD CONSTRAINT "page_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE RESTRICT;
    ALTER TABLE "member" ADD CONSTRAINT "member_role_check" CHECK ("role" <> 'x') NOT VALID;
    DROP INDEX "old_idx";
    CREATE TEMP TABLE _scratch AS SELECT 1; DROP TABLE _scratch;
  `;
  assert.deepEqual(ids(sql), []);
});

test('keywords inside comments, strings and function bodies are ignored', () => {
  const sql = `
    -- DROP TABLE "project";
    /* ALTER TABLE "page" DROP COLUMN "title"; */
    INSERT INTO audit VALUES ('DROP COLUMN x; TRUNCATE y');
    CREATE OR REPLACE FUNCTION keep_member() RETURNS trigger AS $fn$
    BEGIN
      DELETE FROM project_member WHERE "userId" = NEW."userId";
      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;
    DO $$ BEGIN TRUNCATE tmp; END $$;
  `;
  assert.deepEqual(ids(sql), []);
});

for (const [id, sql] of [
  ['drop-table', 'DROP TABLE IF EXISTS "waitlist_entry";'],
  ['drop-column', 'ALTER TABLE "project" DROP COLUMN "color", DROP COLUMN "theme";'],
  ['drop-column', 'ALTER TABLE project DROP legacy_flag;'],
  ['rename', 'ALTER TABLE "project" RENAME COLUMN "slug" TO "handle";'],
  ['rename', "ALTER TYPE \"Role\" RENAME VALUE 'ADMIN' TO 'OWNER';"],
  ['retype', 'ALTER TABLE "page" ALTER COLUMN "order" SET DATA TYPE BIGINT;'],
  ['retype', 'ALTER TABLE "page" ALTER COLUMN "order" TYPE TEXT USING "order"::text;'],
  ['drop-type', 'DROP TYPE "Role_old";'],
  ['set-not-null', 'ALTER TABLE "page" ALTER COLUMN "languageId" SET NOT NULL;'],
  ['add-required-column', 'ALTER TABLE "project" ADD COLUMN "tenant" TEXT NOT NULL;'],
  ['tighten-unique-or-check', 'CREATE UNIQUE INDEX "project_slug_key" ON "project"("slug");'],
  ['tighten-unique-or-check', 'ALTER TABLE "member" ADD CONSTRAINT "member_role_check" CHECK ("role" IN (\'a\'));'],
  ['tighten-unique-or-check', 'ALTER TABLE "member" ADD CONSTRAINT "member_pair_key" UNIQUE ("a", "b");'],
  ['delete-data', 'DELETE FROM "session";'],
  ['delete-data', 'TRUNCATE "job";'],
]) {
  test(`flags ${id}: ${sql}`, () => {
    assert.ok(ids(sql).includes(id), `expected ${id} in ${JSON.stringify(ids(sql))}`);
  });
}

test('a new column in a unique index stays safe unless NULLS NOT DISTINCT', () => {
  const base = 'ALTER TABLE "r" ADD COLUMN "grantId" TEXT;';
  assert.deepEqual(ids(`${base} CREATE UNIQUE INDEX "k" ON "r"("grantId", "op");`), []);
  assert.deepEqual(ids(`${base} CREATE UNIQUE INDEX "k" ON "r"("grantId", "op") NULLS NOT DISTINCT;`), ['tighten-unique-or-check']);
});

test('the contract opt-out needs a real reason', () => {
  const statement = 'ALTER TABLE "project" DROP COLUMN "color";';
  assert.equal(checkMigration('m.sql', statement).ok, false);
  assert.equal(checkMigration('m.sql', `-- nibleaf-migration: contract tbd\n${statement}`).ok, false);
  const marked = `-- nibleaf-migration: contract color unused since release 0.9 (#410)\n${statement}`;
  assert.equal(contractOptOut(marked), 'color unused since release 0.9 (#410)');
  assert.equal(checkMigration('m.sql', marked).ok, true);
});

test('every existing migration parses without throwing', () => {
  const root = 'packages/database/prisma/migrations';
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sql = readFileSync(join(root, entry.name, 'migration.sql'), 'utf8');
    assert.doesNotThrow(() => findContractStatements(sql), entry.name);
  }
});

test('known historical contract migrations are recognised', () => {
  const sql = readFileSync('packages/database/prisma/migrations/20260710130000_remove_legacy_compatibility/migration.sql', 'utf8');
  assert.ok(ids(sql).includes('drop-column'));
  assert.ok(ids(sql).includes('set-not-null'));
});
