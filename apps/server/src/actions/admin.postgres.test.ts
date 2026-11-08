import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe.skipIf(process.env.ADMIN_POSTGRES !== '1')('admin discovery beyond recent samples', () => {
  let db: typeof import('@nibleaf/database');
  let admin: typeof import('./admin');
  const prefix = `admin-${randomUUID()}`;
  const ids = Array.from({ length: 505 }, (_, index) => `${prefix}-${String(index).padStart(3, '0')}`);
  const older = `${prefix}-000`;
  beforeAll(async () => {
    db = await import('@nibleaf/database');
    admin = await import('./admin');
    await db.prisma.organization.createMany({ data: ids.map((id) => ({ id, name: id })) });
    await db.prisma.user.createMany({
      data: ids.map((id, index) => ({
        id,
        name: index === 0 ? `Older customer ${prefix} عميل قديم ${prefix}` : id,
        email: `${id}@example.invalid`,
        createdAt: new Date(1_700_000_000_000 + index * 1000),
      })),
    });
    await db.prisma.project.createMany({
      data: ids.map((id, index) => ({
        id,
        organizationId: id,
        name: index === 0 ? `Older site ${prefix} موقع قديم ${prefix}` : id,
        slug: id,
        createdAt: new Date(1_700_000_000_000 + index * 1000),
      })),
    });
    await db.prisma.member.create({ data: { organizationId: older, userId: older, role: 'owner' } });
    await db.prisma.deployment.createMany({
      data: Array.from({ length: 105 }, (_, index) => ({
        id: `${prefix}-dep-${index}`,
        projectId: older,
        version: index + 1,
        status: index === 0 ? ('PENDING' as const) : ('READY' as const),
        createdAt: new Date(1_700_000_000_000 + index * 1000),
      })),
    });
    await db.prisma.domain.createMany({
      data: Array.from({ length: 105 }, (_, index) => ({
        id: `${prefix}-domain-${index}`,
        projectId: older,
        domain: `${prefix}-${index}.example.invalid`,
        verificationToken: 'synthetic',
        dnsStatus: index === 0 ? ('ERROR' as const) : ('VERIFIED' as const),
        sslStatus: 'ACTIVE' as const,
        createdAt: new Date(1_700_000_000_000 + index * 1000),
      })),
    });
    const snapshot = await db.prisma.exportSnapshot.create({
      data: { projectId: older, deploymentId: `${prefix}-dep-1`, deploymentVersion: 2, snapshot: {}, assets: [], pagesCount: 0, contentBytes: 0 },
    });
    await db.prisma.exportJob.createMany({
      data: Array.from({ length: 55 }, (_, index) => ({
        id: `${prefix}-export-${index}`,
        projectId: older,
        snapshotId: snapshot.id,
        formats: [],
        status: index === 0 ? ('FAILED' as const) : ('SUCCEEDED' as const),
        createdAt: new Date(1_700_000_000_000 + index * 1000),
      })),
    });
    const connection = await db.prisma.gitConnection.create({
      data: { projectId: older, repository: 'fictional/docs', headBranch: 'docs', createdById: older },
    });
    await db.prisma.gitSyncOperation.createMany({
      data: Array.from({ length: 55 }, (_, index) => ({
        id: `${prefix}-git-${index}`,
        connectionId: connection.id,
        kind: 'PUSH',
        status: index === 0 ? 'CONFLICT' : 'SUCCEEDED',
        idempotencyKey: `${index}`,
        requestHash: 'synthetic',
        baseBranch: 'main',
        headBranch: 'docs',
        createdAt: new Date(1_700_000_000_000 + index * 1000),
      })),
    });
  }, 120_000);
  afterAll(async () => {
    if (!db) return;
    await db.prisma.exportJob.deleteMany({ where: { projectId: { in: ids } } });
    await db.prisma.exportSnapshot.deleteMany({ where: { projectId: { in: ids } } });
    await db.prisma.organization.deleteMany({ where: { id: { in: ids } } });
    await db.prisma.user.deleteMany({ where: { id: { in: ids } } });
    await db.prisma.$disconnect();
  });

  it('finds exact/partial English and Arabic records older than 500 newer records', async () => {
    expect((await admin.listAdminUsers({ search: `${older}@example.invalid` })).items.map((row) => row.id)).toEqual([older]);
    expect((await admin.listAdminUsers({ search: `عميل قديم ${prefix}` })).items.map((row) => row.id)).toEqual([older]);
    expect((await admin.listAdminSites({ search: `Older site ${prefix}` })).items.map((row) => row.id)).toEqual([older]);
    expect((await admin.listAdminSites({ search: `موقع قديم ${prefix}` })).items.map((row) => row.id)).toEqual([older]);
    expect((await admin.listAdminSites({ search: `${older}@example.invalid` })).items.map((row) => row.id)).toEqual([older]);
  });
  it('returns bounded, stable pages and full filtered counts', async () => {
    for (const list of [admin.listAdminUsers, admin.listAdminSites]) {
      const first = await list({ search: prefix });
      const second = await list({ search: prefix, cursor: first.nextCursor ?? undefined });
      expect(first.items).toHaveLength(50);
      expect(second.items).toHaveLength(50);
      expect(first.total).toBeGreaterThanOrEqual(504);
      expect(second.items.some((row) => first.items.some((previous) => previous.id === row.id))).toBe(false);
    }
  });
  it('retrieves old unresolved operations and counts issues outside all recent-history windows', async () => {
    const result = await admin.getAdminOperations({ search: `Older site ${prefix}`, onlyIssues: true });
    expect(result.deployments.map((row) => row.id)).toContain(`${prefix}-dep-0`);
    expect(result.domains.map((row) => row.id)).toContain(`${prefix}-domain-0`);
    expect(result.exports.map((row) => row.id)).toContain(`${prefix}-export-0`);
    expect(result.git.map((row) => row.id)).toContain(`${prefix}-git-0`);
    expect(result.issueCounts).toEqual({ deploymentIssues: 1, domainIssues: 1, exportIssues: 1, gitIssues: 1 });
    const empty = await admin.getAdminOperations({ search: `${prefix}-missing`, onlyIssues: true });
    expect(empty.totals).toEqual({ deployments: 0, domains: 0, exports: 0, git: 0 });
  });
});
