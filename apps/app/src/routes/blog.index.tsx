import { createFileRoute } from '@tanstack/react-router';
import { BlogIndexPage } from '@/components/marketing/blog';
import { BLOG_ENTRIES } from '@/lib/blog';
import { breadcrumbLd, canonicalHref, getGithubStars, pageMeta } from '@/lib/marketing-seo';

export const Route = createFileRoute('/blog/')({
  loader: async () => ({ stars: await getGithubStars() }),
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
  const { stars } = Route.useLoaderData();
  return <BlogIndexPage entries={BLOG_ENTRIES} stars={stars} />;
}
