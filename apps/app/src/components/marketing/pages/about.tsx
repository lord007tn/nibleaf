// The page lives outside the route file: anything a route file exports stays in
// the router's eager chunk, which every published docs page also loads.
import { AboutPage } from '@/components/marketing/about-page';
import { useMarketingData } from '@/components/marketing/page-data';
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

export const load = async () => {
  const seo = await import('@/lib/marketing-seo');
  return { stars: await seo.getGithubStarsFn(), head: pageHead(seo) };
};

export const Page = AboutRoute;

function AboutRoute() {
  const { stars } = useMarketingData<typeof load>();
  return <AboutPage stars={stars} />;
}
