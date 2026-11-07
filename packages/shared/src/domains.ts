/** The stored setup state of a custom domain, as the API returns it. */
export interface DomainServingState {
  verified: boolean;
  dnsStatus: string;
  sslStatus: string;
}

/**
 * Readers can open the docs at this address: ownership (`verified`), routing
 * (DNS) and HTTPS all work. `verified` alone only proves the TXT record, and the
 * self-host path sets it before routing and the certificate are checked, so a
 * merely verified domain may still answer with a DNS or certificate error.
 */
export const isDomainLive = (domain: DomainServingState): boolean =>
  domain.verified && domain.dnsStatus === 'VERIFIED' && domain.sslStatus === 'ACTIVE';

/**
 * The custom domain to send readers to: the live primary, else the oldest live
 * domain, else none. `domains` must be in creation order (oldest first), as the
 * domain list is stored and returned. The dashboard and the API both use this, so
 * "View site" and the links agents are given always agree.
 */
export const pickLiveDomain = <T extends DomainServingState & { isPrimary: boolean }>(domains: readonly T[]): T | undefined =>
  domains.find((domain) => domain.isPrimary && isDomainLive(domain)) ?? domains.find(isDomainLive);
