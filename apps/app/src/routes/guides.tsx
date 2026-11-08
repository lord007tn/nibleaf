import { createFileRoute } from '@tanstack/react-router';
import { GuidesHub } from '@/components/marketing/guides';
import type { MarketingSeo } from '@/lib/marketing-seo';

const pageHead = ({ breadcrumbLd, canonicalHref, pageMeta }: MarketingSeo) => ({
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
});

export const Route = createFileRoute('/guides')({
  // The SEO helpers load with this page, not with every page's route tree (BUNDLE_BUDGET.md).
  loader: async () => {
    const seo = await import('@/lib/marketing-seo');
    return { stars: await seo.getGithubStarsFn(), head: pageHead(seo) };
  },
  head: ({ loaderData }) => loaderData?.head ?? {},
  component: GuidesRoute,
});

function GuidesRoute() {
  const { stars } = Route.useLoaderData();
  return <GuidesHub locale="en" stars={stars} />;
}
