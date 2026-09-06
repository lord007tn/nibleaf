import { siteT } from '@nibleaf/i18n/site';
import { createFileRoute } from '@tanstack/react-router';
import { ArabicDocumentationPlatformsPage } from '@/components/marketing/arabic-seo';
import { breadcrumbLd, canonicalHref, pageMeta } from '@/lib/marketing-seo';

const path = '/ar/documentation-platforms';

export const arabicDocumentationPlatformsHead = () => {
  const t = siteT('ar');
  return {
    meta: pageMeta({
      title: t('arabicPlatformsTitle'),
      description: t('arabicPlatformsDescription'),
      path,
      locale: 'ar_AR' as const,
      imagePath: '/brand/raster/social/nibleaf-og-card-ar.png',
      imageAlt: t('arabicPlatformsImageAlt'),
    }),
    links: [
      { rel: 'canonical', href: canonicalHref(path) },
      { rel: 'alternate', hrefLang: 'en', href: canonicalHref('/documentation-platforms') },
      { rel: 'alternate', hrefLang: 'ar', href: canonicalHref(path) },
      { rel: 'alternate', hrefLang: 'x-default', href: canonicalHref('/documentation-platforms') },
    ],
    scripts: [
      breadcrumbLd([
        { name: t('home'), path: '/ar' },
        { name: t('arabicPlatformsBreadcrumb'), path },
      ]),
      {
        type: 'application/ld+json',
        children: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name: t('arabicPlatformsTitle'),
          inLanguage: 'ar',
          numberOfItems: 6,
          itemListOrder: 'https://schema.org/ItemListOrderAscending',
          itemListElement: ['Nibleaf', 'Mintlify', 'GitBook', 'Docusaurus', 'Material for MkDocs', 'Apidog'].map((name, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name,
          })),
        }),
      },
    ],
  };
};

export const Route = createFileRoute('/ar/documentation-platforms')({
  head: arabicDocumentationPlatformsHead,
  component: ArabicDocumentationPlatformsPage,
});
