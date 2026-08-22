import { createFileRoute } from '@tanstack/react-router';
import { ArabicDocumentationPlatformsPage } from '@/components/marketing/arabic-seo';
import { breadcrumbLd, canonicalHref, pageMeta } from '@/lib/marketing-seo';

const path = '/ar/documentation-platforms';

export const Route = createFileRoute('/ar/documentation-platforms')({
  head: () => ({
    meta: pageMeta({
      title: 'أفضل منصات التوثيق للفرق العربية: مقارنة RTL وMarkdown',
      description: 'مقارنة موثقة بين Nibleaf وMintlify وGitBook وDocusaurus وMkDocs وApidog للعربية وRTL وMarkdown والاستضافة.',
      path,
      locale: 'ar_AR',
      imagePath: '/brand/raster/social/nibleaf-og-card-ar.png',
      imageAlt: 'مقارنة منصات التوثيق للفرق العربية',
    }),
    links: [{ rel: 'canonical', href: canonicalHref(path) }],
    scripts: [
      breadcrumbLd([
        { name: 'الرئيسية', path: '/ar' },
        { name: 'مقارنة منصات التوثيق', path },
      ]),
      {
        type: 'application/ld+json',
        children: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name: 'أفضل منصات التوثيق للفرق العربية',
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
  }),
  component: ArabicDocumentationPlatformsPage,
});
