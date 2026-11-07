import { breadcrumbLd, canonicalHref, pageMeta } from '@/lib/marketing-seo';
import type { MarketingLang } from './types';
import { findUseCaseMeta, USE_CASE_HOME } from './use-case-meta';

/**
 * Loader data for `/use-cases/$slug` and `/ar/use-cases/$slug`: the page's slug
 * and its finished `head()`. The routes import this module lazily and pass the
 * head through, so neither the head-building code nor any copy sits in the
 * router chunk that every published docs page loads.
 */
export function useCaseRouteData(lang: MarketingLang, slug: string) {
  const meta = findUseCaseMeta(lang, slug);
  if (!meta) return null;
  const enPath = `/use-cases/${meta.slug}`;
  const arPath = `/ar/use-cases/${meta.slug}`;
  const path = lang === 'ar' ? arPath : enPath;
  return {
    slug: meta.slug,
    head: {
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
      scripts: [breadcrumbLd([USE_CASE_HOME[lang], { name: meta.navLabel, path }])],
    },
  };
}
