import { ComparePage } from '@/components/marketing/comparison-page';
import { useMarketingData } from '@/components/marketing/page-data';

export const load = () => import('@/lib/comparison-page').then(({ loadComparisonPage }) => loadComparisonPage('nibleafVsMintlify'));

export const Page = NibleafVsMintlifyRoute;

function NibleafVsMintlifyRoute() {
  const { data, stars } = useMarketingData<typeof load>();
  return <ComparePage data={data} stars={stars} />;
}
