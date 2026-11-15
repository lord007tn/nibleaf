import { bilingualPageHead } from '@/components/marketing/bilingual-head';
import { pricingEn } from '@/components/marketing/copy/pricing.en';
import { useMarketingData } from '@/components/marketing/page-data';
import { PricingPage } from '@/components/marketing/pricing';

export const load = async () => {
  const seo = await import('@/lib/marketing-seo');
  const head = bilingualPageHead(seo, { lang: 'en', enPath: '/pricing', meta: pricingEn.meta, faqs: pricingEn.faq.items });
  return { stars: await seo.getGithubStarsFn(), head };
};

export const Page = PricingRoute;

function PricingRoute() {
  const { stars } = useMarketingData<typeof load>();
  return <PricingPage stars={stars} />;
}
