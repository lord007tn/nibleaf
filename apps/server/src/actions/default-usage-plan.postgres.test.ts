import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../../../packages/database/prisma/migrations/20261111140000_default_usage_plan_backfill/migration.sql', import.meta.url),
  'utf8',
);
// Statements end with ";" at line end; comments are stripped first.
const statements = migration
  .replace(/^--.*$/gm, '')
  .split(/;\s*$/m)
  .map((statement) => statement.trim())
  .filter(Boolean);

/** Every organization is on a plan: the backfill assigns `free` to any org that
 *  has none, never touching an existing (even expired or paid) assignment. */
describe.skipIf(process.env.USAGE_PLAN_INTEGRATION !== '1')('default usage plan backfill on PostgreSQL', () => {
  let db: typeof import('@nibleaf/database');
  const orgIds: string[] = [];
  beforeAll(async () => {
    db = await import('@nibleaf/database');
  }, 120_000);
  afterAll(async () => {
    if (!db) return;
    await db.prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await db.prisma.usagePlan.deleteMany({ where: { key: { startsWith: 'test-paid-' } } });
    await db.prisma.$disconnect();
  });
  const org = async () => {
    const id = `plan-${randomUUID()}`;
    orgIds.push(id);
    return db.prisma.organization.create({ data: { id, name: 'Synthetic', slug: id, handles: { create: { slug: id, current: true } } } });
  };
  const run = async () => {
    for (const statement of statements) await db.prisma.$executeRawUnsafe(statement);
  };

  it('assigns the free plan to an org without one and leaves every existing assignment alone', async () => {
    const missing = await org();
    const expiredPaid = await org();
    const paid = await db.prisma.usagePlan.create({ data: { key: `test-paid-${randomUUID().slice(0, 8)}`, name: 'Paid', version: 1, active: true } });
    const expiredAt = new Date('2026-01-01T00:00:00.000Z');
    await db.prisma.organizationUsagePlan.create({
      data: { organizationId: expiredPaid.id, planId: paid.id, status: 'active', expiresAt: expiredAt },
    });
    expect(await db.prisma.organizationUsagePlan.count({ where: { organizationId: missing.id } })).toBe(0);

    await run();
    await run(); // idempotent

    const assigned = await db.prisma.organizationUsagePlan.findUniqueOrThrow({ where: { organizationId: missing.id }, include: { plan: true } });
    expect(assigned).toMatchObject({ status: 'active', plan: { key: 'free' } });
    const untouched = await db.prisma.organizationUsagePlan.findUniqueOrThrow({ where: { organizationId: expiredPaid.id } });
    expect(untouched).toMatchObject({ planId: paid.id, expiresAt: expiredAt });
  });
});
