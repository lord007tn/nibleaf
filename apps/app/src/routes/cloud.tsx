import { createFileRoute } from '@tanstack/react-router';
import { CloudPage } from '@/components/cloud-marketing';
import type { MarketingSeo } from '@/lib/marketing-seo';

const pageHead = ({ breadcrumbLd, canonicalHref, pageMeta }: MarketingSeo) => ({
  meta: pageMeta({
    title: 'Nibleaf Cloud — hosted documentation sites',
    description:
      'Managed Nibleaf hosting: dashboard, database, storage, and upgrades handled for you, with custom domains and analytics. Free in beta, no credit card.',
    path: '/cloud',
  }),
  links: [{ rel: 'canonical', href: canonicalHref('/cloud') }],
  scripts: [
    breadcrumbLd([
      { name: 'Home', path: '/' },
      { name: 'Cloud', path: '/cloud' },
    ]),
  ],
});

export const Route = createFileRoute('/cloud')({
  // The SEO helpers load with this page, not with every page's route tree (BUNDLE_BUDGET.md).
  loader: async () => {
    const seo = await import('@/lib/marketing-seo');
    return { stars: await seo.getGithubStarsFn(), head: pageHead(seo) };
  },
  head: ({ loaderData }) => loaderData?.head ?? {},
  component: CloudRoute,
});

function CloudRoute() {
  const { stars } = Route.useLoaderData();
  return <CloudPage stars={stars} />;
}
