import { createFileRoute } from '@tanstack/react-router';
import { ArabicLandingPage } from '@/components/marketing/arabic-seo';
import { canonicalHref, marketingLd, pageMeta } from '@/lib/marketing-seo';

export const Route = createFileRoute('/ar/')({
  head: () => ({
    meta: pageMeta({
      title: 'منصة توثيق عربية وRTL فوق Markdown | Nibleaf',
      description: 'اكتب وثائق المنتج بالعربية في محرر بصري فوق Markdown، مع بحث عربي ونشر متعدد اللغات واستضافة سحابية أو ذاتية.',
      path: '/ar',
      locale: 'ar_AR',
      imagePath: '/brand/raster/social/nibleaf-og-card-ar.png',
      imageAlt: 'Nibleaf — منصة توثيق عربية وRTL فوق Markdown',
    }),
    links: [
      { rel: 'canonical', href: canonicalHref('/ar') },
      { rel: 'alternate', hrefLang: 'ar', href: canonicalHref('/ar') },
      { rel: 'alternate', hrefLang: 'en', href: canonicalHref('/') },
      { rel: 'alternate', hrefLang: 'x-default', href: canonicalHref('/') },
    ],
    scripts: [marketingLd()],
  }),
  component: ArabicLandingPage,
});
