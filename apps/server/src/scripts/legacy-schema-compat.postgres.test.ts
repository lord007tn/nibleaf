import { readFileSync, writeFileSync } from 'node:fs';
import { prisma } from '@nibleaf/database';
import { afterAll, describe, expect, it } from 'vitest';
import { resolveOrgAccess, resolveSiteAccess } from '../lib/access';

describe.skipIf(process.env.LEGACY_SCHEMA_COMPAT !== '1')('new resolver reads previous-release writes', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });
  it('compares every surviving old member in each one-website fixture with the new resolver', async () => {
    const members = await prisma.member.findMany({ include: { organization: { include: { projects: true } }, user: true } });
    let compared = 0;
    for (const member of members) {
      const sites = member.organization.projects;
      if (sites.length !== 1) continue;
      const site = sites[0];
      if (!site) continue;
      const expected = member.role === 'owner' && member.orgRole !== 'owner' ? 'admin' : member.role;
      if (['owner', 'admin', 'member', 'viewer'].includes(expected)) {
        expect((await resolveSiteAccess(member.userId, site.id)).role).toBe(expected);
        compared++;
      }
    }
    writeFileSync(`${process.env.LEGACY_COMPAT_RESULT}.access.json`, JSON.stringify({ compared, mismatches: 0 }));
    expect(compared).toBeGreaterThan(0);
  });
  it('gives exactly the intended site roles, no unrelated access, and cascades removal', async () => {
    const data = JSON.parse(readFileSync(process.env.LEGACY_COMPAT_RESULT ?? '', 'utf8')) as Record<string, string>;
    const { siteId, unrelatedId, organizationId, ownerId, inviteeId, joinerId } = data;
    expect((await resolveSiteAccess(ownerId!, siteId!)).role).toBe('owner');
    expect((await resolveSiteAccess(inviteeId!, siteId!)).role).toBe('admin');
    expect((await resolveOrgAccess(inviteeId!, organizationId!)).orgRole).toBe('member');
    for (const userId of [inviteeId!, joinerId!]) await expect(resolveSiteAccess(userId, unrelatedId!)).rejects.toMatchObject({ status: 404 });
    await expect(resolveSiteAccess(joinerId!, siteId!)).rejects.toMatchObject({ status: 404 });
    expect(await prisma.projectMember.count({ where: { projectId: siteId, userId: joinerId } })).toBe(0);
    expect(await prisma.invitationGrant.count({ where: { invitationId: data.invitationId } })).toBe(1);
    expect(await prisma.joinLinkGrant.count({ where: { joinLinkId: data.joinLinkId } })).toBe(1);
    expect(await prisma.joinLinkRedemption.count({ where: { joinLinkId: data.joinLinkId, userId: joinerId } })).toBe(1);
    expect(await prisma.organizationHandle.count({ where: { organizationId, current: true } })).toBe(1);
  });
});
