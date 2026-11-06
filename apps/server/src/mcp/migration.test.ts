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
    expect(writeMigration).toContain('CREATE INDEX "mcp_audit_event_actorUserId_createdAt_idx" ON "mcp_audit_event"("actorUserId", "createdAt")');
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
