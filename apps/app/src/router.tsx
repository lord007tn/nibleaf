import { createRouter as createTanStackRouter } from '@tanstack/react-router';
import { ErrorPage } from '@/components/error-page';
import { NotFound } from '@/components/not-found';
import { getQueryContext, QueryProvider } from '@/integrations/tanstack-query/root-provider';
import { routeTree } from './routeTree.gen';

export function getRouter() {
  const queryContext = getQueryContext();
  const router = createTanStackRouter({
    routeTree,
    context: queryContext,
    defaultNotFoundComponent: NotFound,
    defaultErrorComponent: ErrorPage,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    Wrap: ({ children }) => <QueryProvider queryClient={queryContext.queryClient}>{children}</QueryProvider>,
  });
  return router;
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
