import { AlternativesPage } from '@/components/marketing/comparison-page';
import { useMarketingData } from '@/components/marketing/page-data';

export const load = () => import('@/lib/comparison-page').then(({ loadComparisonPage }) => loadComparisonPage('readmeAlternatives'));

export const Page = ReadmeAlternativesRoute;

function ReadmeAlternativesRoute() {
  const { data, stars } = useMarketingData<typeof load>();
  return <AlternativesPage data={data} stars={stars} />;
}
