import { createFileRoute } from '@tanstack/react-router';
import { BlogIndexPage } from '@/components/marketing/blog';
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

export const Route = createFileRoute('/blog/')({
  // The SEO helpers load with this page, not with every page's route tree (BUNDLE_BUDGET.md).
  loader: async () => {
    const [{ BLOG_ENTRIES: entries }, seo] = await Promise.all([import('@/lib/blog'), import('@/lib/marketing-seo')]);
    return { entries, stars: await seo.getGithubStarsFn(), head: pageHead(seo) };
  },
  head: ({ loaderData }) => loaderData?.head ?? {},
  component: BlogRoute,
});

function BlogRoute() {
  const { entries, stars } = Route.useLoaderData();
  return <BlogIndexPage entries={entries} stars={stars} />;
}
