import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationDirectory = new URL('../../../../packages/database/prisma/migrations/20260823240000_mcp_control_plane/', import.meta.url);
const migration = readFileSync(new URL('migration.sql', migrationDirectory), 'utf8');
const rollback = readFileSync(new URL('rollback.sql', migrationDirectory), 'utf8');

describe('MCP migration safety contract', () => {
  it('removes only wildcard authority while preserving known and unknown legacy scopes', () => {
    expect(migration).toContain("WHERE scope <> '*'");
    expect(migration).toContain('unnest("api_key"."scopes" || ARRAY');
    expect(migration).toContain('WHERE \'*\' = ANY("scopes")');
  });

  it('rolls MCP-owned schema back in foreign-key-safe order without dropping the shared expiry column', () => {
    expect(migration).not.toMatch(/ADD\s+COLUMN\s+"expiresAt"/i);
    expect(rollback.indexOf('DROP CONSTRAINT IF EXISTS "mcp_audit_event_projectId_fkey"')).toBeLessThan(
      rollback.indexOf('DROP TABLE IF EXISTS "mcp_audit_event"'),
    );
    expect(rollback.indexOf('DROP CONSTRAINT IF EXISTS "api_key_createdById_fkey"')).toBeLessThan(
      rollback.indexOf('DROP COLUMN IF EXISTS "createdById"'),
    );
    expect(rollback).toContain('DROP COLUMN IF EXISTS "rotatedFromId"');
    expect(rollback).not.toMatch(/DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?"expiresAt"/i);
    expect(rollback).toContain('Wildcard normalization is also intentionally not reversed');
  });
});

const writeMigrationDirectory = new URL(
  '../../../../packages/database/prisma/migrations/20261106090000_mcp_write_audit_idempotency/',
  import.meta.url,
);
const writeMigration = readFileSync(new URL('migration.sql', writeMigrationDirectory), 'utf8');
const writeRollback = readFileSync(new URL('rollback.sql', writeMigrationDirectory), 'utf8');

describe('MCP write-path migration contract', () => {
  it('adds only nullable attribution columns to existing audit rows', () => {
    for (const column of ['actorUserId', 'targetType', 'targetId', 'clientRequestId']) {
      expect(writeMigration).toMatch(new RegExp(`ADD COLUMN "${column}" TEXT[,;]\n`));
    }
    expect(writeMigration).not.toMatch(/ALTER TABLE "mcp_audit_event"[^;]*NOT NULL/);
    // No blocking index build on the existing audit table in a migration that also does other work.
    expect(writeMigration).not.toMatch(/CREATE INDEX[^;]*ON "mcp_audit_event"/);
  });

  it('keys the replay cache uniquely per key, operation, and clientRequestId and never stores content columns', () => {
    expect(writeMigration).toContain('ON "mcp_idempotency_record"("apiKeyId", "operation", "clientRequestId")');
    expect(writeMigration).toMatch(/CREATE UNIQUE INDEX "mcp_idempotency_record_apiKeyId_operation_clientRequestId_key"/);
    expect(writeMigration).not.toMatch(/"(content|markdown|title|arguments)"/);
  });

  it('rolls back the cache before dropping the audit columns', () => {
    expect(writeRollback.indexOf('DROP CONSTRAINT IF EXISTS "mcp_idempotency_record_projectId_fkey"')).toBeLessThan(
      writeRollback.indexOf('DROP TABLE IF EXISTS "mcp_idempotency_record"'),
    );
    for (const column of ['actorUserId', 'targetType', 'targetId', 'clientRequestId'])
      expect(writeRollback).toContain(`DROP COLUMN IF EXISTS "${column}"`);
  });
});

describe('MCP audit index migrations', () => {
  const migrationsRoot = new URL('../../../../packages/database/prisma/migrations/', import.meta.url);
  it.each([
    ['20261106130000_mcp_audit_actor_index', 'mcp_audit_event_actorUserId_createdAt_idx', '"actorUserId", "createdAt"'],
    ['20261106130100_mcp_audit_oauth_grant_index', 'mcp_audit_event_oauthGrantId_createdAt_idx', '"oauthGrantId", "createdAt"'],
  ])('%s builds its audit index concurrently, alone', (directory, index, columns) => {
    const sql = readFileSync(new URL(`${directory}/migration.sql`, migrationsRoot), 'utf8');
    const statements = sql
      .split('\n')
      .filter((line) => !line.startsWith('--') && line.trim() !== '')
      .join('\n')
      .split(';')
      .filter((statement) => statement.trim() !== '');
    // CONCURRENTLY cannot run in a transaction, so the file must hold exactly this one statement.
    expect(statements).toHaveLength(1);
    expect(statements[0]?.trim()).toBe(`CREATE INDEX CONCURRENTLY IF NOT EXISTS "${index}" ON "mcp_audit_event"(${columns})`);
    expect(readFileSync(new URL(`${directory}/rollback.sql`, migrationsRoot), 'utf8')).toContain(`DROP INDEX CONCURRENTLY IF EXISTS "${index}"`);
  });
});

const oauthMigrationDirectory = new URL('../../../../packages/database/prisma/migrations/20261106120000_mcp_oauth/', import.meta.url);
const oauthMigration = readFileSync(new URL('migration.sql', oauthMigrationDirectory), 'utf8');
const oauthRollback = readFileSync(new URL('rollback.sql', oauthMigrationDirectory), 'utf8');

describe('MCP OAuth migration contract', () => {
  it('creates every Better Auth plugin table and the project grant', () => {
    for (const table of [
      'jwks',
      'oauth_client',
      'oauth_resource',
      'oauth_client_resource',
      'oauth_refresh_token',
      'oauth_access_token',
      'oauth_consent',
      'oauth_client_assertion',
      'mcp_oauth_grant',
    ])
      expect(oauthMigration).toContain(`CREATE TABLE "${table}"`);
    expect(oauthMigration).toContain('CREATE UNIQUE INDEX "oauth_client_resource_clientId_resourceId_key"');
  });

  it('only adds nullable grant columns to existing MCP tables', () => {
    expect(oauthMigration).toMatch(/ALTER TABLE "mcp_audit_event" ADD COLUMN\s+"oauthGrantId" TEXT;/);
    expect(oauthMigration).toMatch(/ALTER TABLE "mcp_idempotency_record" ADD COLUMN\s+"oauthGrantId" TEXT,\nALTER COLUMN "apiKeyId" DROP NOT NULL;/);
    expect(oauthMigration).not.toMatch(/ALTER TABLE "(?:api_key|user|session|member|project)"/);
    expect(oauthMigration).not.toMatch(/DELETE FROM|^UPDATE /m);
  });

  it('rolls back OAuth replay rows before requiring apiKeyId again, and drops children first', () => {
    expect(oauthRollback.indexOf('DELETE FROM "mcp_idempotency_record" WHERE "apiKeyId" IS NULL')).toBeLessThan(
      oauthRollback.indexOf('ALTER COLUMN "apiKeyId" SET NOT NULL'),
    );
    expect(oauthRollback.indexOf('DROP TABLE IF EXISTS "mcp_oauth_grant"')).toBeLessThan(
      oauthRollback.indexOf('DROP TABLE IF EXISTS "oauth_client";'),
    );
    expect(oauthRollback.indexOf('DROP TABLE IF EXISTS "oauth_access_token"')).toBeLessThan(
      oauthRollback.indexOf('DROP TABLE IF EXISTS "oauth_refresh_token"'),
    );
  });
});
