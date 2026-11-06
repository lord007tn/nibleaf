import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { getDb } from '../src/client';

const connectionString = process.env.POSTGRES_URL;
if (!connectionString) throw new Error('POSTGRES_URL is required for the MCP migration smoke test');

const migrationDirectory = new URL('../prisma/migrations/20260823240000_mcp_control_plane/', import.meta.url);
const migration = await readFile(new URL('migration.sql', migrationDirectory), 'utf8');
const rollback = await readFile(new URL('rollback.sql', migrationDirectory), 'utf8');
const writeMigrationDirectory = new URL('../prisma/migrations/20261106090000_mcp_write_audit_idempotency/', import.meta.url);
const writeMigration = await readFile(new URL('migration.sql', writeMigrationDirectory), 'utf8');
const writeRollback = await readFile(new URL('rollback.sql', writeMigrationDirectory), 'utf8');
const oauthMigrationDirectory = new URL('../prisma/migrations/20261106120000_mcp_oauth/', import.meta.url);
const oauthMigration = await readFile(new URL('migration.sql', oauthMigrationDirectory), 'utf8');
const oauthRollback = await readFile(new URL('rollback.sql', oauthMigrationDirectory), 'utf8');
const nullableRowsSchema = z.array(z.object({ nullable: z.string() }));
const nameRowsSchema = z.array(z.object({ name: z.string() }));
const scopeRowsSchema = z.array(z.object({ scopes: z.array(z.string()) }));
const prisma = getDb({ connectionString });

try {
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('DROP SCHEMA IF EXISTS mcp_migration_smoke CASCADE; CREATE SCHEMA mcp_migration_smoke');
      await tx.$executeRawUnsafe('SET LOCAL search_path TO mcp_migration_smoke');
      await tx.$executeRawUnsafe(`
        CREATE TABLE "user" (id TEXT PRIMARY KEY);
        CREATE TABLE project (id TEXT PRIMARY KEY);
        CREATE TABLE session (id TEXT PRIMARY KEY);
        CREATE TABLE api_key (
          id TEXT PRIMARY KEY,
          scopes TEXT[] NOT NULL,
          "expiresAt" TIMESTAMP(3)
        );
        INSERT INTO "user" (id) VALUES ('user-1');
        INSERT INTO project (id) VALUES ('project-1');
        INSERT INTO api_key (id, scopes, "expiresAt") VALUES (
          'key-1', ARRAY['*', 'custom:legacy'], now() + interval '30 days'
        );
      `);
      await tx.$executeRawUnsafe(migration);

      const forwardScopes = scopeRowsSchema.parse(await tx.$queryRawUnsafe("SELECT scopes FROM api_key WHERE id = 'key-1'"));
      const scopes = forwardScopes[0]?.scopes ?? [];
      if (scopes.includes('*') || scopes.includes('mcp:connect')) throw new Error('wildcard normalization elevated MCP authority');
      for (const expected of ['custom:legacy', 'projects:read', 'pages:read', 'languages:read', 'versions:read']) {
        if (!scopes.includes(expected)) throw new Error(`wildcard normalization did not preserve ${expected}`);
      }

      await tx.$executeRawUnsafe(`
        INSERT INTO mcp_audit_event (
          id, "projectId", "apiKeyId", "requestId", kind, operation,
          capability, outcome, "durationMs"
        ) VALUES (
          'audit-1', 'project-1', 'key-1', 'request-1', 'tool',
          'get_project', 'projects:read', 'succeeded', 1
        );
      `);

      // The write-path migration adds attribution columns to existing audit
      // rows and the idempotency cache, whose unique key must reject a second
      // in-flight record for the same key/operation/clientRequestId.
      await tx.$executeRawUnsafe(writeMigration);
      await tx.$executeRawUnsafe(`
        INSERT INTO mcp_audit_event (
          id, "projectId", "apiKeyId", "actorUserId", "requestId", kind, operation,
          capability, outcome, "targetType", "targetId", "clientRequestId", "durationMs"
        ) VALUES (
          'audit-2', 'project-1', 'key-1', 'user-1', 'request-2', 'tool',
          'update_page', 'pages:write', 'succeeded', 'page', 'page-1', 'retry-0001', 1
        );
        INSERT INTO mcp_idempotency_record (
          id, "projectId", "apiKeyId", operation, "clientRequestId", "argsHash", status, "expiresAt"
        ) VALUES (
          'idem-1', 'project-1', 'key-1', 'update_page', 'retry-0001', 'hash', 'pending', now() + interval '1 day'
        );
      `);
      await tx.$executeRawUnsafe('SAVEPOINT duplicate_idempotency_key');
      let duplicateRejected = false;
      try {
        await tx.$executeRawUnsafe(`
          INSERT INTO mcp_idempotency_record (
            id, "projectId", "apiKeyId", operation, "clientRequestId", "argsHash", status, "expiresAt"
          ) VALUES (
            'idem-2', 'project-1', 'key-1', 'update_page', 'retry-0001', 'other', 'pending', now() + interval '1 day'
          );
        `);
      } catch {
        duplicateRejected = true;
      }
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT duplicate_idempotency_key');
      if (!duplicateRejected) throw new Error('MCP idempotency cache accepted a duplicate clientRequestId');

      // The OAuth migration adds a grant column beside apiKeyId: an OAuth replay
      // row has no API key, keeps its own unique key, and audit rows name the
      // grant. Its rollback must restore the API-key requirement.
      await tx.$executeRawUnsafe(oauthMigration);
      await tx.$executeRawUnsafe(`
        INSERT INTO oauth_client (id, "clientId", "redirectUris") VALUES ('client-row-1', 'client-1', ARRAY['https://claude.ai/api/mcp/auth_callback']);
        INSERT INTO mcp_oauth_grant (id, "userId", "projectId", "clientId", "clientName", preset, scopes)
        VALUES ('grant-1', 'user-1', 'project-1', 'client-1', 'Claude', 'read_only', ARRAY['mcp:connect']);
        INSERT INTO mcp_audit_event (id, "projectId", "oauthGrantId", "actorUserId", "requestId", kind, operation, capability, outcome, "durationMs")
        VALUES ('audit-3', 'project-1', 'grant-1', 'user-1', 'request-3', 'tool', 'get_project', 'projects:read', 'succeeded', 1);
        INSERT INTO mcp_idempotency_record (id, "projectId", "oauthGrantId", operation, "clientRequestId", "argsHash", status, "expiresAt")
        VALUES ('idem-oauth-1', 'project-1', 'grant-1', 'update_page', 'retry-0001', 'hash', 'pending', now() + interval '1 day');
      `);
      await tx.$executeRawUnsafe('SAVEPOINT duplicate_oauth_idempotency_key');
      let duplicateOAuthRejected = false;
      try {
        await tx.$executeRawUnsafe(`
          INSERT INTO mcp_idempotency_record (id, "projectId", "oauthGrantId", operation, "clientRequestId", "argsHash", status, "expiresAt")
          VALUES ('idem-oauth-2', 'project-1', 'grant-1', 'update_page', 'retry-0001', 'other', 'pending', now() + interval '1 day');
        `);
      } catch {
        duplicateOAuthRejected = true;
      }
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT duplicate_oauth_idempotency_key');
      if (!duplicateOAuthRejected) throw new Error('MCP idempotency cache accepted a duplicate OAuth clientRequestId');

      await tx.$executeRawUnsafe(oauthRollback);
      const remainingOAuthTables = nameRowsSchema.parse(
        await tx.$queryRawUnsafe(`
          SELECT table_name AS name
          FROM information_schema.tables
          WHERE table_schema = 'mcp_migration_smoke' AND (table_name LIKE 'oauth_%' OR table_name IN ('jwks', 'mcp_oauth_grant'))
        `),
      );
      if (remainingOAuthTables.length !== 0) throw new Error('OAuth rollback retained OAuth tables');
      const apiKeyNullability = nullableRowsSchema.parse(
        await tx.$queryRawUnsafe(`
          SELECT is_nullable AS nullable
          FROM information_schema.columns
          WHERE table_schema = 'mcp_migration_smoke' AND table_name = 'mcp_idempotency_record' AND column_name = 'apiKeyId'
        `),
      );
      if (apiKeyNullability[0]?.nullable !== 'NO') throw new Error('OAuth rollback did not restore the apiKeyId requirement');

      await tx.$executeRawUnsafe(writeRollback);
      const remainingWriteColumns = nameRowsSchema.parse(
        await tx.$queryRawUnsafe(`
          SELECT column_name AS name
          FROM information_schema.columns
          WHERE table_schema = 'mcp_migration_smoke'
            AND table_name = 'mcp_audit_event'
            AND column_name IN ('actorUserId', 'targetType', 'targetId', 'clientRequestId')
        `),
      );
      if (remainingWriteColumns.length !== 0) throw new Error('write-path rollback retained MCP audit attribution columns');

      await tx.$executeRawUnsafe(rollback);
      const remainingMcpTables = nameRowsSchema.parse(
        await tx.$queryRawUnsafe(`
          SELECT table_name AS name
          FROM information_schema.tables
          WHERE table_schema = 'mcp_migration_smoke'
            AND table_name IN ('mcp_audit_event', 'mcp_idempotency_record')
        `),
      );
      if (remainingMcpTables.length !== 0) throw new Error('rollback retained MCP audit or idempotency storage');

      const remainingMcpColumns = nameRowsSchema.parse(
        await tx.$queryRawUnsafe(`
          SELECT column_name AS name
          FROM information_schema.columns
          WHERE table_schema = 'mcp_migration_smoke'
            AND table_name = 'api_key'
            AND column_name IN ('createdById', 'rotatedFromId')
        `),
      );
      if (remainingMcpColumns.length !== 0) throw new Error('rollback retained MCP-owned API-key columns');

      const expiryColumns = nameRowsSchema.parse(
        await tx.$queryRawUnsafe(`
          SELECT column_name AS name
          FROM information_schema.columns
          WHERE table_schema = 'mcp_migration_smoke'
            AND table_name = 'api_key'
            AND column_name = 'expiresAt'
        `),
      );
      if (expiryColumns.length !== 1) throw new Error('MCP rollback removed the integrations-owned ApiKey.expiresAt column');

      const rollbackScopes = scopeRowsSchema.parse(await tx.$queryRawUnsafe("SELECT scopes FROM api_key WHERE id = 'key-1'"));
      if ((rollbackScopes[0]?.scopes ?? []).includes('*')) throw new Error('rollback restored wildcard authority');
      if (!(rollbackScopes[0]?.scopes ?? []).includes('custom:legacy')) throw new Error('rollback lost an unknown legacy scope');

      await tx.$executeRawUnsafe('SET LOCAL search_path TO public');
      await tx.$executeRawUnsafe('DROP SCHEMA mcp_migration_smoke CASCADE');
    },
    { timeout: 30_000 },
  );
  console.log('MCP migration ownership, wildcard normalization, audit, idempotency, OAuth, and rollback checks passed.');
} finally {
  await prisma.$disconnect();
}
