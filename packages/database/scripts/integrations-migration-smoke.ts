import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { getDb } from '../src/client';

const connectionString = process.env.POSTGRES_URL;
if (!connectionString) throw new Error('POSTGRES_URL is required for the integrations migration smoke test');

const migration = await readFile(new URL('../prisma/migrations/20260823230000_add_project_integrations/migration.sql', import.meta.url), 'utf8');
const rollback = await readFile(new URL('../prisma/migrations/20260823230000_add_project_integrations/rollback.sql', import.meta.url), 'utf8');
const auditRowsSchema = z.array(z.object({ connectionId: z.string().nullable(), providerId: z.literal('slack') }));
const confirmationRowsSchema = z.array(z.object({ connectionId: z.string().nullable(), consumedAt: z.date(), providerId: z.literal('slack') }));
const countRowsSchema = z.array(z.object({ count: z.bigint() }));
const nameRowsSchema = z.array(z.object({ name: z.string() }));
const prisma = getDb({ connectionString });

try {
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('DROP SCHEMA IF EXISTS integrations_migration_smoke CASCADE; CREATE SCHEMA integrations_migration_smoke');
      await tx.$executeRawUnsafe('SET LOCAL search_path TO integrations_migration_smoke');
      await tx.$executeRawUnsafe('CREATE TABLE project (id TEXT PRIMARY KEY)');
      await tx.$executeRawUnsafe('CREATE TABLE api_key (id TEXT PRIMARY KEY)');
      await tx.$executeRawUnsafe(migration);

      const expiresAtColumns = nameRowsSchema.parse(
        await tx.$queryRawUnsafe(`
          SELECT column_name AS name
          FROM information_schema.columns
          WHERE table_schema = 'integrations_migration_smoke'
            AND table_name = 'api_key'
            AND column_name = 'expiresAt'
        `),
      );
      if (expiresAtColumns.length !== 1) throw new Error('forward migration did not add ApiKey.expiresAt');

      await tx.$executeRawUnsafe(`
        INSERT INTO project (id) VALUES ('project-1');
        INSERT INTO project_integration (
          id, "projectId", "providerId", status, config, "credentialEncrypted", revision,
          "lastVerificationStatus", "createdById", "updatedAt"
        ) VALUES (
          'connection-1', 'project-1', 'slack', 'ACTIVE', '{}', 'encrypted', 4,
          'HEALTHY', 'user-1', now()
        );
        INSERT INTO integration_audit_event (
          id, "connectionId", "projectId", "providerId", "organizationId", "principalType",
          "principalId", action, result
        ) VALUES (
          'audit-1', 'connection-1', 'project-1', 'slack', 'organization-1', 'USER',
          'user-1', 'DELETE', 'SUCCESS'
        );
        INSERT INTO integration_confirmation (
          id, "projectId", "connectionId", "providerId", "connectionRevision", "principalType",
          "principalId", "tokenDigest", "expiresAt", "consumedAt", "createdById"
        ) VALUES (
          'confirmation-1', 'project-1', 'connection-1', 'slack', 4, 'USER',
          'user-1', 'digest', now() + interval '10 minutes', now(), 'user-1'
        );
        INSERT INTO integration_webhook_delivery (
          id, "connectionId", event, "idempotencyDigest", "requestDigest"
        ) VALUES ('delivery-1', 'connection-1', 'verify', 'delivery-digest', 'request-digest');
        DELETE FROM project_integration WHERE id = 'connection-1';
      `);

      const auditRows = auditRowsSchema.parse(
        await tx.$queryRawUnsafe('SELECT "connectionId", "providerId" FROM integration_audit_event WHERE id = \'audit-1\''),
      );
      if (auditRows.length !== 1 || auditRows[0]?.connectionId !== null) {
        throw new Error('audit history did not preserve provider identity after connection deletion');
      }

      const confirmationRows = confirmationRowsSchema.parse(
        await tx.$queryRawUnsafe('SELECT "connectionId", "providerId", "consumedAt" FROM integration_confirmation WHERE id = \'confirmation-1\''),
      );
      if (confirmationRows.length !== 1 || confirmationRows[0]?.connectionId !== null) {
        throw new Error('consumed confirmation tombstone did not survive connection deletion');
      }

      const deliveryRows = countRowsSchema.parse(await tx.$queryRawUnsafe('SELECT count(*) AS count FROM integration_webhook_delivery'));
      if (deliveryRows[0]?.count !== 0n) throw new Error('connection-scoped webhook deliveries did not cascade');

      await tx.$executeRawUnsafe(rollback);
      const remainingIntegrationTables = nameRowsSchema.parse(
        await tx.$queryRawUnsafe(`
          SELECT table_name AS name
          FROM information_schema.tables
          WHERE table_schema = 'integrations_migration_smoke'
            AND table_name LIKE 'integration_%'
        `),
      );
      if (remainingIntegrationTables.length !== 0) throw new Error('rollback retained integration tables');

      const remainingExpiresAtColumns = nameRowsSchema.parse(
        await tx.$queryRawUnsafe(`
          SELECT column_name AS name
          FROM information_schema.columns
          WHERE table_schema = 'integrations_migration_smoke'
            AND table_name = 'api_key'
            AND column_name = 'expiresAt'
        `),
      );
      if (remainingExpiresAtColumns.length !== 0) throw new Error('rollback retained ApiKey.expiresAt');

      await tx.$executeRawUnsafe('SET LOCAL search_path TO public');
      await tx.$executeRawUnsafe('DROP SCHEMA integrations_migration_smoke CASCADE');
    },
    { timeout: 30_000 },
  );
  console.log('Integrations migration, tombstone retention, audit identity, and rollback checks passed.');
} finally {
  await prisma.$disconnect();
}
