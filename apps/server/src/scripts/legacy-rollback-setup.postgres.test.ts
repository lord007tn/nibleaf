import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/bullmq', async (original) => ({
  ...(await original<typeof import('@nibleaf/bullmq')>()),
  createJob: vi.fn(async () => undefined),
  sendRequiredEmail: vi.fn(async () => undefined),
}));

/**
 * Rollback phase 1 (scripts/legacy-schema-compat.mjs): the NEW release makes
 * the changes the council named, then the previous release runs against the
 * same database (scripts/legacy-rollback-scenario.fixture) and a final
 * new-code check reads the result (legacy-schema-compat.postgres.test.ts).
 */
describe.skipIf(process.env.LEGACY_ROLLBACK_SETUP !== '1')('new release before a rollback', () => {
  afterAll(async () => {
    const { prisma } = await import('@nibleaf/database');
    await prisma.$disconnect();
  });
  it('demotes, removes, creates and prepares a website for deletion with new code', async () => {
    const { prisma } = await import('@nibleaf/database');
    const projects = await import('../actions/projects');
    const members = await import('../actions/members');
    const run = `rollback-${randomUUID().slice(0, 8)}`;
    const person = (label: string) => prisma.user.create({ data: { name: label, email: `${run}-${label}@nibleaf.test`, emailVerified: true } });
    const owner = await person('owner');
    const demoted = await person('demoted');
    const removed = await person('removed');
    const site = await projects.createProject(owner.id, { name: run });
    // Written the way the previous release / expand backfill wrote Admins.
    const legacyAdmin = (userId: string) => prisma.member.create({ data: { organizationId: site.organizationId, userId, role: 'admin' } });
    const demotedRow = await legacyAdmin(demoted.id);
    const removedRow = await legacyAdmin(removed.id);
    await members.updateMemberRole(site.organizationId, demotedRow.id, owner.id, { role: 'viewer' }, site.id);
    await members.removeMember(site.organizationId, removedRow.id, owner.id, site.id);
    const creator = await person('creator');
    const created = await projects.createProject(creator.id, { name: `${run}-created` });
    const deleter = await person('deleter');
    const doomed = await projects.createProject(deleter.id, { name: `${run}-deleted` });
    expect(created.dataTenantId).toBe(created.organizationId);
    writeFileSync(
      `${process.env.LEGACY_COMPAT_RESULT}.rollback.json`,
      JSON.stringify({
        siteId: site.id,
        organizationId: site.organizationId,
        ownerId: owner.id,
        demotedId: demoted.id,
        removedId: removed.id,
        createdSiteId: created.id,
        createdOrganizationId: created.organizationId,
        creatorId: creator.id,
        deletedSiteId: doomed.id,
        deletedOrganizationId: doomed.organizationId,
        deleterId: deleter.id,
      }),
    );
  }, 120_000);
});
