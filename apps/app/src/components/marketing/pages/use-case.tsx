import { notFound } from '@tanstack/react-router';
import { type MarketingLoadInput, useMarketingData } from '@/components/marketing/page-data';
import { UseCasePage } from '@/components/marketing/use-cases/use-case-page';

export const load = async ({ params }: MarketingLoadInput) => {
  const { loadUseCasePage } = await import('@/components/marketing/copy/use-case-head');
  const page = await loadUseCasePage('en', params.slug ?? '');
  if (!page) throw notFound();
  return page;
};

export const Page = UseCaseRoute;

function UseCaseRoute() {
  const { slug, stars } = useMarketingData<typeof load>();
  return <UseCasePage slug={slug} stars={stars} />;
}
