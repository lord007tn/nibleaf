import { prisma } from '@nibleaf/database';
import { pickLiveDomain } from '@nibleaf/shared/domains';
import { env } from '@/env';

export const normalizeBaseDomain = (value: string | undefined) => value?.replace(/^\*\./, '').replace(/\.$/, '') || undefined;

/**
 * Where readers find each website, as a bare host for listings (switcher,
 * Websites page): its live custom domain (primary first, same rule as
 * `findLiveDomain`), else its free subdomain, else null when the instance has
 * no site base domain. One query for any number of websites.
 */
export const siteHosts = async (projects: ReadonlyArray<{ id: string; slug: string }>): Promise<Map<string, string | null>> => {
  const hosts = new Map<string, string | null>();
  if (projects.length === 0) return hosts;
  const domains = await prisma.domain.findMany({
    where: { projectId: { in: projects.map((project) => project.id) }, verified: true },
    orderBy: { createdAt: 'asc' },
    select: { projectId: true, domain: true, verified: true, isPrimary: true, dnsStatus: true, sslStatus: true },
  });
  const baseDomain = normalizeBaseDomain(env.SITE_BASE_DOMAIN);
  for (const project of projects) {
    const live = pickLiveDomain(domains.filter((domain) => domain.projectId === project.id));
    hosts.set(project.id, live?.domain ?? (baseDomain ? `${project.slug}.${baseDomain}` : null));
  }
  return hosts;
};
