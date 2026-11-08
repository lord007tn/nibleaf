import { createFileRoute } from '@tanstack/react-router';
import { MarketingPage } from '@/components/marketing/routes';

// A marketing route: its pages, loaders and heads live in the marketing route
// table (components/marketing/routes.tsx), which loads with this route, not in
// the router tree every published docs page hydrates (#345).
export const Route = createFileRoute('/blog/$slug')({
  loader: ({ location }) => import('@/components/marketing/routes').then((routes) => routes.loadMarketingPage(location.pathname)),
  head: ({ loaderData }) => loaderData?.head ?? {},
  component: BlogArticleRoute,
});

function BlogArticleRoute() {
  return <MarketingPage data={Route.useLoaderData()} />;
}
