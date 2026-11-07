import { createFileRoute } from '@tanstack/react-router';
// The page lives outside the route file: anything a route file exports stays in
// the router's eager chunk, which every published docs page also loads.
import { DeveloperResourcesPage } from '@/components/marketing/developer-resources-page';
import type { MarketingSeo } from '@/lib/marketing-seo';

const pageHead = ({ breadcrumbLd, canonicalHref, pageMeta }: MarketingSeo) => ({
  meta: pageMeta({
    title: 'Nibleaf developer resources: OpenAPI, llms.txt, and Markdown',
    description: 'Discover the Nibleaf public reader API, OpenAPI schema, Markdown content negotiation, llms files, and authentication boundaries.',
    path: '/developers',
  }),
  links: [{ rel: 'canonical', href: canonicalHref('/developers') }],
  scripts: [
    breadcrumbLd([
      { name: 'Home', path: '/' },
      { name: 'Developer resources', path: '/developers' },
    ]),
  ],
});

export const Route = createFileRoute('/developers')({
  // The SEO helpers load with this page, not with every page's route tree (BUNDLE_BUDGET.md).
  loader: async () => {
    const seo = await import('@/lib/marketing-seo');
    return { stars: await seo.getGithubStarsFn(), head: pageHead(seo) };
  },
  head: ({ loaderData }) => loaderData?.head ?? {},
  component: DeveloperRoute,
});

function DeveloperRoute() {
  const { stars } = Route.useLoaderData();
  return <DeveloperResourcesPage stars={stars} />;
}
