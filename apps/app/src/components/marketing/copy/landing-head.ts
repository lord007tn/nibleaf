import { canonicalHref, marketingLd, pageMeta } from '@/lib/marketing-seo';
import { LANDING_META } from './landing-meta';
import type { MarketingLang } from './types';

/**
 * `head()` for `/` and `/ar`. Route loaders import this module lazily and pass
 * the result through, so the head-building code stays out of the router chunk
 * that every published docs page loads.
 */
export function landingHead(lang: MarketingLang) {
  const meta = LANDING_META[lang];
  const path = lang === 'ar' ? '/ar' : '/';
  const other = lang === 'ar' ? { hrefLang: 'en', path: '/' } : { hrefLang: 'ar', path: '/ar' };
  return {
    meta: pageMeta({
      title: meta.title,
      description: meta.description,
      path,
      ...(lang === 'ar' ? { locale: 'ar_AR' } : {}),
      imagePath: meta.ogImagePath,
      imageAlt: meta.ogImageAlt,
    }),
    links: [
      { rel: 'canonical', href: canonicalHref(path) },
      { rel: 'alternate', hrefLang: lang, href: canonicalHref(path) },
      { rel: 'alternate', hrefLang: other.hrefLang, href: canonicalHref(other.path) },
      { rel: 'alternate', hrefLang: 'x-default', href: canonicalHref('/') },
    ],
    scripts: [marketingLd()],
  };
}
