import { useT } from '@nibleaf/i18n/react';
import { createRouter as createTanStackRouter } from '@tanstack/react-router';
import { createIsomorphicFn } from '@tanstack/react-start';
import { getQueryContext, QueryProvider } from '@/integrations/tanstack-query/root-provider';
import { ssrNonce } from '@/lib/ssr-nonce.server';
import { routeTree } from './routeTree.gen';

const requestNonce = createIsomorphicFn()
  .server(() => ssrNonce.getStore())
  .client(() => undefined);

function NotFound() {
  const t = useT();
  return <div className="grid min-h-screen place-items-center bg-background text-muted-foreground text-sm">{t('admin.error.notFound')}</div>;
}

function ErrorComponent() {
  const t = useT();
  return <div className="grid min-h-screen place-items-center bg-background text-destructive text-sm">{t('error.unexpected')}</div>;
}

export function getRouter() {
  const queryContext = getQueryContext();
  const router = createTanStackRouter({
    routeTree,
    ssr: { nonce: requestNonce() },
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
