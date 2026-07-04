import { createRouter as createTanStackRouter } from '@tanstack/react-router';
import { getQueryContext, QueryProvider } from '@/integrations/tanstack-query/root-provider';
import { routeTree } from './routeTree.gen';

function NotFound() {
  return <div className="grid min-h-screen place-items-center bg-background text-muted-foreground text-sm">Page not found</div>;
}

function ErrorComponent() {
  return <div className="grid min-h-screen place-items-center bg-background text-destructive text-sm">Something went wrong.</div>;
}

export function getRouter() {
  const queryContext = getQueryContext();
  const router = createTanStackRouter({
    routeTree,
    context: queryContext,
    defaultNotFoundComponent: NotFound,
    defaultErrorComponent: ErrorComponent,
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
