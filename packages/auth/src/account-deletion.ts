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

/** A deleted account's comments go with it (FK cascade); this drops the copies
 * that pages in Trash still hold, so a restore can never bring them back. */
export const eraseUserFromPageTrash = (userId: string) =>
  prisma.$executeRaw`
    UPDATE "page_trash"
    SET "payload" = jsonb_set(
      "payload",
      '{comments}',
      COALESCE(
        (SELECT jsonb_agg(comment) FROM jsonb_array_elements("payload"->'comments') AS comment WHERE comment->>'userId' IS DISTINCT FROM ${userId}),
        '[]'::jsonb
      )
    )
    WHERE jsonb_typeof("payload"->'comments') = 'array'
      AND "payload"->'comments' @> jsonb_build_array(jsonb_build_object('userId', ${userId}::text))`;
