import { CloudPage } from '@/components/marketing/cloud-page';
import { useMarketingData } from '@/components/marketing/page-data';
import type { MarketingSeo } from '@/lib/marketing-seo';

const pageHead = ({ breadcrumbLd, canonicalHref, pageMeta }: MarketingSeo) => ({
  meta: pageMeta({
    title: 'Nibleaf Cloud — hosted documentation sites',
    description:
      'Managed Nibleaf hosting: dashboard, database, storage and upgrades handled for you. Free during the beta, with no credit card at sign-up.',
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

export const load = async () => {
  const seo = await import('@/lib/marketing-seo');
  return { stars: await seo.getGithubStarsFn(), head: pageHead(seo) };
};

export const Page = CloudRoute;

function CloudRoute() {
  const { stars } = useMarketingData<typeof load>();
  return <CloudPage stars={stars} />;
}
