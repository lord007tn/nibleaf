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
