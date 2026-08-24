import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { getDb } from '../src/client';

const connectionString = process.env.POSTGRES_URL;
if (!connectionString) throw new Error('POSTGRES_URL is required for the MCP migration smoke test');

const migrationDirectory = new URL('../prisma/migrations/20260823240000_mcp_control_plane/', import.meta.url);
const migration = await readFile(new URL('migration.sql', migrationDirectory), 'utf8');
const rollback = await readFile(new URL('rollback.sql', migrationDirectory), 'utf8');
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

      await tx.$executeRawUnsafe(rollback);
      const remainingMcpTables = nameRowsSchema.parse(
        await tx.$queryRawUnsafe(`
          SELECT table_name AS name
          FROM information_schema.tables
          WHERE table_schema = 'mcp_migration_smoke'
            AND table_name = 'mcp_audit_event'
        `),
      );
      if (remainingMcpTables.length !== 0) throw new Error('rollback retained MCP audit storage');

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
  console.log('MCP migration ownership, wildcard normalization, audit, and rollback checks passed.');
} finally {
  await prisma.$disconnect();
}
