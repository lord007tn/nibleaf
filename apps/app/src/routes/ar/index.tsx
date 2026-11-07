import { createFileRoute } from '@tanstack/react-router';
import { ArabicLandingPage } from '@/components/marketing/arabic-landing';
import type { MarketingPageMeta } from '@/components/marketing/copy/landing-meta';
import { canonicalHref, getGithubStarsFn, marketingLd, pageMeta } from '@/lib/marketing-seo';

const arabicLandingHead = (meta: MarketingPageMeta) => ({
  meta: pageMeta({
    title: meta.title,
    description: meta.description,
    path: '/ar',
    locale: 'ar_AR',
    imagePath: meta.ogImagePath,
    imageAlt: meta.ogImageAlt,
  }),
  links: [
    { rel: 'canonical', href: canonicalHref('/ar') },
    { rel: 'alternate', hrefLang: 'ar', href: canonicalHref('/ar') },
    { rel: 'alternate', hrefLang: 'en', href: canonicalHref('/') },
    { rel: 'alternate', hrefLang: 'x-default', href: canonicalHref('/') },
  ],
  scripts: [marketingLd()],
});

export const Route = createFileRoute('/ar/')({
  // The Arabic copy loads with this page, not with every page's route tree.
  loader: async () => {
    const [stars, { LANDING_META }] = await Promise.all([getGithubStarsFn(), import('@/components/marketing/copy/landing-meta')]);
    return { stars, meta: LANDING_META.ar };
  },
  head: ({ loaderData }) => (loaderData ? arabicLandingHead(loaderData.meta) : {}),
  component: ArabicLanding,
});

function ArabicLanding() {
  const { stars } = Route.useLoaderData();
  return <ArabicLandingPage stars={stars} />;
}
