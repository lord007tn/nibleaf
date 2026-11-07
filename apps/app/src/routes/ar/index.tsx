import { createFileRoute } from '@tanstack/react-router';
import { ArabicLandingPage } from '@/components/marketing/arabic-seo';
import type { ArabicLandingCopy } from '@/lib/arabic-marketing-copy';
import type { MarketingSeo } from '@/lib/marketing-seo';

const arabicLandingHead = ({ canonicalHref, marketingLd, pageMeta }: MarketingSeo, copy: ArabicLandingCopy) => ({
  meta: pageMeta({
    title: copy.title,
    description: copy.description,
    path: '/ar',
    locale: 'ar_AR',
    imagePath: '/brand/raster/social/nibleaf-og-card-ar.png',
    imageAlt: copy.imageAlt,
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
  // The Arabic copy and the SEO helpers load with this page, not with every page's route tree.
  loader: async () => {
    const [seo, { arabicLandingCopy }] = await Promise.all([import('@/lib/marketing-seo'), import('@/lib/arabic-marketing-copy')]);
    return { head: arabicLandingHead(seo, arabicLandingCopy()) };
  },
  head: ({ loaderData }) => loaderData?.head ?? {},
  component: ArabicLandingPage,
});
