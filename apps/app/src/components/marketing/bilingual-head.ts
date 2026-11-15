import type { MarketingSeo } from '@/lib/marketing-seo';
import type { MarketingLang, MarketingPageMeta } from './copy/types';

/**
 * `head()` for a marketing page that exists in English at `enPath` and in
 * Arabic at `/ar` + `enPath`: its own canonical, hreflang for both languages
 * with English as x-default, the breadcrumb, and FAQPage data when the page
 * renders a FAQ. The loader passes the SEO helpers it imported lazily, so this
 * module never brings them into a shared chunk.
 */
export function bilingualPageHead(
  seo: MarketingSeo,
  { lang, enPath, meta, faqs }: { lang: MarketingLang; enPath: string; meta: MarketingPageMeta; faqs?: { q: string; a: string }[] },
) {
  const arPath = `/ar${enPath}`;
  const path = lang === 'ar' ? arPath : enPath;
  const [home, page] = meta.breadcrumb;
  return {
    meta: seo.pageMeta({
      title: meta.title,
      description: meta.description,
      path,
      ...(lang === 'ar' ? { locale: 'ar_AR' as const, imagePath: '/brand/raster/social/nibleaf-og-card-ar.png' } : {}),
    }),
    links: [
      { rel: 'canonical', href: seo.canonicalHref(path) },
      { rel: 'alternate', hrefLang: 'en', href: seo.canonicalHref(enPath) },
      { rel: 'alternate', hrefLang: 'ar', href: seo.canonicalHref(arPath) },
      { rel: 'alternate', hrefLang: 'x-default', href: seo.canonicalHref(enPath) },
    ],
    scripts: [
      ...(faqs ? [seo.faqLd(faqs)] : []),
      seo.breadcrumbLd([
        { name: home, path: lang === 'ar' ? '/ar' : '/' },
        { name: page, path },
      ]),
    ],
  };
}
