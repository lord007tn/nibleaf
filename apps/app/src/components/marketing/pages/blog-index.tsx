import { BlogIndexPage } from '@/components/marketing/blog';
import { useMarketingData } from '@/components/marketing/page-data';
import type { MarketingSeo } from '@/lib/marketing-seo';

const pageHead = ({ breadcrumbLd, canonicalHref, pageMeta }: MarketingSeo) => ({
  meta: pageMeta({
    title: 'Nibleaf blog — docs, open source, and ownership',
    description:
      'Guides from building Nibleaf: self-hosting docs, Markdown portability, bilingual Arabic/RTL, and honest looks at the docs tooling landscape.',
    path: '/blog',
  }),
  links: [{ rel: 'canonical', href: canonicalHref('/blog') }],
  scripts: [
    breadcrumbLd([
      { name: 'Home', path: '/' },
      { name: 'Blog', path: '/blog' },
    ]),
  ],
});

export const load = async () => {
  const [{ BLOG_ENTRIES: entries }, seo] = await Promise.all([import('@/lib/blog'), import('@/lib/marketing-seo')]);
  return { entries, stars: await seo.getGithubStarsFn(), head: pageHead(seo) };
};

export const Page = BlogRoute;

function BlogRoute() {
  const { entries, stars } = useMarketingData<typeof load>();
  return <BlogIndexPage entries={entries} stars={stars} />;
}
