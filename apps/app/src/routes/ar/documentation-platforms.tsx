import { siteT } from '@nibleaf/i18n/site';
import { createFileRoute } from '@tanstack/react-router';
import { ArabicDocumentationPlatformsPage } from '@/components/marketing/arabic-seo';
import type { ArabicPlatformsCopy } from '@/lib/arabic-marketing-copy';
import type { MarketingSeo } from '@/lib/marketing-seo';

const path = '/ar/documentation-platforms';

const pageHead = ({ breadcrumbLd, canonicalHref, pageMeta }: MarketingSeo, copy: ArabicPlatformsCopy) => {
  const t = siteT('ar');
  return {
    meta: pageMeta({
      title: copy.title,
      description: copy.description,
      path,
      locale: 'ar_AR' as const,
      imagePath: '/brand/raster/social/nibleaf-og-card-ar.png',
      imageAlt: copy.imageAlt,
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
        { name: copy.breadcrumb, path },
      ]),
      {
        type: 'application/ld+json',
        children: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name: copy.title,
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
  // The Arabic copy and the SEO helpers load with this page, not with every page's route tree.
  loader: async () => {
    const [seo, { arabicPlatformsCopy }] = await Promise.all([import('@/lib/marketing-seo'), import('@/lib/arabic-marketing-copy')]);
    return { head: pageHead(seo, arabicPlatformsCopy()) };
  },
  head: ({ loaderData }) => loaderData?.head ?? {},
  component: ArabicDocumentationPlatformsPage,
});
