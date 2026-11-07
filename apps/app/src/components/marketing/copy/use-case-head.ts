import { breadcrumbLd, canonicalHref, getGithubStarsFn, pageMeta } from '@/lib/marketing-seo';
import type { MarketingLang } from './types';
import { findUseCaseMeta, USE_CASE_HOME } from './use-case-meta';

/**
 * The page's slug and its finished `head()`.
 */
function buildUseCaseRouteData(lang: MarketingLang, slug: string) {
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

/**
 * Loader data for `/use-cases/$slug` and `/ar/use-cases/$slug`: slug, finished
 * head and GitHub stars, or `null` for an unknown slug. The routes import this
 * module lazily and pass the head through, so neither the head-building code
 * nor any `lib/marketing-*` import sits in the router chunk every published
 * docs page loads.
 */
export async function loadUseCasePage(lang: MarketingLang, slug: string) {
  const page = buildUseCaseRouteData(lang, slug);
  if (!page) return null;
  return { ...page, stars: await getGithubStarsFn() };
}
