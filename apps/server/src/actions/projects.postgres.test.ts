import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/auth/tenant-erasure', () => ({
  eraseProject: vi.fn(),
  TenantErasureProjectNotFoundError: class extends Error {},
  TenantUsageDeletionPendingError: class extends Error {},
}));
vi.mock('@/env', () => ({
  env: { APP_URL: 'https://dashboard.example.test', API_URL: 'https://gateway.example.test', SITE_BASE_DOMAIN: 'sites.example.test' },
}));

// Explicit opt-in against an owned, migrated test database. No storage, queue or
// publish operations run; project creation, unique constraints and rollback are real.
describe.skipIf(process.env.CREATE_SITE_POSTGRES !== '1')('site creation on PostgreSQL', () => {
  let db: typeof import('@nibleaf/database');
  let actions: typeof import('./projects');
  const run = `c442-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const userId = `${run}-owner`;
  const orgIds = [`${run}-org-a`, `${run}-org-b`];
  const auditSql = readFileSync(new URL('../sql/reserved-project-slugs.sql', import.meta.url), 'utf8');

  beforeAll(async () => {
    db = await import('@nibleaf/database');
    actions = await import('./projects');
    await db.prisma.user.create({ data: { id: userId, name: 'Council fixture owner', email: `${run}@example.invalid`, emailVerified: true } });
    for (const id of orgIds) {
      await db.prisma.organization.create({
        data: { id, name: `Council fixture ${id}`, slug: id, handles: { create: { slug: id, current: true } } },
      });
      await db.prisma.member.create({ data: { organizationId: id, userId, role: 'owner', orgRole: 'owner' } });
    }
    const identity = await db.prisma.$queryRaw<Array<{ database: string }>>`SELECT current_database() AS database`;
    expect(identity[0]?.database).toBe(new URL(process.env.POSTGRES_URL ?? '').pathname.slice(1));
  }, 120_000);

  afterAll(async () => {
    if (!db) return;
    await db.prisma.project.deleteMany({ where: { organizationId: { in: orgIds } } });
    await db.prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await db.prisma.user.deleteMany({ where: { id: userId } });
    await db.prisma.$disconnect();
  });

  it('arbitrates a cross-organization slug race with the global DB constraint and a non-sequential typed 409', async () => {
    const slug = `${run}-race`;
    const results = await Promise.allSettled(
      orgIds.map((organizationId) =>
        actions.createProject(userId, { organizationId, name: `Race ${organizationId}`, slug, language: 'ar', starter: 'blank' }),
      ),
    );
    const winners = results.filter((result) => result.status === 'fulfilled');
    const failures = results.filter((result) => result.status === 'rejected');
    expect(winners).toHaveLength(1);
    expect(failures).toHaveLength(1);
    const failure = failures[0];
    if (failure?.status !== 'rejected') throw new Error('Expected a real unique-constraint loser');
    expect(failure.reason).toMatchObject({ status: 409, code: 'database:conflict', details: { reason: 'slug_taken', slug } });
    expect(failure.reason.details.suggestedSlug).toMatch(new RegExp(`^${slug}-[a-f0-9]{8}$`));
    expect(await db.prisma.project.count({ where: { slug } })).toBe(1);
    const winner = winners[0];
    if (winner?.status !== 'fulfilled') throw new Error('Expected a committed winner');
    expect(winner.value.dataTenantId).not.toBe(winner.value.organizationId);
    expect(winner.value.dataTenantId).not.toBe(winner.value.id);
    expect(await db.prisma.language.findFirst({ where: { projectId: winner.value.id, isDefault: true } })).toMatchObject({
      code: 'ar',
      direction: 'RTL',
    });
    expect(await db.prisma.page.findUnique({ where: { id: winner.value.firstPageId ?? '' } })).toMatchObject({
      projectId: winner.value.id,
      title: 'مرحباً',
    });
  });

  it('rolls back project, language, branch, pages and add-ons after a real second-page insertion failure', async () => {
    const name = `${run}-injected-rollback`;
    const functionName = `reject_${run.replaceAll('-', '_')}`;
    const scope = { project: { organizationId: { in: orgIds } } };
    const before = await Promise.all([
      db.prisma.project.count({ where: { organizationId: { in: orgIds } } }),
      db.prisma.language.count({ where: scope }),
      db.prisma.branch.count({ where: scope }),
      db.prisma.page.count({ where: scope }),
      db.prisma.projectAddon.count({ where: scope }),
    ]);
    await db.prisma.$executeRawUnsafe(
      `CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.slug = 'getting-started' AND EXISTS (SELECT 1 FROM project WHERE id = NEW."projectId" AND name = '${name}') THEN RAISE EXCEPTION 'injected second starter page failure'; END IF; RETURN NEW; END $$`,
    );
    await db.prisma.$executeRawUnsafe(`CREATE TRIGGER "${functionName}" BEFORE INSERT ON page FOR EACH ROW EXECUTE FUNCTION "${functionName}"()`);
    try {
      await expect(
        actions.createProject(userId, { organizationId: orgIds[0], name, slug: `${run}-rollback`, language: 'ar', starter: 'product-docs' }),
      ).rejects.toThrow();
      expect(await db.prisma.project.findFirst({ where: { slug: `${run}-rollback` } })).toBeNull();
      const after = await Promise.all([
        db.prisma.project.count({ where: { organizationId: { in: orgIds } } }),
        db.prisma.language.count({ where: scope }),
        db.prisma.branch.count({ where: scope }),
        db.prisma.page.count({ where: scope }),
        db.prisma.projectAddon.count({ where: scope }),
      ]);
      expect(after).toEqual(before);
      expect(await db.prisma.organization.count({ where: { id: { in: orgIds } } })).toBe(2);
      expect(await db.prisma.member.count({ where: { userId, organizationId: { in: orgIds } } })).toBe(2);
    } finally {
      await db.prisma.$executeRawUnsafe(`DROP TRIGGER "${functionName}" ON page`);
      await db.prisma.$executeRawUnsafe(`DROP FUNCTION "${functionName}"()`);
    }
  });

  it('finds reserved, configured-system and punycode fixtures using the read-only audit SQL', async () => {
    const configured = `${run}-system`;
    const fixtures = ['www', `xn--${run}`, configured, `${run}-ordinary`];
    for (const slug of fixtures) await db.prisma.project.create({ data: { name: `Audit fixture ${run}`, slug, organizationId: orgIds[0] ?? '' } });
    const rows = await db.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      return tx.$queryRawUnsafe<Array<{ id: string; slug: string }>>(auditSql, [configured]);
    });
    expect(
      rows
        .filter((row) => fixtures.includes(row.slug))
        .map((row) => row.slug)
        .sort(),
    ).toEqual(fixtures.slice(0, 3).sort());
  });
});
