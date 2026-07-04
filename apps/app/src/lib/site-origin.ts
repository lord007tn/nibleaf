import { createIsomorphicFn } from '@tanstack/react-start';
import { getRequest, setResponseStatus } from '@tanstack/react-start/server';

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
      return getRequest()?.headers.get('x-midad-site-origin') ?? undefined;
    } catch {
      return undefined;
    }
  });

/**
 * Stamp the SSR response status (server-only). Used to return a real 404 for a
 * docs page that doesn't exist in the published snapshot, so crawlers see the
 * correct status instead of a soft-404 (HTTP 200). No-ops on the client, where
 * a loader also runs on navigation but there is no server response to stamp.
 *
 * Wrapped in createIsomorphicFn so the server-only `setResponseStatus` import is
 * kept out of the client bundle (TanStack Start's import-protection plugin —
 * importing it directly into an isomorphic route module fails the build).
 */
export const setSsrStatus = createIsomorphicFn()
  .client((_status: number): void => undefined)
  .server((status: number): void => {
    try {
      setResponseStatus(status);
    } catch {
      // No server response context (e.g. client navigation / prerender) — ignore.
    }
  });
