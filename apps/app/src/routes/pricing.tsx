import { createFileRoute } from '@tanstack/react-router';
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

export const Route = createFileRoute('/pricing')({
  // The FAQ copy and the SEO helpers load with this page, not with every page's route tree (BUNDLE_BUDGET.md).
  loader: async () => {
    const [seo, { marketingFaqs }] = await Promise.all([import('@/lib/marketing-seo'), import('@/lib/marketing-faqs')]);
    return { stars: await seo.getGithubStarsFn(), head: pageHead(seo, marketingFaqs) };
  },
  head: ({ loaderData }) => loaderData?.head ?? {},
  component: PricingRoute,
});

function PricingRoute() {
  const { stars } = Route.useLoaderData();
  return <PricingPage stars={stars} />;
}
