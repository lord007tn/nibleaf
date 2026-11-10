import { Prisma, prisma } from '@nibleaf/database';
import { APIError } from 'better-auth/api';

/** Never transfer an organization implicitly during personal account deletion.
 * Validate ALL ownerships before removing even an empty organization. */
export const reassignOrDeleteOrgs = async (userId: string): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "user" WHERE id = ${userId} FOR UPDATE`);
    const owned = await tx.member.findMany({
      where: { userId, orgRole: 'owner' },
      select: { organizationId: true },
      orderBy: { organizationId: 'asc' },
    });
    for (const org of owned) {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM organization WHERE id = ${org.organizationId} FOR UPDATE`);
      const [others, websites] = await Promise.all([
        tx.member.count({ where: { organizationId: org.organizationId, userId: { not: userId } } }),
        tx.project.count({ where: { organizationId: org.organizationId } }),
      ]);
      if (others > 0 || websites > 0) throw new APIError('BAD_REQUEST', { message: 'Transfer ownership or delete your organization first' });
    }
    for (const org of owned) await tx.organization.delete({ where: { id: org.organizationId } });
  });
};
