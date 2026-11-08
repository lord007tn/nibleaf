import { Prisma, prisma } from '@nibleaf/database';

export interface AdminListInput {
  search?: string;
  filter?: string;
  cursor?: string;
}

/** Filter against the latest deployment before pagination, including older sites. */
export const adminSitePage = async ({ search = '', filter = 'all', cursor }: AdminListInput) => {
  const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
  const domainIssue = Prisma.sql`EXISTS (SELECT 1 FROM domain d WHERE d."projectId" = p.id AND (d."dnsStatus" = 'ERROR' OR d."sslStatus" = 'ERROR'))`;
  const owner = Prisma.sql`EXISTS (SELECT 1 FROM member m WHERE m."organizationId" = p."organizationId" AND m.role = 'owner')`;
  const invitation = Prisma.sql`EXISTS (SELECT 1 FROM invitation i WHERE i."organizationId" = p."organizationId" AND i.role = 'owner' AND i.status = 'pending')`;
  const status = Prisma.sql`(SELECT d.status::text FROM deployment d WHERE d."projectId" = p.id ORDER BY d."createdAt" DESC, d.id DESC LIMIT 1)`;
  const filterSql =
    filter === 'healthy'
      ? Prisma.sql`p."takedownAt" IS NULL AND NOT ${domainIssue} AND ${status} = 'READY'`
      : filter === 'attention'
        ? Prisma.sql`(${domainIssue} OR ${status} = 'FAILED' OR (NOT ${owner} AND NOT ${invitation}))`
        : filter === 'unpublished'
          ? Prisma.sql`${status} IS NULL`
          : filter === 'taken-down'
            ? Prisma.sql`p."takedownAt" IS NOT NULL`
            : Prisma.sql`TRUE`;
  const where = Prisma.sql`(${filterSql}) AND (${search === ''} OR p.name ILIKE ${pattern} OR p.slug ILIKE ${pattern}
    OR o.name ILIKE ${pattern}
    OR EXISTS (SELECT 1 FROM member m JOIN "user" u ON u.id = m."userId" WHERE m."organizationId" = o.id AND m.role = 'owner' AND u.email ILIKE ${pattern})
    OR EXISTS (SELECT 1 FROM invitation i WHERE i."organizationId" = o.id AND i.role = 'owner' AND i.status = 'pending' AND i.email ILIKE ${pattern}))`;
  const continuation = cursor ? Prisma.sql`AND (p."createdAt", p.id) < (SELECT "createdAt", id FROM project WHERE id = ${cursor})` : Prisma.empty;
  const [counts, rows] = await Promise.all([
    prisma.$queryRaw<Array<{ total: bigint }>>(
      Prisma.sql`SELECT count(*) AS total FROM project p JOIN organization o ON o.id = p."organizationId" WHERE ${where}`,
    ),
    prisma.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT p.id FROM project p JOIN organization o ON o.id = p."organizationId" WHERE ${where} ${continuation} ORDER BY p."createdAt" DESC, p.id DESC LIMIT 51`,
    ),
  ]);
  return {
    ids: rows.slice(0, 50).map((row) => row.id),
    total: Number(counts[0]?.total ?? 0),
    nextCursor: rows.length > 50 ? (rows[49]?.id ?? null) : null,
  };
};
