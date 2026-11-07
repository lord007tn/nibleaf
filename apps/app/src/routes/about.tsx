import { createFileRoute } from '@tanstack/react-router';
// The page lives outside the route file: anything a route file exports stays in
// the router's eager chunk, which every published docs page also loads.
import { AboutPage } from '@/components/marketing/about-page';
import { breadcrumbLd, canonicalHref, getGithubStarsFn, pageMeta } from '@/lib/marketing-seo';

export const Route = createFileRoute('/about')({
  loader: async () => ({ stars: await getGithubStarsFn() }),
  head: () => ({
    meta: pageMeta({
      title: 'About Nibleaf: documentation ownership and Arabic support',
      description:
        'Why Nibleaf exists: a Markdown-based, Arabic-ready documentation platform for teams that want portable content and a clear publishing workflow.',
      path: '/about',
    }),
    links: [{ rel: 'canonical', href: canonicalHref('/about') }],
    scripts: [
      breadcrumbLd([
        { name: 'Home', path: '/' },
        { name: 'About', path: '/about' },
      ]),
    ],
  }),
  component: AboutRoute,
});

function AboutRoute() {
  const { stars } = Route.useLoaderData();
  return <AboutPage stars={stars} />;
}
