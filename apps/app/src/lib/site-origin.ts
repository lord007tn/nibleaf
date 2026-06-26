import { createIsomorphicFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';

/**
 * The custom-domain origin the server entry (src/server.ts) stamped on a
 * rewritten request, e.g. "https://docs.acme.com". Returns undefined for
 * app-origin requests and on the client (where window.location.origin already
 * is the right origin). Used so a custom domain's SSR canonical / og:url /
 * hreflang point at the domain root instead of the internal
 * http://localhost:4310/sites/:id origin.
 *
 * Built with createIsomorphicFn so the server-only `getRequest` import is kept
 * out of the client bundle (TanStack Start's import-protection plugin).
 */
export const customDomainOrigin = createIsomorphicFn()
  .client((): string | undefined => undefined)
  .server((): string | undefined => {
    try {
      return getRequest()?.headers.get('x-plume-site-origin') ?? undefined;
    } catch {
      return undefined;
    }
  });
