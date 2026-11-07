import { createFileRoute } from '@tanstack/react-router';
import { PricingPage } from '@/components/marketing/pricing';
import { breadcrumbLd, canonicalHref, faqLd, getGithubStarsFn, pageMeta } from '@/lib/marketing-seo';

export const Route = createFileRoute('/pricing')({
  // The FAQ copy loads with this page, not with every page's route tree (BUNDLE_BUDGET.md).
  loader: async () => {
    const [stars, { marketingFaqs }] = await Promise.all([getGithubStarsFn(), import('@/lib/marketing-faqs')]);
    return { stars, faqs: marketingFaqs };
  },
  head: ({ loaderData }) => ({
    meta: pageMeta({
      title: 'Nibleaf pricing: free cloud beta and self-hosting status',
      description: 'Nibleaf Cloud is free during the beta, with no card at sign-up. The AGPL-3.0 release can be self-hosted with Docker Compose.',
      path: '/pricing',
    }),
    links: [{ rel: 'canonical', href: canonicalHref('/pricing') }],
    scripts: [
      ...(loaderData ? [faqLd(loaderData.faqs)] : []),
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
