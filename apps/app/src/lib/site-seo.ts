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

/** Per-page <head>: title, description, canonical, Open Graph + Twitter card. */
export function pageHead(data: SitePage | null | undefined, projectId: string, lang?: string): Head {
  if (!data) {
    return {};
  }
  const config = seoConfig(data.project.config);
  const siteName = config?.seo?.metaTitle || data.project.name;
  const title = `${data.page.title} — ${siteName}`;
  const description = data.page.description || config?.seo?.metaDescription || data.project.description || '';
  const url = sitePageUrl(projectId, data.page.path, lang);

  const meta: Tag[] = [{ title }];
  if (description) {
    meta.push({ name: 'description', content: description });
  }
  meta.push(
    { property: 'og:title', content: data.page.title },
    { property: 'og:type', content: 'article' },
    { property: 'og:url', content: url },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: data.page.title },
  );
  if (description) {
    meta.push({ property: 'og:description', content: description }, { name: 'twitter:description', content: description });
  }
  if (data.project.logoUrl) {
    meta.push({ property: 'og:image', content: data.project.logoUrl });
  }
  return { meta, links: [{ rel: 'canonical', href: url }] };
}
