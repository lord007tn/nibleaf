import { QueryClientProvider } from '@tanstack/react-query';
import { type AnyRouter, createRouter as createTanStackRouter } from '@tanstack/react-router';
import { createIsomorphicFn } from '@tanstack/react-start';
import { ErrorPage } from '@/components/error-page';
import { NotFound } from '@/components/not-found';
import { PageLoader } from '@/components/page-loader';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';
import { reloadOnceOnChunkLoadFailure } from '@/lib/chunk-reload';
import { hydratedCustomDomainProjectId, rewriteCustomDomainInput, rewriteCustomDomainOutput } from '@/lib/custom-domain-rewrite';
import { ssrNonce } from '@/lib/ssr-nonce.server';
import { routeTree } from './routeTree.gen';

const requestNonce = createIsomorphicFn()
  .server(() => ssrNonce.getStore() || undefined)
  .client(() => undefined);

// getRouter runs once in the browser before hydration, so the stale-chunk
// recovery is in place before any route chunk loads, on every page.
const recoverFromStaleChunks = createIsomorphicFn()
  .server(() => undefined)
  .client(reloadOnceOnChunkLoadFailure);

const prepareMarketingRouter = createIsomorphicFn()
  .server((router: AnyRouter) => {
    if (ssrNonce.getStore() !== '') return;
    // Start dehydrates immediately after load(), before its render callback.
    // Normalize the request-local matches at that boundary, rather than editing
    // serialized JavaScript whose shape can change across Router upgrades.
    const load = router.load.bind(router);
    router.load = async (options) => {
      await load(options);
      for (const match of router.stores.matches.get()) match.updatedAt = 0;
    };
  })
  .client(() => undefined);

export function getRouter() {
  recoverFromStaleChunks();
  const customDomainProjectId = hydratedCustomDomainProjectId();
  // One cache for every route (dashboard, auth, invitations, published sites),
  // available to loaders as `context.queryClient` and to components through the
  // provider below. getRouter runs per request on the server, so requests never
  // share a cache.
  const queryClient = createQueryClient();
  const router = createTanStackRouter({
    routeTree,
    context: { queryClient },
    Wrap: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
    // Start captures the hydration nonce before invoking the stream callback.
    ssr: { nonce: requestNonce() },
    defaultNotFoundComponent: NotFound,
    defaultErrorComponent: ErrorPage,
    // Branded loading screen for route transitions that resolve loaders/data.
    // The delay avoids a flash on fast navigations; the min duration prevents a
    // jarring flicker once it does show.
    defaultPendingComponent: PageLoader,
    defaultPendingMs: 200,
    defaultPendingMinMs: 400,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    rewrite: customDomainProjectId
      ? {
          input: ({ url }) => rewriteCustomDomainInput(url, customDomainProjectId),
          output: ({ url }) => rewriteCustomDomainOutput(url, customDomainProjectId),
        }
      : undefined,
  });
  prepareMarketingRouter(router);
  return router;
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
