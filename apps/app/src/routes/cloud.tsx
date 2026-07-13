import { createFileRoute } from '@tanstack/react-router';
import { CloudPage } from '@/components/cloud-marketing';
import { breadcrumbLd, canonicalHref, getGithubStars, pageMeta } from '@/lib/marketing-seo';

export const Route = createFileRoute('/cloud')({
  loader: async () => ({ stars: await getGithubStars() }),
  head: () => ({
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
  }),
  component: CloudRoute,
});

function CloudRoute() {
  const { stars } = Route.useLoaderData();
  return <CloudPage stars={stars} />;
}
