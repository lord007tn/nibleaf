import { createFileRoute } from '@tanstack/react-router';
// The page lives outside the route file: anything a route file exports stays in
// the router's eager chunk, which every published docs page also loads.
import { AboutPage } from '@/components/marketing/about-page';
import type { MarketingSeo } from '@/lib/marketing-seo';

const pageHead = ({ breadcrumbLd, canonicalHref, pageMeta }: MarketingSeo) => ({
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
});

export const Route = createFileRoute('/about')({
  // The SEO helpers load with this page, not with every page's route tree (BUNDLE_BUDGET.md).
  loader: async () => {
    const seo = await import('@/lib/marketing-seo');
    return { stars: await seo.getGithubStarsFn(), head: pageHead(seo) };
  },
  head: ({ loaderData }) => loaderData?.head ?? {},
  component: AboutRoute,
});

function AboutRoute() {
  const { stars } = Route.useLoaderData();
  return <AboutPage stars={stars} />;
}
