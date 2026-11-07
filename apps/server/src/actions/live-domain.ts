import { prisma } from '@nibleaf/database';
import { pickLiveDomain } from '@nibleaf/shared/domains';

/**
 * The custom domain readers should be sent to: the live primary, else the oldest
 * live domain (`pickLiveDomain`, shared with the dashboard's "View site"). Null
 * when none is live, including one whose ownership is verified while its DNS or
 * HTTPS still fails. Kept apart from `./domains` so link builders don't load the
 * domain checks and site delivery code.
 */
export const findLiveDomain = async (projectId: string): Promise<string | null> => {
  const domains = await prisma.domain.findMany({
    where: { projectId, verified: true },
    orderBy: { createdAt: 'asc' },
    select: { domain: true, verified: true, isPrimary: true, dnsStatus: true, sslStatus: true },
  });
  return pickLiveDomain(domains)?.domain ?? null;
};
