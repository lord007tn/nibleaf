import { createFileRoute } from '@tanstack/react-router';
import { AlternativesPage } from '@/components/marketing/comparison-page';

export const Route = createFileRoute('/alternatives/mintlify')({
  // The comparison and its SEO helpers load with this page, not with every page's route tree (BUNDLE_BUDGET.md).
  loader: () => import('@/lib/comparison-page').then(({ loadComparisonPage }) => loadComparisonPage('mintlifyAlternatives')),
  head: ({ loaderData }) => loaderData?.head ?? {},
  component: MintlifyAlternativesRoute,
});

function MintlifyAlternativesRoute() {
  const { data, stars } = Route.useLoaderData();
  return <AlternativesPage data={data} stars={stars} />;
}
