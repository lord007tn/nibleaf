/**
 * Which published sites this tab may cache and prefetch pages for: only sites
 * known to be public, with no reader session. Everything else (private,
 * reader-only and workspace sites, a signed-in reader, or a site not seen yet)
 * fails closed: no speculative page loads, and every navigation loads the page
 * again, so access is checked each time and a revoked reader sees nothing more.
 * Set by the site layout from the shell it rendered.
 */
const publicSites = new Set<string>();

export function setReaderSiteAccess(projectId: string, isPublic: boolean): void {
  if (isPublic) publicSites.add(projectId);
  else publicSites.delete(projectId);
}

export const isPublicReaderSite = (projectId: string): boolean => publicSites.has(projectId);
