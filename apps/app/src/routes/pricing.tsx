import { createFileRoute } from '@tanstack/react-router';
import { faqs, PricingPage } from '@/components/cloud-marketing';
import { breadcrumbLd, canonicalHref, faqLd, getGithubStars, pageMeta } from '@/lib/marketing-seo';

export const Route = createFileRoute('/pricing')({
  loader: async () => ({ stars: await getGithubStars() }),
  head: () => ({
    meta: pageMeta({
      title: 'Nibleaf pricing — free beta, free self-hosting',
      description:
        'Nibleaf Cloud is free while in beta, with generous advance notice before any future paid plans. Self-hosting the open-source platform (AGPL-3.0) is free forever.',
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
