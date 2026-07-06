import { canonicalHref } from '@/lib/links';

export function pageMeta({ title, description, path }: { title: string; description: string; path: string }) {
  const url = canonicalHref(path);
  return [
    { title },
    { name: 'description', content: description },
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
    { property: 'og:url', content: url },
    { name: 'twitter:title', content: title },
    { name: 'twitter:description', content: description },
  ];
}

export function breadcrumbLd(items: { name: string; path: string }[]) {
  return {
    type: 'application/ld+json',
    children: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: items.map((it, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: it.name,
        item: canonicalHref(it.path),
      })),
    }),
  };
}

export function hreflangLinks(path: string) {
  const href = canonicalHref(path);
  return [
    { rel: 'alternate', hrefLang: 'en', href },
    { rel: 'alternate', hrefLang: 'ar', href },
    { rel: 'alternate', hrefLang: 'x-default', href },
  ];
}
