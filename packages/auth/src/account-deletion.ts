import { Prisma, prisma } from '@nibleaf/database';
import { APIError } from 'better-auth/api';

/** Personal deletion never deletes or transfers an owned organization, even empty ones. */
export const reassignOrDeleteOrgs = async (userId: string): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "user" WHERE id = ${userId} FOR UPDATE`);
    const owned = await tx.member.findFirst({ where: { userId, orgRole: 'owner' }, select: { id: true } });
    if (owned) throw new APIError('BAD_REQUEST', { message: 'Transfer ownership or delete your organization first' });
  });
};
