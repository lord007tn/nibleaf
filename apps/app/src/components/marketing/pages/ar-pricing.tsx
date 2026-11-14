import { ArabicPricingPage } from '@/components/marketing/arabic-pricing-page';
import { bilingualPageHead } from '@/components/marketing/bilingual-head';
import { pricingAr } from '@/components/marketing/copy/pricing.ar';
import { useMarketingData } from '@/components/marketing/page-data';

export const load = async () => {
  const seo = await import('@/lib/marketing-seo');
  const head = bilingualPageHead(seo, { lang: 'ar', enPath: '/pricing', meta: pricingAr.meta, faqs: pricingAr.faq.items });
  return { stars: await seo.getGithubStarsFn(), head };
};

export const Page = ArabicPricingRoute;

function ArabicPricingRoute() {
  const { stars } = useMarketingData<typeof load>();
  return <ArabicPricingPage stars={stars} />;
}
