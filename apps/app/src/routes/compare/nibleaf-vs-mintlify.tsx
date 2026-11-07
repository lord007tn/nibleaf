import { createFileRoute } from '@tanstack/react-router';
import { ComparePage } from '@/components/marketing/comparison-page';

export const Route = createFileRoute('/compare/nibleaf-vs-mintlify')({
  // The comparison and its SEO helpers load with this page, not with every page's route tree (BUNDLE_BUDGET.md).
  loader: () => import('@/lib/comparison-page').then(({ loadComparisonPage }) => loadComparisonPage('nibleafVsMintlify')),
  head: ({ loaderData }) => loaderData?.head ?? {},
  component: NibleafVsMintlifyRoute,
});

function NibleafVsMintlifyRoute() {
  const { data, stars } = Route.useLoaderData();
  return <ComparePage data={data} stars={stars} />;
}
