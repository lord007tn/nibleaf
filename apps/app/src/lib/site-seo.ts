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
interface Head {
  meta?: Tag[];
  links?: Tag[];
}

/** Absolute URL of a page within a published site (used for canonical/OG/hreflang). */
export function sitePageUrl(projectId: string, path: string, lang?: string): string {
  const clean = path ? `/${path.replace(/^\/+/, '')}` : '';
  const query = lang ? `?lang=${encodeURIComponent(lang)}` : '';
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
  const links: Tag[] = [];
  if (site.project.faviconUrl) {
    links.push({ rel: 'icon', href: site.project.faviconUrl });
  }
  return { meta, links };
}

/**
 * Per-page <head>: title, description, canonical, Open Graph + Twitter card.
 *
 * SEO values cascade with the page winning over the language, which wins over
 * the project: `page.config.seo` › `languageConfig.seo` › `project.config.seo`.
 * This mirrors Mintlify, where page frontmatter overrides the site defaults.
 */
export function pageHead(data: SitePage | null | undefined, projectId: string, lang?: string): Head {
  if (!data) {
    return {};
  }
  const config = seoConfig(data.project.config);
  const langSeo = data.languageConfig?.seo;
  const pageSeo = data.page.config?.seo;

  // Site name for the "<page> — <site>" title pattern (language can rename it).
  const siteName = langSeo?.metaTitle || config?.seo?.metaTitle || data.project.name;
  // A page may override its full document title outright (Mintlify `title`/metaTitle).
  const title = pageSeo?.metaTitle?.trim() || `${data.page.title} — ${siteName}`;
  const ogTitle = pageSeo?.metaTitle?.trim() || data.page.title;
  const description =
    pageSeo?.metaDescription || data.page.description || langSeo?.metaDescription || config?.seo?.metaDescription || data.project.description || '';
  const url = sitePageUrl(projectId, data.page.path, lang);

  const meta: Tag[] = [{ title }];
  if (description) {
    meta.push({ name: 'description', content: description });
  }
  // Respect the index preference at every level: a private site, the page's own
  // noindex, or allowIndex:false on the language/project all force noindex.
  // (allowIndex defaults to indexable when unset.)
  const noindex =
    pageSeo?.noindex === true || config?.visibility === 'private' || langSeo?.allowIndex === false || config?.seo?.allowIndex === false;
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

  // A page may pin its own canonical URL (e.g. when content is syndicated).
  const links: Tag[] = [{ rel: 'canonical', href: pageSeo?.canonicalUrl?.trim() || url }];
  // hreflang alternates so search engines associate the per-language versions
  // (and don't treat them as duplicate content). Only when the site is multilingual.
  const languages = data.languages ?? [];
  if (languages.length > 1) {
    for (const language of languages) {
      links.push({ rel: 'alternate', hreflang: language.code, href: sitePageUrl(projectId, data.page.path, language.code) });
    }
    const fallback = languages.find((language) => language.isDefault) ?? languages[0];
    if (fallback) {
      links.push({ rel: 'alternate', hreflang: 'x-default', href: sitePageUrl(projectId, data.page.path, fallback.code) });
    }
  }
  return { meta, links };
}
