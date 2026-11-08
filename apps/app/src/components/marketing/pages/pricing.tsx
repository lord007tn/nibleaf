import { useMarketingData } from '@/components/marketing/page-data';
import { PricingPage } from '@/components/marketing/pricing';
import type { MarketingSeo } from '@/lib/marketing-seo';

const pageHead = ({ breadcrumbLd, canonicalHref, faqLd, pageMeta }: MarketingSeo, faqs: { q: string; a: string }[]) => ({
  meta: pageMeta({
    title: 'Nibleaf pricing: free cloud beta and self-hosting status',
    description: 'Nibleaf Cloud is free during the beta, with no card at sign-up. The AGPL-3.0 release can be self-hosted with Docker Compose.',
    path: '/pricing',
  }),
  links: [{ rel: 'canonical', href: canonicalHref('/pricing') }],
  scripts: [
    faqLd(faqs),
    breadcrumbLd([
      { name: 'Home', path: '/' },
      { name: 'Pricing', path: '/pricing' },
    ]),
  ],
});

export const load = async () => {
  const [seo, { marketingFaqs }] = await Promise.all([import('@/lib/marketing-seo'), import('@/lib/marketing-faqs')]);
  return { stars: await seo.getGithubStarsFn(), head: pageHead(seo, marketingFaqs) };
};

export const Page = PricingRoute;

function PricingRoute() {
  const { stars } = useMarketingData<typeof load>();
  return <PricingPage stars={stars} />;
}
