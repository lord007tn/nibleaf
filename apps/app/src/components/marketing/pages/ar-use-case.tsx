import { notFound } from '@tanstack/react-router';
import { type MarketingLoadInput, useMarketingData } from '@/components/marketing/page-data';
import { ArabicUseCasePage } from '@/components/marketing/use-cases/arabic-use-case-page';

export const load = async ({ params }: MarketingLoadInput) => {
  const { loadUseCasePage } = await import('@/components/marketing/copy/use-case-head');
  const page = await loadUseCasePage('ar', params.slug ?? '');
  if (!page) throw notFound();
  return page;
};

export const Page = ArabicUseCaseRoute;

function ArabicUseCaseRoute() {
  const { slug, stars } = useMarketingData<typeof load>();
  return <ArabicUseCasePage slug={slug} stars={stars} />;
}
