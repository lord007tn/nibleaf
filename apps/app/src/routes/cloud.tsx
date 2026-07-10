import { createFileRoute } from '@tanstack/react-router';
import { CloudPage } from '@/components/cloud-marketing';
import { breadcrumbLd, canonicalHref, getGithubStars, pageMeta } from '@/lib/marketing-seo';

export const Route = createFileRoute('/cloud')({
  loader: async () => ({ stars: await getGithubStars() }),
  head: () => ({
    meta: pageMeta({
      title: 'Nibleaf Cloud — hosted documentation sites',
      description:
        'Nibleaf Cloud runs the open-source Nibleaf platform for you: hosted dashboard, managed database and storage, automatic upgrades, custom domains, and analytics. Free while in beta.',
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
