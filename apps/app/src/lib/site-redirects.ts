import { redirect } from '@tanstack/react-router';
import { getData } from '@/hooks/api/client-helpers';
import type { SiteShell } from '@/hooks/api/types';
import { api } from '@/lib/api';
import { customDomainOrigin } from '@/lib/site-origin';

const clean = (path: string): string => path.replace(/^\/+|\/+$/g, '');

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
  const from = clean(path);
  let shell: SiteShell | null = null;
  try {
    shell = await getData<SiteShell>(await api.public.sites[':id'].$get({ param: { id: projectId }, query: lang ? { lang } : {} }), 'site');
  } catch {
    return; // site itself is unavailable — let the caller render its not-found state
  }
  const redirects = (shell?.project.config as { redirects?: Array<{ from?: string; to?: string }> } | null)?.redirects ?? [];
  const match = redirects.find((rule) => typeof rule?.from === 'string' && clean(rule.from) === from);
  const to = match?.to?.trim();
  if (!to) {
    return;
  }
  // External target: redirect verbatim.
  if (/^https?:\/\//i.test(to)) {
    throw redirect({ href: to, statusCode: 308 });
  }
  const target = clean(to);
  if (target === from) {
    return; // self-redirect — avoid a loop
  }
  const query = lang ? `?lang=${encodeURIComponent(lang)}` : '';
  // On a custom domain the docs live at the root; on the app origin under /sites/:id.
  const href = customDomainOrigin() ? `/${target}${query}` : `/sites/${projectId}${target ? `/${target}` : ''}${query}`;
  throw redirect({ href, statusCode: 308 });
}
