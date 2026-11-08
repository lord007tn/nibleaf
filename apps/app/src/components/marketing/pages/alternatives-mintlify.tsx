import { AlternativesPage } from '@/components/marketing/comparison-page';
import { useMarketingData } from '@/components/marketing/page-data';

export const load = () => import('@/lib/comparison-page').then(({ loadComparisonPage }) => loadComparisonPage('mintlifyAlternatives'));

export const Page = MintlifyAlternativesRoute;

function MintlifyAlternativesRoute() {
  const { data, stars } = useMarketingData<typeof load>();
  return <AlternativesPage data={data} stars={stars} />;
}
