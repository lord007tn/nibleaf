import { prisma } from '@nibleaf/database';
import { eraseProjectOrganization } from './tenant-erasure';

/** Preserve ownership when possible; otherwise route sole-member workspace
 * removal through the same retained-store privacy erasure as the product UI. */
export const reassignOrDeleteOrgs = async (userId: string): Promise<void> => {
  const memberships = await prisma.member.findMany({ where: { userId }, select: { organizationId: true, role: true } });
  for (const membership of memberships) {
    const members = await prisma.member.findMany({
      where: { organizationId: membership.organizationId },
      select: { id: true, userId: true, role: true },
      orderBy: { createdAt: 'asc' },
    });
    const others = members.filter((member) => member.userId !== userId);
    if (others.length === 0) {
      await eraseProjectOrganization(membership.organizationId);
    } else if (membership.role === 'owner' && !others.some((member) => member.role === 'owner') && others[0]) {
      await prisma.member.update({ where: { id: others[0].id }, data: { role: 'owner' } });
    }
  }
};
