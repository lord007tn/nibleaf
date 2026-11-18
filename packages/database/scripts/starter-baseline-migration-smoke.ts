import assert from 'node:assert/strict';
import { starterBodyHash } from '../../auth/src/starter-body.server';
import { getDb } from '../src/client';

// Run `before` on the baseline migrations, then `after` after migrate deploy.
// This script only accepts the explicitly owned disposable #544 database.
const connectionString = process.env.POSTGRES_URL;
const target = connectionString ? new URL(connectionString) : null;
if (!connectionString || target?.pathname !== '/nibleaf_544_disposable' || target.hostname !== '127.0.0.1' || target.port !== '55484') {
  throw new Error('Use the owned nibleaf_544_disposable database only');
}
const db = getDb({ connectionString });
const ids = {
  org: 'fictional-544-org',
  project: 'fictional-544-old-project',
  language: 'fictional-544-language',
  branch: 'fictional-544-branch',
  page: 'fictional-544-page',
};
const body = 'Fictional existing body.\r\n\nمرحبا {{ product }}\t';
const storedAt = new Date('2026-01-01T00:00:00.000Z');

try {
  if (process.argv[2] === 'before') {
    assert.equal(
      await db.$queryRaw`SELECT to_regclass('public.project_starter_baseline')::text AS table_name`.then(
        (rows) => (rows as { table_name: string | null }[])[0]?.table_name,
      ),
      null,
    );
    await db.$transaction(async (tx) => {
      await tx.organization.create({ data: { id: ids.org, name: 'Fictional migration fixture', slug: ids.org } });
      await tx.project.create({
        data: {
          id: ids.project,
          organizationId: ids.org,
          dataTenantId: 'fictional-544-tenant',
          name: 'Existing fictional project',
          slug: ids.project,
        },
      });
      await tx.language.create({
        data: { id: ids.language, projectId: ids.project, code: 'ar', label: 'Arabic', direction: 'RTL', isDefault: true },
      });
      await tx.branch.create({ data: { id: ids.branch, projectId: ids.project, name: 'main', isDefault: true } });
      await tx.page.create({
        data: {
          id: ids.page,
          projectId: ids.project,
          languageId: ids.language,
          branchId: ids.branch,
          title: 'Fictional existing page',
          slug: 'existing',
          path: 'existing',
          content: body,
          createdAt: storedAt,
          updatedAt: storedAt,
        },
      });
      await tx.pageRevision.create({
        data: {
          id: 'fictional-544-revision',
          projectId: ids.project,
          pageId: ids.page,
          title: 'Fictional revision',
          content: body,
          contentBytes: Buffer.byteLength('Fictional revision') + Buffer.byteLength(body),
          reason: 'autosave',
          createdAt: storedAt,
        },
      });
    });
    console.log('Before migration: fictional page, relations and history persisted; baseline table absent.');
  } else if (process.argv[2] === 'after') {
    const page = await db.page.findUniqueOrThrow({ where: { id: ids.page } });
    assert.equal(page.content, body);
    assert.equal(page.projectId, ids.project);
    assert.equal((await db.project.findUniqueOrThrow({ where: { id: ids.project } })).dataTenantId, 'fictional-544-tenant');
    assert.equal(page.title, 'Fictional existing page');
    assert.equal(page.slug, 'existing');
    assert.equal(page.path, 'existing');
    assert.equal(page.parentId, null);
    assert.equal(page.config, null);
    assert.equal(page.languageId, ids.language);
    assert.equal(page.branchId, ids.branch);
    assert.equal(page.createdAt.toISOString(), storedAt.toISOString());
    assert.equal(page.updatedAt.toISOString(), storedAt.toISOString());
    assert.equal((await db.pageRevision.findUniqueOrThrow({ where: { id: 'fictional-544-revision' } })).content, body);
    assert.equal(await db.projectStarterBaseline.count({ where: { projectId: ids.project } }), 0);
    const { createStarterPages, hasRealPageContent } = await import('../../../apps/server/src/actions/project-starters');
    const projectId = 'fictional-544-new-project';
    await db.$transaction(async (tx) => {
      await tx.project.create({ data: { id: projectId, organizationId: ids.org, name: 'New fictional project', slug: projectId } });
      const language = await tx.language.create({ data: { projectId, code: 'ar', label: 'Arabic', direction: 'RTL', isDefault: true } });
      const branch = await tx.branch.create({ data: { projectId, name: 'main', isDefault: true } });
      await createStarterPages(tx, projectId, branch.id, language.id, 'ar', 'product-docs');
    });
    const pages = await db.page.findMany({ where: { projectId } });
    const baselines = await db.projectStarterBaseline.findMany({ where: { projectId } });
    assert.equal(pages.length, 4);
    assert.deepEqual(new Set(baselines.map((row) => row.bodyHash)), new Set(pages.map((row) => starterBodyHash(row.content))));
    assert.equal(hasRealPageContent(pages, baselines), false);
    // The PK implements set semantics even if creation sees an identical body twice.
    await db.projectStarterBaseline.createMany({
      data: baselines.map(({ projectId, bodyHash, starterKey }) => ({ projectId, bodyHash, starterKey })),
      skipDuplicates: true,
    });
    assert.equal(await db.projectStarterBaseline.count({ where: { projectId } }), baselines.length);
    await db.project.delete({ where: { id: projectId } });
    assert.equal(await db.projectStarterBaseline.count({ where: { projectId } }), 0);
    assert.equal((await db.page.findUniqueOrThrow({ where: { id: ids.page } })).content, body);
    assert.equal(await db.projectStarterBaseline.count({ where: { projectId: ids.project } }), 0);
    console.log(
      'After migration: existing bytes, IDs, language/branch relations, timestamps and history preserved; no legacy backfill; actual starter hashes read back; set uniqueness and project cascade verified.',
    );
  } else {
    throw new Error('Expected before or after');
  }
} finally {
  await db.$disconnect();
}
