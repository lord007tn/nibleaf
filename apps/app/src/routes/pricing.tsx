import { createFileRoute } from '@tanstack/react-router';
import { faqs } from '@/components/cloud-marketing';
import { PricingPage } from '@/components/marketing/pricing';
import { breadcrumbLd, canonicalHref, faqLd, getGithubStars, pageMeta } from '@/lib/marketing-seo';

export const Route = createFileRoute('/pricing')({
  loader: async () => ({ stars: await getGithubStars() }),
  head: () => ({
    meta: pageMeta({
      title: 'Nibleaf pricing — free beta, free self-hosting',
      description:
        'Nibleaf Cloud is free while in beta. Self-hosting the open-source platform is free forever under AGPL-3.0 — no feature gates, no per-seat pricing.',
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
  }),
  component: PricingRoute,
});

function PricingRoute() {
  const { stars } = Route.useLoaderData();
  return <PricingPage stars={stars} />;
}
