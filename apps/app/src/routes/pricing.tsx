import { createFileRoute } from '@tanstack/react-router';
import { PricingPage } from '@/components/marketing/pricing';
import { marketingFaqs } from '@/lib/marketing-faqs';
import { breadcrumbLd, canonicalHref, faqLd, getGithubStars, pageMeta } from '@/lib/marketing-seo';

export const Route = createFileRoute('/pricing')({
  loader: async () => ({ stars: await getGithubStars() }),
  head: () => ({
    meta: pageMeta({
      title: 'Nibleaf pricing: free cloud beta and self-hosting status',
      description:
        'Nibleaf Cloud is free while in beta. The AGPL-3.0 codebase is designed for self-hosting, which resumes when public source and image access are restored.',
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
