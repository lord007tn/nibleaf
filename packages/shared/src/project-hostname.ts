/** Wildcard route exceptions from operations/runbook-subdomain-edge-route.md,
 * plus Nibleaf application endpoints. Keep the SQL audit list in sync. */
export const RESERVED_PROJECT_HOSTNAMES = ['www', 'admin', 'api', 'app', 'docs', 'storage', 'cname', 'status', 'mail'] as const;

/** The deployment settings whose hostnames a site address must not shadow
 *  (the app, API, admin, storage and CDN endpoints, and the site base domain).
 *  The API's address check and the sign-up starter site read the same list. */
export const PROJECT_SYSTEM_HOST_ENV_KEYS = [
  'APP_URL',
  'API_URL',
  'ADMIN_URL',
  'SITE_BASE_DOMAIN',
  'CUSTOM_DOMAIN_CNAME_TARGET',
  'STORAGE_PUBLIC_URL',
  'CDN_URL',
  'BETTER_AUTH_URL',
  'STORAGE_PUBLIC_ENDPOINT',
] as const;

/** The configured system hosts, read from an environment object. */
export const projectSystemHosts = (source: Partial<Record<(typeof PROJECT_SYSTEM_HOST_ENV_KEYS)[number], string | undefined>>) =>
  PROJECT_SYSTEM_HOST_ENV_KEYS.map((key) => source[key]);

/** Config values may be URLs or bare hosts (including wildcard base domains). */
export function configuredProjectHostnameLabels(hosts: ReadonlyArray<string | undefined>) {
  return hosts.flatMap((host) => {
    if (!host) return [];
    try {
      const hostname = new URL(host.includes('://') ? host : `https://${host}`).hostname.toLowerCase().replace(/^\*\./, '');
      return hostname.split('.')[0] ?? [];
    } catch {
      return [];
    }
  });
}

/** A single DNS-label policy shared by request validators and direct action callers. */
export function isProjectHostnameAllowed(slug: string, configuredHosts: ReadonlyArray<string | undefined> = []) {
  return (
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug) &&
    !slug.startsWith('xn--') &&
    ![...RESERVED_PROJECT_HOSTNAMES, ...configuredProjectHostnameLabels(configuredHosts)].some((reserved) => reserved === slug)
  );
}
