import { createFileRoute } from '@tanstack/react-router';
import { LandingPage } from '@/components/cloud-marketing';
import type { MarketingSeo } from '@/lib/marketing-seo';

const pageHead = ({ canonicalHref, marketingLd, pageMeta }: MarketingSeo) => ({
  meta: pageMeta({
    title: 'Nibleaf: visual Markdown docs with Arabic and RTL',
    description:
      'A documentation platform with a Notion-style Markdown editor, built-in search, versioned publishing, Arabic and RTL support, and a free cloud beta.',
    path: '/',
  }),
  links: [
    { rel: 'canonical', href: canonicalHref('/') },
    { rel: 'alternate', hrefLang: 'en', href: canonicalHref('/') },
    { rel: 'alternate', hrefLang: 'ar', href: canonicalHref('/ar') },
    { rel: 'alternate', hrefLang: 'x-default', href: canonicalHref('/') },
  ],
  scripts: [marketingLd()],
});

export const Route = createFileRoute('/')({
  // The SEO helpers load with this page, not with every page's route tree (BUNDLE_BUDGET.md).
  loader: async () => {
    const seo = await import('@/lib/marketing-seo');
    return { stars: await seo.getGithubStarsFn(), head: pageHead(seo) };
  },
  head: ({ loaderData }) => loaderData?.head ?? {},
  component: Landing,
});

function Landing() {
  const { stars } = Route.useLoaderData();
  return <LandingPage stars={stars} />;
}
