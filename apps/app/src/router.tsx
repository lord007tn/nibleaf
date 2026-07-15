import { createRouter as createTanStackRouter } from '@tanstack/react-router';
import { ErrorPage } from '@/components/error-page';
import { NotFound } from '@/components/not-found';
import { PageLoader } from '@/components/page-loader';
import { getQueryContext, QueryProvider } from '@/integrations/tanstack-query/root-provider';
import { hydratedCustomDomainProjectId, rewriteCustomDomainInput, rewriteCustomDomainOutput } from '@/lib/custom-domain-rewrite';
import { routeTree } from './routeTree.gen';

export function getRouter() {
  const queryContext = getQueryContext();
  const customDomainProjectId = hydratedCustomDomainProjectId();
  const router = createTanStackRouter({
    routeTree,
    context: queryContext,
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
    Wrap: ({ children }) => <QueryProvider queryClient={queryContext.queryClient}>{children}</QueryProvider>,
  });
  return router;
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
