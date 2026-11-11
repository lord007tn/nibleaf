import { prisma } from '@nibleaf/database';
import { pickLiveDomain } from '@nibleaf/shared/domains';
import { env } from '@/env';

export const normalizeBaseDomain = (value: string | undefined) => value?.replace(/^\*\./, '').replace(/\.$/, '') || undefined;

const defaultSiteHost = (slug: string): string | null => {
  const base = normalizeBaseDomain(env.SITE_BASE_DOMAIN);
  return base ? `${slug}.${base}` : null;
};

/** Trusted aliases for inbound links, never request-supplied Host headers.
 * Ownership verification is required even for a domain still provisioning. */
export const trustedSiteOrigins = (project: { slug: string; domains: readonly { domain: string; verified: boolean }[] }): string[] =>
  [defaultSiteHost(project.slug), ...project.domains.filter((domain) => domain.verified).map((domain) => domain.domain)].flatMap((host) =>
    host ? [`https://${host}`] : [],
  );

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
  for (const project of projects) {
    const live = pickLiveDomain(domains.filter((domain) => domain.projectId === project.id));
    hosts.set(project.id, live?.domain ?? defaultSiteHost(project.slug));
  }
  return hosts;
};
