/**
 * TanStack Router must match the same internal `/sites/:projectId` route in the
 * browser that the server entry used for custom-domain SSR. These helpers keep
 * that internal route invisible in the address bar.
 */
export function rewriteCustomDomainInput(url: URL, projectId: string): URL {
  const next = new URL(url);
  const prefix = `/sites/${projectId}`;
  if (next.pathname === prefix || next.pathname.startsWith(`${prefix}/`)) return next;
  next.pathname = `${prefix}${next.pathname === '/' ? '' : next.pathname}`;
  return next;
}

export function rewriteCustomDomainOutput(url: URL, projectId: string): URL {
  const next = new URL(url);
  const prefix = `/sites/${projectId}`;
  if (next.pathname === prefix) {
    next.pathname = '/';
  } else if (next.pathname.startsWith(`${prefix}/`)) {
    next.pathname = next.pathname.slice(prefix.length) || '/';
  }
  return next;
}

/** Read the SSR marker before router hydration. Internal `/sites/:id` previews
 * deliberately do not opt in, even though they render the same marker. */
export function hydratedCustomDomainProjectId(): string | undefined {
  if (typeof document === 'undefined' || typeof window === 'undefined') return undefined;
  if (window.location.pathname.startsWith('/sites/')) return undefined;
  return document.querySelector<HTMLMetaElement>('meta[name="nibleaf-site-project"]')?.content || undefined;
}
