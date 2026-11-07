import type { MarketingLang } from '@/components/marketing/copy/types';
import type { UseCaseMeta } from '@/components/marketing/copy/use-case-meta';
import { breadcrumbLd, canonicalHref, pageMeta } from '@/lib/marketing-seo';

/**
 * `head()` for `/use-cases/$slug` and `/ar/use-cases/$slug`. Route files sit in
 * the router's eager chunk, so this file imports types only from the marketing
 * copy; the strings arrive through the route loader's lazily imported
 * `use-case-meta` module.
 */
export interface UseCaseLoaderMeta {
  meta: UseCaseMeta;
  home: { name: string; path: string };
}

export function buildUseCaseHead(lang: MarketingLang, { meta, home }: UseCaseLoaderMeta) {
  const enPath = `/use-cases/${meta.slug}`;
  const arPath = `/ar/use-cases/${meta.slug}`;
  const path = lang === 'ar' ? arPath : enPath;
  return {
    meta: pageMeta({
      title: meta.title,
      description: meta.description,
      path,
      locale: lang === 'ar' ? 'ar_AR' : 'en_US',
      imagePath: lang === 'ar' ? '/brand/raster/social/nibleaf-og-card-ar.png' : undefined,
      imageAlt: meta.title,
    }),
    links: [
      { rel: 'canonical', href: canonicalHref(path) },
      { rel: 'alternate', hrefLang: 'en', href: canonicalHref(enPath) },
      { rel: 'alternate', hrefLang: 'ar', href: canonicalHref(arPath) },
      { rel: 'alternate', hrefLang: 'x-default', href: canonicalHref(enPath) },
    ],
    scripts: [breadcrumbLd([home, { name: meta.navLabel, path }])],
  };
}
