import { createFileRoute } from '@tanstack/react-router';
import { GuidesHub } from '@/components/marketing/guides';
import { breadcrumbLd, canonicalHref, getGithubStarsFn, pageMeta } from '@/lib/marketing-seo';

export const Route = createFileRoute('/guides')({
  loader: () => getGithubStarsFn(),
  head: () => ({
    meta: pageMeta({
      title: 'Documentation guide academy | Nibleaf',
      description: 'Neutral, task-complete guides for choosing, migrating, operating, securing, and publishing documentation systems.',
      path: '/guides',
    }),
    links: [
      { rel: 'canonical', href: canonicalHref('/guides') },
      { rel: 'alternate', hrefLang: 'en', href: canonicalHref('/guides') },
      { rel: 'alternate', hrefLang: 'ar', href: canonicalHref('/ar/guides') },
      { rel: 'alternate', hrefLang: 'x-default', href: canonicalHref('/guides') },
    ],
    scripts: [
      breadcrumbLd([
        { name: 'Home', path: '/' },
        { name: 'Guides', path: '/guides' },
      ]),
    ],
  }),
  component: GuidesRoute,
});

function GuidesRoute() {
  const stars = Route.useLoaderData();
  return <GuidesHub locale="en" stars={stars} />;
}
