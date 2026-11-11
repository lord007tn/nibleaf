import { siteT } from '@nibleaf/i18n/site';
import { markdownAlternateUrl } from '@nibleaf/shared/markdown-discovery';
import { isPublicMarkdownPage } from '@nibleaf/shared/public-markdown';
import { excerpt } from '@nibleaf/shared/utils';
import type { ProjectConfig, SitePage, SiteShell } from '@/hooks/api/types';
import { hydratedCustomDomainProjectId } from '@/lib/custom-domain-rewrite';

/**
 * Public origin the site is served from. On the client this is the real origin;
 * during SSR we fall back to the configured app URL. (Per-site custom domains
 * are handled separately — for now every site is served from the app origin.)
 */
function publicOrigin(): string {
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const configured = env?.APP_URL ?? 'http://localhost:4310';
  try {
    const parsed = new URL(configured);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.origin;
  } catch {
    // Preserve head rendering when an SSR environment has no usable app origin.
  }
  return 'http://localhost:4310';
}

/** The free-subdomain base configured for this deployment (`<slug>.<base>`),
 *  cleaned of a wildcard prefix / trailing dot. Prefers the runtime process env
 *  (SSR container, tests via vi.stubEnv) and falls back to the value Vite baked
 *  into the bundle at build time (browser). */
function siteBaseDomain(): string | undefined {
  const nodeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const metaEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const raw = nodeEnv?.VITE_SITE_BASE_DOMAIN ?? metaEnv?.VITE_SITE_BASE_DOMAIN;
  return raw?.replace(/^\*\./, '').replace(/\.$/, '') || undefined;
}

/** Inputs for resolving a site's ONE canonical base URL. */
export interface SiteUrlOptions {
  /** The site's verified primary custom domain host (e.g. "docs.acme.com"),
   *  when known. Wins over every other origin. */
  primaryDomain?: string | null;
  /** Project slug, for the free `<slug>.<SITE_BASE_DOMAIN>` subdomain. */
  slug?: string | null;
  /** The custom-domain origin the request actually arrived on (stamped by
   *  src/server.ts as x-nibleaf-site-origin). Used only when neither a primary
   *  domain nor a subdomain base is known. */
  requestOrigin?: string;
  /** Override the configured base domain (tests). `null` disables it. */
  baseDomain?: string | null;
}

/**
 * The single canonical base URL for a published site. Every origin a site is
 * reachable on (app-origin /sites/:id, slug subdomain, secondary domains)
 * canonicalizes to the SAME base so search equity isn't split:
 *   1. the verified primary custom domain,
 *   2. else the `<slug>.<SITE_BASE_DOMAIN>` subdomain,
 *   3. else the origin the request arrived on (custom-domain serving),
 *   4. else the app origin's internal /sites/:id path.
 */
export function canonicalSiteBase(projectId: string, options: SiteUrlOptions = {}): string {
  const primary = options.primaryDomain?.trim().toLowerCase();
  if (primary) {
    return `https://${primary}`;
  }
  const base = options.baseDomain !== undefined ? (options.baseDomain ?? undefined) : siteBaseDomain();
  const slug = options.slug?.trim();
  if (slug && base) {
    return `https://${slug}.${base}`;
  }
  if (options.requestOrigin) {
    return options.requestOrigin;
  }
  if (hydratedCustomDomainProjectId() === projectId) {
    return publicOrigin();
  }
  return `${publicOrigin()}/sites/${projectId}`;
}

type Tag = Record<string, string>;
export interface AnalyticsScript {
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
  scripts?: AnalyticsScript[];
}

/** Third-party analytics <script> tags for the configured providers. IDs are
 *  charset-guarded (defense-in-depth: config is admin-only, but we still never
 *  interpolate arbitrary text into an inline script). */
export function analyticsScripts(config: ProjectConfig | null): AnalyticsScript[] {
  const scripts: AnalyticsScript[] = [];
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

const analyticsDeliveryMode = (config: ProjectConfig | null): 'blocked' | 'consent' | 'direct' => {
  const consentAddon = config?.addons?.consentBanner;
  if (consentAddon) return consentAddon.enabled ? 'consent' : 'blocked';
  return config?.analytics?.cookieConsent ? 'consent' : 'direct';
};

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

/** Absolute URL of a page within a published site (used for canonical/OG/hreflang),
 *  built on the site's ONE canonical base (see canonicalSiteBase). */
export function sitePageUrl(projectId: string, path: string, lang?: string, options?: SiteUrlOptions): string {
  const clean = path ? `/${path.replace(/^\/+/, '')}` : '';
  const query = lang ? `?lang=${encodeURIComponent(lang)}` : '';
  const url = `${canonicalSiteBase(projectId, options)}${clean}${query}`;
  return path ? new URL(url).href : url;
}

/** Changelog RSS URL derived from its page URL without corrupting a language
 * query string (for example, `?lang=fr` remains a query on `/rss.xml`). */
export function changelogFeedUrl(pageUrl: string): string {
  const feedUrl = new URL(pageUrl);
  feedUrl.pathname = `${feedUrl.pathname.replace(/\/$/u, '')}/rss.xml`;
  return feedUrl.toString();
}

const seoConfig = (config: ProjectConfig | null) => config;

/** The reader language the site shell resolved, read from the router matches a
 *  child route's `head` receives. A not-found child has no loader data of its
 *  own, so its head titles itself from this. */
export const siteLanguageFromMatches = (matches: ReadonlyArray<{ routeId: string; loaderData?: unknown }> = []): string | undefined =>
  (matches.find((match) => match.routeId === '/sites/$projectId')?.loaderData as { site?: SiteShell | null } | undefined)?.site?.activeLanguage;

/** <head> for a reader page whose data failed to load (an API error, not a
 *  404): the site's name when the shell loaded, else a localized
 *  "Documentation". Root leaves reader pages without Nibleaf's title, so the
 *  tab would otherwise show a bare URL. */
export const readerFallbackHead = (matches: ReadonlyArray<{ routeId: string; loaderData?: unknown }>, lang?: string): Head => {
  const site = (matches.find((match) => match.routeId === '/sites/$projectId')?.loaderData as { site?: SiteShell | null } | undefined)?.site;
  return { meta: [{ title: site?.languageConfig?.name || site?.project.name || siteT(lang)('documentation') }] };
};

/** Internal SSR response flag: the page route sets it when the page it already
 *  loaded has a public Markdown alternate, and src/server.ts turns it into the
 *  `Link` discovery header (then strips it). */
export const SITE_MARKDOWN_ALTERNATE_HEADER = 'x-nibleaf-markdown-alternate';

/** Whether this page view has a public Markdown alternate. A page that fell
 *  back from the requested `?lang=` to another language has none: the
 *  Markdown endpoint serves only the requested language (it answers 404). */
const hasMarkdownAlternate = (data: SitePage, requestedLanguage?: string): boolean =>
  isPublicMarkdownPage(data) && (!requestedLanguage || requestedLanguage === data.activeLanguage);

/** Route `headers` for a published page: flag Markdown eligibility. */
export const pageMarkdownHeaders = (data: SitePage | null | undefined, requestedLanguage?: string): Record<string, string> | undefined =>
  data && hasMarkdownAlternate(data, requestedLanguage) ? { [SITE_MARKDOWN_ALTERNATE_HEADER]: '1' } : undefined;

/** Emoji are text, never image URLs. Encoding the SVG also escapes XML markup. */
export const siteEmoji = (value?: string | null): string | undefined => {
  const text = value?.trim();
  return text &&
    /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3)/u.test(text) &&
    Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)).length === 1
    ? text
    : undefined;
};

export const siteIconHref = (config: ProjectConfig | null | undefined, icon?: string | null, projectId?: string): string => {
  const branding = config?.branding;
  for (const candidate of [branding?.favicon, branding?.logoLight, branding?.logoDark, icon]) {
    const value = candidate?.trim();
    if (!value) continue;
    const emoji = siteEmoji(value);
    if (emoji)
      return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><text x="32" y="50" text-anchor="middle" font-size="52">${emoji}</text></svg>`)}`;
    try {
      const url = new URL(value, publicOrigin());
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      if (config?.visibility === 'private' && url.pathname.startsWith('/api/public/assets/')) {
        // Only configured branding assets are anonymously served at the private sign-in gate.
        if (![branding?.favicon, branding?.logoLight, branding?.logoDark].includes(candidate)) continue;
        if (!projectId || !decodeURIComponent(url.pathname).startsWith(`/api/public/assets/projects/${projectId}/assets/`)) continue;
      }
      if (value.startsWith('/') || /^https?:\/\//u.test(value)) return value;
    } catch {
      // Invalid author URLs fall through to the next icon.
    }
  }
  return '/favicon.svg';
};

/**
 * Site-level <head>: favicon, og:site_name and theme-color. Per-page head()
 * layers title + description + canonical on top of these.
 */
export function siteHead(site: SiteShell | null | undefined, requestOrigin?: string): Head {
  if (!site) {
    return {};
  }
  const config = seoConfig(site.project.config);
  // The active language may localize the site name (og:site_name).
  const siteName = site.languageConfig?.name || site.project.name;
  const meta: Tag[] = [{ property: 'og:site_name', content: siteName }];
  const themeColor = config?.styling?.primaryColor;
  if (themeColor) {
    meta.push({ name: 'theme-color', content: themeColor });
  }
  // Point crawlers at the sitemap on the same canonical site origin, including
  // custom domains, instead of leaking the app-origin API endpoint.
  const canonicalBase = canonicalSiteBase(site.project.id, {
    primaryDomain: site.project.primaryDomain,
    slug: site.project.slug,
    requestOrigin,
  });
  const icon = siteIconHref(config, site.project.icon, site.project.id);
  const links: Tag[] = [
    // Prefer site branding; unbranded sites use the bundled Nibleaf icon.
    { rel: 'icon', href: icon },
    // iOS ignores an SVG home-screen icon, so only a raster one is offered.
    ...(icon.startsWith('data:image/svg+xml,') || /\.svg(?:[?#]|$)/iu.test(icon) ? [] : [{ rel: 'apple-touch-icon', href: icon }]),
    { rel: 'sitemap', type: 'application/xml', href: `${canonicalBase}/sitemap.xml` },
    ...fontLinks(config),
  ];
  const scripts = analyticsDeliveryMode(config) === 'direct' ? analyticsScripts(config) : [];
  return { meta, links, ...(scripts.length ? { scripts } : {}) };
}

/** Route `headers` for every published-site response: a site that is not
 *  public (or whose shell the API refused) also says noindex in a header, so
 *  crawlers that skip the HTML `<meta>` still keep its pages out of results. */
export const siteRobotsHeaders = (site: SiteShell | null | undefined): Record<string, string> | undefined =>
  !site || site.project.config?.visibility === 'private' ? { 'X-Robots-Tag': 'noindex, nofollow' } : undefined;

type UnavailableShell = { site?: SiteShell | null; unavailable?: 'private'; gate?: { language?: { code: string } | null } };

/** A child route's <head> when the site shell itself was refused (a private or
 *  unpublished site): the same title as the site's own screen, in the visitor's
 *  `?lang=` or the site's default language, rather than "page not found". */
export const unavailableSiteHeadFromMatches = (
  matches: ReadonlyArray<{ routeId: string; loaderData?: unknown; search?: unknown }> = [],
): Head | undefined => {
  const parent = matches.find((match) => match.routeId === '/sites/$projectId');
  const data = parent?.loaderData as UnavailableShell | undefined;
  if (!data || data.site) return undefined;
  return unavailableSiteHead(data.unavailable, (parent?.search as { lang?: string } | undefined)?.lang ?? data.gate?.language?.code);
};

/** <head> for a site whose shell the API refused: a private site, or one
 *  that is not published. No Nibleaf branding, never indexed. */
export function unavailableSiteHead(reason: 'private' | undefined, lang?: string): Head {
  const t = siteT(lang);
  return {
    meta: [{ title: t(reason === 'private' ? 'privateTitle' : 'notPublishedTitle') }, { name: 'robots', content: 'noindex,nofollow' }],
    links: [{ rel: 'icon', href: '/favicon.svg' }],
  };
}

/**
 * Per-page <head>: title, description, canonical, Open Graph + Twitter card.
 *
 * SEO values cascade with the page winning over the language, which wins over
 * the project: `page.config.seo` › `languageConfig.seo` › `project.config.seo`.
 * This mirrors Mintlify, where page frontmatter overrides the site defaults.
 *
 * `lang` is the requested `?lang=` for a page (a language fallback has no
 * Markdown alternate), and the reader's language for the not-found title.
 */
export function pageHead(data: SitePage | null | undefined, projectId: string, lang?: string, origin?: string): Head {
  if (!data) {
    // A nonexistent page is a soft-404: give it a distinct title in the reader's
    // language and, crucially, a robots noindex so search engines never index
    // the not-found shell.
    return { meta: [{ title: siteT(lang)('notFoundTitle') }, { name: 'robots', content: 'noindex,nofollow' }] };
  }
  const config = seoConfig(data.project.config);
  const urlOptions: SiteUrlOptions = { primaryDomain: data.project.primaryDomain, slug: data.project.slug, requestOrigin: origin };
  const langCfg = data.languageConfig;
  const langSeo = langCfg?.seo;
  const pageSeo = data.page.config?.seo;
  const languages = data.languages;
  const defaultCode = languages.find((l) => l.isDefault)?.code;
  // The language the page actually resolved in (not the requested ?lang, which
  // may have fallen back). The default language uses clean, param-less URLs so a
  // page has exactly one canonical (no /path vs /path?lang=en duplication).
  const activeLang = data.activeLanguage;
  // Append ?lang only for a known non-default language.
  const canonicalLang = activeLang && defaultCode && activeLang !== defaultCode ? activeLang : undefined;
  const activeVersion = data.activeVersion;
  const activeVersionMeta = data.versions.find((version) => version.slug === activeVersion);
  const versionPrefix = activeVersionMeta && !activeVersionMeta.isDefault ? activeVersionMeta.slug : undefined;
  const versionedPath = (path: string) => [versionPrefix, path].filter(Boolean).join('/');

  // Site name for the "<page> — <site>" title pattern: the language's SEO title,
  // then the project's SEO title, then the language's localized site name, then
  // the project name.
  const siteName = langSeo?.metaTitle || config?.seo?.metaTitle || langCfg?.name || data.project.name;
  // A page may override its full document title outright (Mintlify `title`/metaTitle).
  const title = pageSeo?.metaTitle?.trim() || `${data.page.title} — ${siteName}`;
  const ogTitle = pageSeo?.metaTitle?.trim() || data.page.title;
  // An explicit page SEO override wins first. The page's own authored summary is
  // next, then the excerpt derived from its body, so a project/language default
  // cannot stamp the same description onto every URL. Site-wide descriptions are
  // fallbacks for pages with no body text at all.
  const description = excerpt(
    pageSeo?.metaDescription?.trim() ||
      data.page.description ||
      data.page.excerpt ||
      langSeo?.metaDescription ||
      config?.seo?.metaDescription ||
      langCfg?.description ||
      data.project.description ||
      '',
  );
  const url = sitePageUrl(projectId, versionedPath(data.page.path), canonicalLang, urlOptions);

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
    { name: 'twitter:card', content: config?.visibility === 'private' ? 'summary' : 'summary_large_image' },
    { name: 'twitter:title', content: ogTitle },
  );
  if (description) {
    meta.push({ property: 'og:description', content: description }, { name: 'twitter:description', content: description });
  }
  const generatedImage = sitePageUrl(projectId, `og/${versionedPath(data.page.path)}.png`, canonicalLang, urlOptions);
  const ogImage =
    config?.visibility === 'private' ? undefined : pageSeo?.ogImage || langSeo?.socialImage || config?.seo?.socialImage || generatedImage;
  if (ogImage) {
    meta.push(
      { property: 'og:image', content: ogImage },
      ...(ogImage === generatedImage
        ? [
            { property: 'og:image:width', content: '1200' },
            { property: 'og:image:height', content: '630' },
          ]
        : []),
      { property: 'og:image:alt', content: `${ogTitle} — ${siteName}` },
      { name: 'twitter:image', content: ogImage },
    );
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
  if (hasMarkdownAlternate(data, lang)) {
    links.push(
      { rel: 'alternate', type: 'text/markdown', href: markdownAlternateUrl(url) },
      { rel: 'describedby', href: `${canonicalSiteBase(projectId, urlOptions)}/llms.txt` },
    );
  }
  // hreflang alternates so search engines associate the per-language versions.
  // Only emit alternates for languages that actually have this page (path set),
  // using the clean URL for the default language. Skip when there's only the one
  // real version (nothing to relate). They share the canonical base with the
  // canonical URL, so every origin advertises one consistent URL set.
  const realAlternates = noindex || pageSeo?.canonicalUrl?.trim() ? [] : languages.filter((l) => l.path != null);
  if (realAlternates.length > 1) {
    for (const language of realAlternates) {
      const altLang = language.isDefault ? undefined : language.code;
      links.push({
        rel: 'alternate',
        hrefLang: language.code,
        href: sitePageUrl(projectId, versionedPath(language.path as string), altLang, urlOptions),
      });
    }
    const fallback = realAlternates.find((language) => language.isDefault) ?? realAlternates[0];
    if (fallback) {
      links.push({
        rel: 'alternate',
        hrefLang: 'x-default',
        href: sitePageUrl(projectId, versionedPath(fallback.path as string), undefined, urlOptions),
      });
    }
  }

  // Structured data: a TechArticle for the page + a BreadcrumbList for its trail,
  // so search engines/AI can read the doc title, description and hierarchy.
  const canonicalBase = canonicalSiteBase(projectId, urlOptions);
  const scripts: AnalyticsScript[] = [
    {
      type: 'application/ld+json',
      children: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'TechArticle',
        headline: data.page.title,
        ...(description ? { description } : {}),
        url,
        ...(ogImage ? { image: ogImage } : {}),
        datePublished: data.page.createdAt,
        dateModified: data.page.updatedAt,
        mainEntityOfPage: { '@type': 'WebPage', '@id': url },
        inLanguage: activeLang,
        // The language's localized site name also names the WebSite in JSON-LD.
        isPartOf: { '@type': 'WebSite', name: langCfg?.name || data.project.name, url: canonicalBase },
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
          item: sitePageUrl(projectId, versionedPath(crumb.path), canonicalLang, urlOptions),
        })),
      }),
    });
  }

  return { meta, links, scripts };
}
