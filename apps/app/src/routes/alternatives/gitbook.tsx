import { createFileRoute } from '@tanstack/react-router';
import { AlternativesPage } from '@/components/marketing/comparison-page';

export const Route = createFileRoute('/alternatives/gitbook')({
  // The comparison and its SEO helpers load with this page, not with every page's route tree (BUNDLE_BUDGET.md).
  loader: () => import('@/lib/comparison-page').then(({ loadComparisonPage }) => loadComparisonPage('gitbookAlternatives')),
  head: ({ loaderData }) => loaderData?.head ?? {},
  component: GitbookAlternativesRoute,
});

function GitbookAlternativesRoute() {
  const { data, stars } = Route.useLoaderData();
  return <AlternativesPage data={data} stars={stars} />;
}
