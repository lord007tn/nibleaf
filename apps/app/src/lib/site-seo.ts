import type { ProjectConfig, SitePage, SiteShell } from '@/hooks/api/types';

/**
 * Public origin the site is served from. On the client this is the real origin;
 * during SSR we fall back to the configured app URL. (Per-site custom domains
 * are handled separately — for now every site is served from the app origin.)
 */
export function publicOrigin(): string {
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.APP_URL ?? env?.PUBLIC_APP_URL ?? 'http://localhost:4310';
}

type Tag = Record<string, string>;
interface Script {
  type?: string;
  children?: string;
  src?: string;
  async?: boolean;
  defer?: boolean;
  [key: string]: unknown;
}
interface Head {
  meta?: Tag[];
  links?: Tag[];
  scripts?: Script[];
}

/** Third-party analytics <script> tags for the configured providers. IDs are
 *  charset-guarded (defense-in-depth: config is admin-only, but we still never
 *  interpolate arbitrary text into an inline script). */
function analyticsScripts(config: ProjectConfig | null): Script[] {
  const scripts: Script[] = [];
  const ga = config?.analytics?.ga4?.trim();
  if (ga && /^[\w-]+$/.test(ga)) {
    scripts.push({ src: `https://www.googletagmanager.com/gtag/js?id=${ga}`, async: true });
    scripts.push({
      children: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${ga}');`,
    });
  }
  const plausible = config?.analytics?.plausible?.trim();
  if (plausible && /^[\w.-]+$/.test(plausible)) {
    scripts.push({ src: 'https://plausible.io/js/script.js', defer: true, 'data-domain': plausible });
  }
  return scripts;
}

/** A Google Fonts stylesheet <link> (+ preconnects) for the configured fonts, so
 *  custom typography actually loads. Font names are charset-guarded. */
function fontLinks(config: ProjectConfig | null): Tag[] {
  const wanted = [config?.typography?.headingFont, config?.typography?.bodyFont, config?.typography?.codeFont]
    .map((font) => font?.trim())
    .filter((font): font is string => !!font && /^[A-Za-z0-9 ]+$/.test(font));
  const unique = [...new Set(wanted)];
  if (unique.length === 0) {
    return [];
  }
  const families = unique.map((font) => `family=${encodeURIComponent(font).replace(/%20/g, '+')}:wght@400;500;600;700`).join('&');
  return [
    { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
    { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
    { rel: 'stylesheet', href: `https://fonts.googleapis.com/css2?${families}&display=swap` },
  ];
}

/** BCP-47 language code → Open Graph locale (`og:locale`). Falls back to a
 *  `xx_XX` shape so unlisted languages still advertise something sensible. */
const OG_LOCALE: Record<string, string> = {
  en: 'en_US',
  ar: 'ar_AR',
  fr: 'fr_FR',
  es: 'es_ES',
  de: 'de_DE',
  pt: 'pt_BR',
  it: 'it_IT',
  ja: 'ja_JP',
  zh: 'zh_CN',
  ru: 'ru_RU',
  ko: 'ko_KR',
  hi: 'hi_IN',
  tr: 'tr_TR',
  nl: 'nl_NL',
};
function ogLocale(code?: string): string | undefined {
  if (!code) {
    return undefined;
  }
  const base = code.split('-')[0] ?? code;
  return OG_LOCALE[code] ?? OG_LOCALE[base] ?? code.replace('-', '_');
}

/** Absolute URL of a page within a published site (used for canonical/OG/hreflang).
 *  On a custom domain (origin given) the docs are served at the domain ROOT, so
 *  the internal /sites/:id prefix is dropped and the real origin is used. */
export function sitePageUrl(projectId: string, path: string, lang?: string, origin?: string): string {
  const clean = path ? `/${path.replace(/^\/+/, '')}` : '';
  const query = lang ? `?lang=${encodeURIComponent(lang)}` : '';
  if (origin) {
    return `${origin}${clean}${query}`;
  }
  return `${publicOrigin()}/sites/${projectId}${clean}${query}`;
}

const seoConfig = (config: Record<string, unknown> | null) => (config ?? null) as unknown as ProjectConfig | null;

/**
 * Site-level <head>: favicon, og:site_name and theme-color. Per-page head()
 * layers title + description + canonical on top of these.
 */
export function siteHead(site: SiteShell | null | undefined): Head {
  if (!site) {
    return {};
  }
  const config = seoConfig(site.project.config);
  const meta: Tag[] = [{ property: 'og:site_name', content: site.project.name }];
  const themeColor = config?.styling?.primaryColor ?? site.project.color;
  if (themeColor) {
    meta.push({ name: 'theme-color', content: themeColor });
  }
  // Always advertise a favicon: the project's own, the branding override, or a
  // built-in fallback so the browser tab and link previews are never icon-less.
  const links: Tag[] = [{ rel: 'icon', href: site.project.faviconUrl || config?.branding?.favicon || '/favicon.svg' }, ...fontLinks(config)];
  const scripts = analyticsScripts(config);
  return { meta, links, ...(scripts.length ? { scripts } : {}) };
}

/**
 * Per-page <head>: title, description, canonical, Open Graph + Twitter card.
 *
 * SEO values cascade with the page winning over the language, which wins over
 * the project: `page.config.seo` › `languageConfig.seo` › `project.config.seo`.
 * This mirrors Mintlify, where page frontmatter overrides the site defaults.
 */
export function pageHead(data: SitePage | null | undefined, projectId: string, lang?: string, origin?: string): Head {
  if (!data) {
    return {};
  }
  const config = seoConfig(data.project.config);
  const langSeo = data.languageConfig?.seo;
  const pageSeo = data.page.config?.seo;
  const languages = data.languages ?? [];
  const defaultCode = languages.find((l) => l.isDefault)?.code;
  // The language the page actually resolved in (not the requested ?lang, which
  // may have fallen back). The default language uses clean, param-less URLs so a
  // page has exactly one canonical (no /path vs /path?lang=en duplication).
  const activeLang = data.activeLanguage ?? lang;
  // Append ?lang only for a known non-default language. When the default is
  // unknown (legacy snapshots with no Language rows), treat the active language
  // AS the default so the canonical stays param-less and matches the sitemap.
  const canonicalLang = activeLang && defaultCode && activeLang !== defaultCode ? activeLang : undefined;

  // Site name for the "<page> — <site>" title pattern (language can rename it).
  const siteName = langSeo?.metaTitle || config?.seo?.metaTitle || data.project.name;
  // A page may override its full document title outright (Mintlify `title`/metaTitle).
  const title = pageSeo?.metaTitle?.trim() || `${data.page.title} — ${siteName}`;
  const ogTitle = pageSeo?.metaTitle?.trim() || data.page.title;
  // Explicit SEO overrides (page › language › project) win over the auto-derived
  // body description; the page body excerpt is the final fallback.
  const description =
    pageSeo?.metaDescription || langSeo?.metaDescription || config?.seo?.metaDescription || data.page.description || data.project.description || '';
  const url = sitePageUrl(projectId, data.page.path, canonicalLang, origin);

  const meta: Tag[] = [{ title }];
  if (description) {
    meta.push({ name: 'description', content: description });
  }
  // Respect the index preference at every level: a private site, the page's own
  // noindex, or allowIndex:false on the language/project all force noindex.
  // (allowIndex defaults to indexable when unset.)
  const noindex = pageSeo?.noindex === true || config?.visibility === 'private' || langSeo?.allowIndex === false || config?.seo?.allowIndex === false;
  if (noindex) {
    meta.push({ name: 'robots', content: 'noindex,nofollow' });
  }
  meta.push(
    { property: 'og:title', content: ogTitle },
    { property: 'og:type', content: 'article' },
    { property: 'og:url', content: url },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: ogTitle },
  );
  if (description) {
    meta.push({ property: 'og:description', content: description }, { name: 'twitter:description', content: description });
  }
  // Prefer the page card, then the language card, then the site card, then the logo.
  const ogImage = pageSeo?.ogImage || langSeo?.socialImage || config?.seo?.socialImage || data.project.logoUrl;
  if (ogImage) {
    meta.push({ property: 'og:image', content: ogImage }, { name: 'twitter:image', content: ogImage });
  }
  // Advertise the page's locale + the other translations' locales (og:locale).
  const locale = ogLocale(activeLang);
  if (locale) {
    meta.push({ property: 'og:locale', content: locale });
    for (const language of languages) {
      const alt = ogLocale(language.code);
      if (language.path != null && language.code !== activeLang && alt) {
        meta.push({ property: 'og:locale:alternate', content: alt });
      }
    }
  }

  // A page may pin its own canonical URL (e.g. when content is syndicated).
  const links: Tag[] = [{ rel: 'canonical', href: pageSeo?.canonicalUrl?.trim() || url }];
  // hreflang alternates so search engines associate the per-language versions.
  // Only emit alternates for languages that actually have this page (path set),
  // using the clean URL for the default language. Skip when there's only the one
  // real version (nothing to relate).
  const realAlternates = languages.filter((l) => l.path != null);
  if (realAlternates.length > 1) {
    for (const language of realAlternates) {
      const altLang = language.isDefault ? undefined : language.code;
      links.push({ rel: 'alternate', hreflang: language.code, href: sitePageUrl(projectId, language.path as string, altLang, origin) });
    }
    const fallback = realAlternates.find((language) => language.isDefault) ?? realAlternates[0];
    if (fallback) {
      links.push({ rel: 'alternate', hreflang: 'x-default', href: sitePageUrl(projectId, fallback.path as string, undefined, origin) });
    }
  }

  // Structured data: a TechArticle for the page + a BreadcrumbList for its trail,
  // so search engines/AI can read the doc title, description and hierarchy.
  const scripts: Script[] = [
    {
      type: 'application/ld+json',
      children: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'TechArticle',
        headline: data.page.title,
        ...(description ? { description } : {}),
        url,
        ...(ogImage ? { image: ogImage } : {}),
        inLanguage: activeLang,
        isPartOf: { '@type': 'WebSite', name: data.project.name, url: origin ?? `${publicOrigin()}/sites/${projectId}` },
      }),
    },
  ];
  const breadcrumbs = data.breadcrumbs ?? [];
  if (breadcrumbs.length > 0) {
    scripts.push({
      type: 'application/ld+json',
      children: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: breadcrumbs.map((crumb, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: crumb.title,
          item: sitePageUrl(projectId, crumb.path, canonicalLang, origin),
        })),
      }),
    });
  }

  return { meta, links, scripts };
}
