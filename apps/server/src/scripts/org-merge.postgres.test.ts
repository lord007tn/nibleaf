import { randomUUID } from 'node:crypto';
import { type Organization, Prisma, type Project, prisma } from '@nibleaf/database';
import { afterAll, describe, expect, it } from 'vitest';
import { optionalSiteAccess, resolveSiteAccess } from '../lib/access';
import { applyMerge, canonical, digest, humanReport, mergedName, planMerge, restoreMerge, snapshot, verifyMerge } from './org-merge';

describe('organization merge naming', () => {
  it.each([
    [['My workspace', "Sara's workspace"], 'Sara James', "Sara's organization"],
    [['My workspace', 'API Docs'], 'Sara James', 'API Docs'],
    [['API Docs', 'API Docs'], 'Sara James', "Sara's organization"],
    [['API Docs', 'Manual'], 'Sara James', "Sara's organization"],
    [['My workspace'], '', 'My organization'],
  ])('applies the exact default-name rule (%j)', (names, owner, expected) => {
    expect(mergedName(names as string[], owner as string)).toBe(expected);
  });
});

describe.skipIf(process.env.ORG_MERGE_INTEGRATION !== '1')('organization merge on PostgreSQL', () => {
  const prefix = `merge-${randomUUID().slice(0, 8)}`;
  const orgIds: string[] = [],
    userIds: string[] = [],
    planIds: string[] = [];
  const quota = { merge: async () => undefined };
  let serial = 0;

  const person = async (name: string, data: { banned?: boolean; suspendedAt?: Date } = {}) => {
    const id = `${prefix}-u-${serial++}`;
    userIds.push(id);
    return prisma.user.create({ data: { id, name, email: `${id}@nibleaf.test`, emailVerified: true, ...data } });
  };
  const fixture = async (count = 2) => {
    const owner = await person('Sara James');
    const shared = await person('Shared Person');
    const viewer = await person('Viewer');
    const banned = await person('Banned', { banned: true });
    const suspended = await person('Suspended', { suspendedAt: new Date() });
    const orgs: Organization[] = [],
      sites: Project[] = [];
    for (let i = 0; i < count; i++) {
      const id = `${prefix}-o-${serial++}`;
      orgIds.push(id);
      const slug = `${id}-handle`;
      const org = await prisma.organization.create({
        data: {
          id,
          slug,
          name: i === 1 ? 'API Docs' : 'My workspace',
          createdAt: new Date(1_700_000_000_000 + i * 1000),
          metadata: JSON.stringify({ notifications: { member_invited: false } }),
          handles: { create: { slug, current: true } },
        },
      });
      orgs.push(org);
      await prisma.member.create({ data: { organizationId: id, userId: owner.id, role: 'owner', orgRole: 'owner' } });
      const site = await prisma.project.create({ data: { name: id, slug: id, organizationId: id } });
      sites.push(site);
      for (const [user, role] of [
        [shared, i === 0 ? 'admin' : 'member'],
        [viewer, 'viewer'],
        [banned, 'admin'],
        [suspended, 'member'],
      ] as const) {
        await prisma.member.create({ data: { organizationId: id, userId: user.id, role: 'viewer', orgRole: 'member' } });
        await prisma.projectMember.create({ data: { organizationId: id, projectId: site.id, userId: user.id, role } });
      }
    }
    return { owner, shared, viewer, banned, suspended, orgs, sites };
  };
  const read = (ids: string[]) => prisma.$transaction((tx) => snapshot(tx, ids));
  const onePlan = async (ownerId: string) => {
    const plan = await planMerge();
    plan.groups = plan.groups.filter((group) => group.ownerId === ownerId);
    expect(plan.groups).toHaveLength(1);
    return plan;
  };
  afterAll(async () => {
    if (process.env.ORG_MERGE_INTEGRATION !== '1') return;
    await prisma.orgMergeJournal.deleteMany({ where: { groupKey: { in: userIds } } });
    await prisma.notification.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.project.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.usageProviderCheckpoint.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.usagePlan.deleteMany({ where: { id: { in: planIds } } });
    await prisma.$disconnect();
  });

  it('is read-only, preserves roles, aliases, notifications and usage; apply twice is once; exact restore', async () => {
    const f = await fixture(3);
    const ids = f.orgs.map((org) => org.id);
    const source = f.orgs[1]!,
      site = f.sites[1]!;
    const invite = await prisma.invitation.create({
      data: {
        organizationId: source.id,
        inviterId: f.owner.id,
        email: `pending-${prefix}@nibleaf.test`,
        role: 'viewer',
        kind: 'member',
        orgRole: 'member',
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    const sibling = await prisma.project.create({ data: { organizationId: source.id, name: 'Sibling', slug: `${source.id}-sibling` } });
    for (const projectId of [site.id, sibling.id])
      await prisma.invitationGrant.create({ data: { invitationId: invite.id, organizationId: source.id, projectId, role: 'viewer' } });
    const link = await prisma.joinLink.create({
      data: { organizationId: source.id, tokenHash: digest(source.id), role: 'viewer', orgRole: 'member', createdById: f.owner.id, useCount: 1 },
    });
    for (const projectId of [site.id, sibling.id])
      await prisma.joinLinkGrant.create({ data: { joinLinkId: link.id, organizationId: source.id, projectId, role: 'viewer' } });
    await prisma.joinLinkUse.create({ data: { joinLinkId: link.id, userId: f.shared.id, email: f.shared.email, role: 'viewer' } });
    await prisma.notification.create({ data: { organizationId: source.id, userId: f.shared.id, type: 'member_invited', title: 'Synthetic' } });
    await prisma.usageStorageMarker.create({ data: { organizationId: site.dataTenantId, partitionId: site.dataTenantId, projectId: site.id } });
    await prisma.usageIngestCheckpoint.create({
      data: {
        id: `${source.id}-queued`,
        organizationId: site.dataTenantId,
        partitionId: site.dataTenantId,
        projectId: site.id,
        firstOccurredAt: new Date(),
        lastOccurredAt: new Date(),
        events: [],
        payloadDigest: 'synthetic',
      },
    });
    const before = await read(ids);
    const plan = await onePlan(f.owner.id);
    expect(digest(await read(ids))).toBe(digest(before));
    expect(await prisma.orgMergeJournal.count({ where: { runId: plan.runId } })).toBe(0);
    expect(plan.groups[0]?.name).toBe('API Docs');
    expect(await applyMerge(plan, { quota })).toEqual([{ groupKey: f.owner.id, status: 'applied' }]);
    expect(await applyMerge(plan, { quota })).toEqual([{ groupKey: f.owner.id, status: 'already applied' }]);
    expect(await verifyMerge(plan.runId)).toEqual([{ groupKey: f.owner.id, status: 'verified' }]);
    const survivor = plan.groups[0]!.survivorId;
    expect(await prisma.invitationGrant.count({ where: { invitationId: invite.id, organizationId: survivor } })).toBe(2);
    expect(await prisma.joinLinkGrant.count({ where: { joinLinkId: link.id, organizationId: survivor } })).toBe(2);
    expect(await prisma.joinLinkUse.count({ where: { joinLinkId: link.id } })).toBe(1);
    expect((await prisma.joinLink.findUniqueOrThrow({ where: { id: link.id } })).tokenHash).toBe(link.tokenHash);
    expect(await optionalSiteAccess(f.banned.id, site.id)).toBeNull();
    expect(await optionalSiteAccess(f.suspended.id, site.id)).toBeNull();
    await expect(resolveSiteAccess(f.shared.id, sibling.id)).rejects.toMatchObject({ status: 404 });
    for (const org of f.orgs)
      expect((await prisma.organizationHandle.findUniqueOrThrow({ where: { slug: org.slug } })).organizationId).toBe(survivor);
    expect((await prisma.notification.findFirstOrThrow({ where: { userId: f.shared.id } })).organizationId).toBe(survivor);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: survivor } })).metadata).toContain('"member_invited":false');
    expect(await restoreMerge(plan.runId, { offline: true })).toEqual([{ groupKey: f.owner.id, status: 'restored' }]);
    expect(canonical(await read(ids))).toBe(canonical(before));
  });

  it('skips input drift and does not call Redis', async () => {
    const f = await fixture();
    const plan = await onePlan(f.owner.id);
    await prisma.projectMember.deleteMany({ where: { projectId: f.sites[1]!.id, userId: f.shared.id } });
    const before = await read(f.orgs.map((org) => org.id));
    expect(
      await applyMerge(plan, {
        quota: {
          merge: async () => {
            throw new Error('must not run');
          },
        },
      }),
    ).toEqual([{ groupKey: f.owner.id, status: 'skipped', reason: 'input digest drift' }]);
    expect(digest(await read(f.orgs.map((org) => org.id)))).toBe(digest(before));
  });

  it.each(['grant removal', 'new website', 'new invitation'])('refuses restore after %s', async (kind) => {
    const f = await fixture();
    const plan = await onePlan(f.owner.id);
    expect((await applyMerge(plan, { quota }))[0]?.status).toBe('applied');
    const survivor = plan.groups[0]!.survivorId;
    if (kind === 'grant removal') await prisma.projectMember.deleteMany({ where: { userId: f.shared.id, projectId: f.sites[0]!.id } });
    else if (kind === 'new website') await prisma.project.create({ data: { organizationId: survivor, name: 'New', slug: `${survivor}-new` } });
    else
      await prisma.invitation.create({
        data: {
          organizationId: survivor,
          inviterId: f.owner.id,
          email: `drift-${survivor}@nibleaf.test`,
          kind: 'member',
          orgRole: 'member',
          expiresAt: new Date(),
        },
      });
    const before = await read(f.orgs.map((org) => org.id));
    expect((await restoreMerge(plan.runId, { offline: true }))[0]?.status).toBe('refused');
    expect(digest(await read(f.orgs.map((org) => org.id)))).toBe(digest(before));
  });

  it('commits groups independently, rolls back a quota failure, and retries without duplicating work', async () => {
    const first = await fixture(),
      second = await fixture();
    const plan = await planMerge();
    const a = plan.groups.find((group) => group.ownerId === first.owner.id),
      b = plan.groups.find((group) => group.ownerId === second.owner.id);
    if (!a || !b) throw new Error('Missing fixture groups');
    plan.groups = [a, b];
    const before = await read(b.orgIds);
    let calls = 0;
    const result = await applyMerge(plan, {
      quota: {
        merge: async (runId, keys, survivorKey) => {
          calls++;
          expect(keys).toContain(survivorKey);
          expect(keys).toHaveLength(2);
          if (runId.endsWith(second.owner.id)) throw new Error('Synthetic quota unavailable');
        },
      },
    });
    expect(result.map((row) => row.status)).toEqual(['applied', 'failed']);
    expect(digest(await read(b.orgIds))).toBe(digest(before));
    expect(calls).toBe(2);
    expect((await applyMerge(plan, { quota })).map((row) => row.status)).toEqual(['already applied', 'applied']);
    expect((await restoreMerge(plan.runId, { offline: true })).every((row) => row.status === 'restored')).toBe(true);
  });

  it('keeps people shared by different owners separated, preserves dormant grants and demotes org-admin invitations to their original websites', async () => {
    const first = await fixture(2),
      second = await fixture(3),
      single = await fixture(1);
    const source = second.orgs[1]!,
      website = second.sites[1]!;
    await prisma.member.create({ data: { organizationId: source.id, userId: first.shared.id, role: 'viewer', orgRole: 'member' } });
    await prisma.projectMember.create({ data: { organizationId: source.id, projectId: website.id, userId: first.shared.id, role: 'viewer' } });
    const removed = await person('Deleted principal');
    await prisma.member.create({ data: { organizationId: source.id, userId: removed.id, role: 'viewer', orgRole: 'member' } });
    await prisma.projectMember.create({ data: { organizationId: source.id, projectId: website.id, userId: removed.id, role: 'viewer' } });
    await prisma.user.delete({ where: { id: removed.id } });
    await prisma.member.updateMany({ where: { organizationId: source.id, userId: second.shared.id }, data: { orgRole: 'admin', role: 'admin' } });
    const invitation = await prisma.invitation.create({
      data: {
        organizationId: source.id,
        inviterId: second.owner.id,
        email: `org-admin-${source.id}@nibleaf.test`,
        kind: 'member',
        orgRole: 'admin',
        role: 'admin',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const audience = await prisma.audience.create({ data: { projectId: website.id, name: 'Staff' } });
    const before = await read(second.orgs.map((org) => org.id));
    const plan = await onePlan(second.owner.id);
    expect((await applyMerge(plan, { quota }))[0]?.status).toBe('applied');
    expect((await resolveSiteAccess(first.shared.id, website.id)).role).toBe('viewer');
    await expect(resolveSiteAccess(first.shared.id, second.sites[0]!.id)).rejects.toMatchObject({ status: 404 });
    await expect(resolveSiteAccess(second.shared.id, first.sites[0]!.id)).rejects.toMatchObject({ status: 404 });
    expect((await resolveSiteAccess(second.shared.id, website.id)).role).toBe('admin');
    expect(await prisma.invitation.findUnique({ where: { id: invitation.id } })).toMatchObject({ orgRole: 'member', role: 'viewer' });
    expect(await prisma.invitationGrant.findMany({ where: { invitationId: invitation.id } })).toMatchObject([
      { projectId: website.id, role: 'admin' },
    ]);
    expect(await prisma.audience.findUnique({ where: { id: audience.id } })).toEqual(audience);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: single.sites[0]!.id } })).organizationId).toBe(single.orgs[0]!.id);
    expect(await restoreMerge(plan.runId, { offline: true })).toEqual([{ groupKey: second.owner.id, status: 'restored' }]);
    expect(digest(await read(second.orgs.map((org) => org.id)))).toBe(digest(before));
  });

  it('requires an offline assertion for restore', async () => {
    await expect(restoreMerge('unknown', { offline: false })).rejects.toThrow('OFFLINE');
  });

  it('skips plan and metadata conflicts, accepts an explicit per-group plan decision, blocks pending receipts', async () => {
    const f = await fixture();
    for (const org of f.orgs) {
      const plan = await prisma.usagePlan.create({ data: { key: org.id, name: 'Synthetic' } });
      planIds.push(plan.id);
      await prisma.organizationUsagePlan.create({ data: { organizationId: org.id, planId: plan.id } });
    }
    let plan = await onePlan(f.owner.id);
    expect(plan.groups[0]?.reasons.join()).toContain('plan conflict');
    expect((await applyMerge(plan, { quota }))[0]?.status).toBe('skipped');
    const assignment = await prisma.organizationUsagePlan.findUniqueOrThrow({ where: { organizationId: f.orgs[1]!.id } });
    plan.groups[0]!.decision = { plan: assignment.planId, organizationId: assignment.organizationId, reason: 'Owner reviewed the commercial choice' };
    expect((await applyMerge(plan, { quota }))[0]?.status).toBe('applied');
    expect((await prisma.organizationUsagePlan.findUniqueOrThrow({ where: { organizationId: f.orgs[0]!.id } })).planId).toBe(assignment.planId);
    expect((await restoreMerge(plan.runId, { offline: true }))[0]?.status).toBe('restored');
    await prisma.organization.update({
      where: { id: f.orgs[1]!.id },
      data: { metadata: JSON.stringify({ privateUnknown: 'NEVER_REPORT_THIS_VALUE' }) },
    });
    plan = await onePlan(f.owner.id);
    expect(plan.groups[0]?.reasons.join()).toContain('unclassified metadata differs');
    expect(JSON.stringify(plan)).not.toContain('NEVER_REPORT_THIS_VALUE');
    expect(humanReport(plan)).toContain('privateUnknown');
    await prisma.usageProviderCheckpoint.create({
      data: {
        organizationId: f.orgs[0]!.id,
        provider: 'fixture',
        reconciliationId: f.owner.id,
        meterKey: 'fixture',
        quantity: 1,
        periodStart: new Date(),
        periodEnd: new Date(),
      },
    });
    expect((await onePlan(f.owner.id)).groups[0]?.reasons).toContain('pending provider receipts');
  });

  it('chooses a website-bearing survivor over older zero-website orgs and quarantines ownerless/multi-owner orgs', async () => {
    const f = await fixture(3);
    await prisma.project.delete({ where: { id: f.sites[0]!.id } });
    await prisma.member.updateMany({ where: { organizationId: f.orgs[0]!.id, userId: f.viewer.id }, data: { orgRole: 'member' } });
    const plan = await onePlan(f.owner.id);
    expect(plan.groups[0]?.survivorId).toBe(f.orgs[1]!.id);
    expect(plan.groups[0]?.slug).toBe(f.orgs[0]!.slug);
    const before = await read(f.orgs.map((org) => org.id));
    expect((await applyMerge(plan, { quota }))[0]?.status).toBe('applied');
    expect(await restoreMerge(plan.runId, { offline: true })).toEqual([{ groupKey: f.owner.id, status: 'restored' }]);
    expect(digest(await read(f.orgs.map((org) => org.id)))).toBe(digest(before));
    await prisma.organization.update({ where: { id: f.orgs[0]!.id }, data: { needsRepair: true } });
    await prisma.member.deleteMany({ where: { organizationId: f.orgs[1]!.id, orgRole: 'owner' } });
    await prisma.member.updateMany({ where: { organizationId: f.orgs[2]!.id, userId: f.viewer.id }, data: { role: 'owner', orgRole: 'member' } });
    const excluded = await planMerge();
    expect(excluded.groups.some((group) => group.ownerId === f.owner.id)).toBe(false);
    expect(excluded.excluded.map((row) => row.id)).toEqual(expect.arrayContaining(f.orgs.map((org) => org.id)));
  });

  it('serializes with an owner transfer before re-reading the digest', async () => {
    const f = await fixture();
    const plan = await onePlan(f.owner.id);
    let release!: () => void, locked!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const transfer = prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM organization WHERE id=${f.orgs[0]!.id} FOR NO KEY UPDATE`);
      locked();
      await wait;
      await tx.member.updateMany({ where: { organizationId: f.orgs[0]!.id, userId: f.owner.id }, data: { orgRole: 'member', role: 'viewer' } });
      await tx.member.updateMany({ where: { organizationId: f.orgs[0]!.id, userId: f.shared.id }, data: { orgRole: 'owner', role: 'owner' } });
    });
    await ready;
    const apply = applyMerge(plan, { quota });
    release();
    await transfer;
    expect((await apply)[0]?.status).toBe('skipped');
  });
});
