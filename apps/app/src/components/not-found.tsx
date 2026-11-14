import { Button } from '@nibleaf/design-system/components/ui/button';
import { useStandaloneT } from '@nibleaf/i18n/standalone';
import { Link, useRouterState } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';

// The marketing site's own not-found page, in its shell (MKT-003). Lazy, so
// marketing copy stays out of the router's eager chunk, which every published
// docs page loads.
const MarketingNotFound = lazy(() => import('@/components/marketing/marketing-not-found'));

/** The product's plain not-found page: the dashboard, and the fallback while
 *  the marketing one loads. */
function ProductNotFound() {
  const t = useStandaloneT();
  return (
    <div className="grid min-h-screen place-items-center bg-background px-6 text-center">
      <div className="flex flex-col items-center gap-3">
        <span className="font-mono text-muted-foreground text-sm">{t('notFound.badge')}</span>
        <h1 className="font-semibold text-2xl tracking-tight">{t('notFound.title')}</h1>
        <p className="max-w-sm text-muted-foreground text-sm">{t('notFound.body')}</p>
        <Button className="mt-2" nativeButton={false} render={<Link to="/" />}>
          {t('notFound.backHome')}
        </Button>
      </div>
    </div>
  );
}

/** A dashboard address keeps the product page; any other address is a page of
 *  the marketing site (published docs have their own, SiteNotFound). Compared
 *  without case, as the router matches paths: `/APP/missing` is the dashboard's. */
export const isProductPath = (pathname: string) => {
  const path = pathname.toLowerCase();
  return path === '/app' || path.startsWith('/app/');
};

export function NotFound() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (isProductPath(pathname)) return <ProductNotFound />;
  return (
    <Suspense fallback={<ProductNotFound />}>
      <MarketingNotFound pathname={pathname} />
    </Suspense>
  );
}
