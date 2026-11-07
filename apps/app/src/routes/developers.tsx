import { createFileRoute } from '@tanstack/react-router';
// The page lives outside the route file: anything a route file exports stays in
// the router's eager chunk, which every published docs page also loads.
import { DeveloperResourcesPage } from '@/components/marketing/developer-resources-page';
import { breadcrumbLd, canonicalHref, getGithubStarsFn, pageMeta } from '@/lib/marketing-seo';

export const Route = createFileRoute('/developers')({
  loader: async () => ({ stars: await getGithubStarsFn() }),
  head: () => ({
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
  }),
  component: DeveloperRoute,
});

function DeveloperRoute() {
  const { stars } = Route.useLoaderData();
  return <DeveloperResourcesPage stars={stars} />;
}
