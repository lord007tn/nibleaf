import { siteT } from '@nibleaf/i18n/site';
import { createFileRoute } from '@tanstack/react-router';
import { ArabicLandingPage } from '@/components/marketing/arabic-seo';
import { canonicalHref, marketingLd, pageMeta } from '@/lib/marketing-seo';

export const Route = createFileRoute('/ar/')({
  head: () => {
    const t = siteT('ar');
    return {
      meta: pageMeta({
        title: t('arabicLandingTitle'),
        description: t('arabicLandingDescription'),
        path: '/ar',
        locale: 'ar_AR',
        imagePath: '/brand/raster/social/nibleaf-og-card-ar.png',
        imageAlt: t('arabicLandingImageAlt'),
      }),
      links: [
        { rel: 'canonical', href: canonicalHref('/ar') },
        { rel: 'alternate', hrefLang: 'ar', href: canonicalHref('/ar') },
        { rel: 'alternate', hrefLang: 'en', href: canonicalHref('/') },
        { rel: 'alternate', hrefLang: 'x-default', href: canonicalHref('/') },
      ],
      scripts: [marketingLd()],
    };
  },
  component: ArabicLandingPage,
});
