import { normalizeRedirectPath, resolveRedirectTarget } from '@nibleaf/validators';
import { redirect } from '@tanstack/react-router';
import { getData } from '@/hooks/api/client-helpers';
import type { SiteShell } from '@/hooks/api/types';
import { api } from '@/lib/api';
import { isCustomDomainSite } from '@/lib/site-paths';
import { buildSiteRedirectHref } from '@/lib/site-redirect-href';

/**
 * Honor a configured `config.redirects` entry for `path`. Consulted only when a
 * page fails to resolve (404), so old/renamed URLs issue a real 308 to their new
 * home instead of dead-ending — preserving inbound links and SEO equity.
 *
 * Runs in the page route loader, so during SSR the thrown redirect becomes an
 * actual HTTP 308 (crawler-visible) and on the client a normal navigation.
 * Works for both app-origin (`/sites/:id/*`) and custom-domain (root) serving.
 */
export async function redirectIfConfigured(projectId: string, path: string, lang?: string): Promise<void> {
  let from: string;
  try {
    from = normalizeRedirectPath(path);
  } catch {
    return;
  }
  let shell: SiteShell | null = null;
  try {
    shell = await getData<SiteShell>(await api.public.sites[':id'].$get({ param: { id: projectId }, query: lang ? { lang } : {} }), 'site');
  } catch {
    return; // site itself is unavailable — let the caller render its not-found state
  }
  const storedRedirects = (shell?.project.config as { redirects?: unknown } | null)?.redirects;
  const redirects = Array.isArray(storedRedirects) ? storedRedirects : [];
  const validRedirects = redirects.filter(
    (rule): rule is { from: string; to: string } => typeof rule?.from === 'string' && typeof rule?.to === 'string',
  );
  const to = resolveRedirectTarget(validRedirects, from);
  if (!to) {
    return;
  }
  // External targets, including the final target of an internal chain, redirect verbatim.
  if (/^https?:\/\//i.test(to)) {
    throw redirect({ href: to, statusCode: 308 });
  }
  let href: string;
  try {
    href = buildSiteRedirectHref({ projectId, target: to, lang, customDomain: isCustomDomainSite(projectId) });
  } catch {
    return;
  }
  throw redirect({ href, statusCode: 308 });
}
