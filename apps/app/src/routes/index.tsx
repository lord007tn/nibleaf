import { createFileRoute } from '@tanstack/react-router';
import { LandingPage } from '@/components/cloud-marketing';
import type { MarketingPageMeta } from '@/components/marketing/copy/landing-meta';
import { canonicalHref, getGithubStarsFn, marketingLd, pageMeta } from '@/lib/marketing-seo';

const landingHead = (meta: MarketingPageMeta) => ({
  meta: pageMeta({
    title: meta.title,
    description: meta.description,
    path: '/',
    imagePath: meta.ogImagePath,
    imageAlt: meta.ogImageAlt,
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
  // The landing copy loads with this page, not with every page's route tree.
  loader: async () => {
    const [stars, { LANDING_META }] = await Promise.all([getGithubStarsFn(), import('@/components/marketing/copy/landing-meta')]);
    return { stars, meta: LANDING_META.en };
  },
  head: ({ loaderData }) => (loaderData ? landingHead(loaderData.meta) : {}),
  component: Landing,
});

function Landing() {
  const { stars } = Route.useLoaderData();
  return <LandingPage stars={stars} />;
}
