import { readFile } from 'node:fs/promises';
import { projectConfigSchema } from '@nibleaf/validators';
import { z } from 'zod';
import { getDb } from '../src/client';

const connectionString = process.env.POSTGRES_URL;
if (!connectionString) throw new Error('POSTGRES_URL is required for the add-ons migration smoke test');

const migration = await readFile(new URL('../prisma/migrations/20260823220000_project_addons/migration.sql', import.meta.url), 'utf8');
const rollback = await readFile(new URL('../prisma/migrations/20260823220000_project_addons/rollback.sql', import.meta.url), 'utf8');
const rowsSchema = z.array(z.object({ id: z.string(), config: z.unknown() }));
const prisma = getDb({ connectionString });

try {
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('DROP SCHEMA IF EXISTS addons_migration_smoke CASCADE; CREATE SCHEMA addons_migration_smoke');
      await tx.$executeRawUnsafe('SET LOCAL search_path TO addons_migration_smoke');
      await tx.$executeRawUnsafe('CREATE TABLE project (id TEXT PRIMARY KEY, config JSONB)');
      await tx.$executeRawUnsafe(`
        INSERT INTO project (id, config) VALUES
          ('invalid', '{"branding":{"logoLight":null},"analytics":{"cookieConsent":false},"addons":{"editUrl":"ftp://example.com/{path}","issueUrl":"https://example.com/{unknown}"}}'),
          ('missing', '{"branding":{"logoLight":null},"addons":{}}'),
          ('safe', '{"branding":{"logoLight":null},"addons":{"editUrl":"https://example.com/edit/{path}","issueUrl":"https://example.com/issues/new?body={encodedPath}"}}')
      `);

      await tx.$executeRawUnsafe(migration);
      const forwardRows = rowsSchema.parse(await tx.$queryRawUnsafe('SELECT id, config FROM project ORDER BY id'));
      for (const row of forwardRows) {
        const config = projectConfigSchema.parse(row.config);
        if (config.branding?.logoLight !== null) throw new Error(`forward projection recursively stripped a sibling null for ${row.id}`);
        if (row.id !== 'safe' && ('editUrl' in (config.addons ?? {}) || 'issueUrl' in (config.addons ?? {}))) {
          throw new Error(`forward projection retained an absent or invalid URL template for ${row.id}`);
        }
      }
      const safeForward = projectConfigSchema.parse(forwardRows.find((row) => row.id === 'safe')?.config);
      if (!safeForward.addons?.editUrl || !safeForward.addons.issueUrl) throw new Error('forward projection removed validated URL templates');

      await tx.$executeRawUnsafe(`
        UPDATE project
        SET config = jsonb_set(config, '{addons}', (config->'addons') || '{"editUrl":"https://stale.example/edit/{path}","issueUrl":"https://stale.example/issues/{path}"}')
        WHERE id IN ('invalid', 'missing');
        UPDATE project_addon SET config = '{}' WHERE "projectId" IN ('invalid', 'missing') AND key IN ('edit-suggestions', 'issue-links')
      `);
      await tx.$executeRawUnsafe(rollback);

      const rollbackRows = rowsSchema.parse(
        await tx.$queryRawUnsafe("SELECT id, config FROM project WHERE id IN ('invalid', 'missing') ORDER BY id"),
      );
      for (const row of rollbackRows) {
        const config = projectConfigSchema.parse(row.config);
        if (config.branding?.logoLight !== null) throw new Error(`rollback recursively stripped a sibling null for ${row.id}`);
        if ('editUrl' in (config.addons ?? {}) || 'issueUrl' in (config.addons ?? {})) {
          throw new Error(`rollback retained a stale URL template for ${row.id}`);
        }
        if (
          'feedbackPlacement' in (config.addons ?? {}) ||
          'feedbackPresentation' in (config.addons ?? {}) ||
          'consentBanner' in (config.addons ?? {})
        ) {
          throw new Error(`rollback retained add-on-only presentation settings for ${row.id}`);
        }
      }

      await tx.$executeRawUnsafe('SET LOCAL search_path TO public');
      await tx.$executeRawUnsafe('DROP SCHEMA addons_migration_smoke CASCADE');
    },
    { timeout: 30_000 },
  );
  console.log('Add-ons migration and rollback projections passed runtime schema validation.');
} finally {
  await prisma.$disconnect();
}
