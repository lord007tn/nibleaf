import { createFileRoute } from '@tanstack/react-router';
import { ComparePage } from '@/components/marketing/comparison-page';

export const Route = createFileRoute('/compare/nibleaf-vs-docusaurus')({
  // The comparison and its SEO helpers load with this page, not with every page's route tree (BUNDLE_BUDGET.md).
  loader: () => import('@/lib/comparison-page').then(({ loadComparisonPage }) => loadComparisonPage('nibleafVsDocusaurus')),
  head: ({ loaderData }) => loaderData?.head ?? {},
  component: NibleafVsDocusaurusRoute,
});

function NibleafVsDocusaurusRoute() {
  const { data, stars } = Route.useLoaderData();
  return <ComparePage data={data} stars={stars} />;
}
