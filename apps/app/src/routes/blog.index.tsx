import { createFileRoute } from '@tanstack/react-router';
import { BlogIndexPage } from '@/components/marketing/blog';
import { breadcrumbLd, canonicalHref, getGithubStarsFn, pageMeta } from '@/lib/marketing-seo';

export const Route = createFileRoute('/blog/')({
  loader: async () => {
    const [{ BLOG_ENTRIES: entries }, stars] = await Promise.all([import('@/lib/blog'), getGithubStarsFn()]);
    return { entries, stars };
  },
  head: () => ({
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
  }),
  component: BlogRoute,
});

function BlogRoute() {
  const { entries, stars } = Route.useLoaderData();
  return <BlogIndexPage entries={entries} stars={stars} />;
}
