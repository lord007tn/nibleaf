import { createFileRoute } from '@tanstack/react-router';
import { PricingPage } from '@/components/marketing/pricing';
import { marketingFaqs } from '@/lib/marketing-faqs';
import { breadcrumbLd, canonicalHref, faqLd, getGithubStars, pageMeta } from '@/lib/marketing-seo';

export const Route = createFileRoute('/pricing')({
  loader: async () => ({ stars: await getGithubStars() }),
  head: () => ({
    meta: pageMeta({
      title: 'Nibleaf pricing: free cloud beta and self-hosting status',
      description: 'Nibleaf Cloud is free while in beta. The public AGPL-3.0 release can be installed with a pinned container and Docker Compose.',
      path: '/pricing',
    }),
    links: [{ rel: 'canonical', href: canonicalHref('/pricing') }],
    scripts: [
      faqLd(marketingFaqs),
      breadcrumbLd([
        { name: 'Home', path: '/' },
        { name: 'Pricing', path: '/pricing' },
      ]),
    ],
  }),
  component: PricingRoute,
});

function PricingRoute() {
  const { stars } = Route.useLoaderData();
  return <PricingPage stars={stars} />;
}
