import { createFileRoute } from '@tanstack/react-router';
import { DocumentationPlatformsPage } from '@/components/marketing/documentation-platforms';
import { breadcrumbLd, canonicalHref, getGithubStarsFn, pageMeta } from '@/lib/marketing-seo';

export const documentationPlatformsHead = () => ({
  meta: pageMeta({
    title: 'Documentation platforms for Arabic teams | Nibleaf',
    description: 'Compare six documentation platforms by authoring, ownership, operations, and testable Arabic and RTL requirements.',
    path: '/documentation-platforms',
  }),
  links: [
    { rel: 'canonical', href: canonicalHref('/documentation-platforms') },
    { rel: 'alternate', hrefLang: 'en', href: canonicalHref('/documentation-platforms') },
    { rel: 'alternate', hrefLang: 'ar', href: canonicalHref('/ar/documentation-platforms') },
    { rel: 'alternate', hrefLang: 'x-default', href: canonicalHref('/documentation-platforms') },
  ],
  scripts: [
    breadcrumbLd([
      { name: 'Home', path: '/' },
      { name: 'Documentation platforms', path: '/documentation-platforms' },
    ]),
    {
      type: 'application/ld+json',
      children: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: 'Documentation platforms for Arabic and multilingual teams',
        inLanguage: 'en',
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
});

export const Route = createFileRoute('/documentation-platforms')({
  loader: () => getGithubStarsFn(),
  head: documentationPlatformsHead,
  component: DocumentationPlatformsRoute,
});

function DocumentationPlatformsRoute() {
  const stars = Route.useLoaderData();
  return <DocumentationPlatformsPage stars={stars} />;
}
