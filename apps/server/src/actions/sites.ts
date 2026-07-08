import { auth } from '@nibleaf/auth/server';
import { prisma } from '@nibleaf/database';
import { searchDocs } from '@nibleaf/search';
import {
  buildNavTree,
  defaultLanguage,
  extractHeadings,
  type NavNode,
  pageDescription,
  projectSlugFromSubdomainHost,
  type SiteSnapshot,
  type SnapshotPage,
  type SnapshotVersion,
} from '@nibleaf/shared/site';
import type { TrackEventBody } from '@nibleaf/validators';
import { getContext } from 'hono/context-storage';
import { env } from '@/env';
import { notFound } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';
import { getCachedIndex } from '@/lib/search-cache';
import { trackEvent } from './analytics';

/** Resolve a published site by project id (preferred) or globally-unique slug. */
const resolveProjectId = async (identifier: string): Promise<string> => {
  const byId = await prisma.project.findUnique({ where: { id: identifier }, select: { id: true } });
  if (byId) {
    return byId.id;
  }
  const bySlug = await prisma.project.findFirst({ where: { slug: identifier }, select: { id: true }, orderBy: { createdAt: 'asc' } });
  if (!bySlug) {
    throw notFound('site', { identifier });
  }
  return bySlug.id;
};

interface PublishedSite {
  snapshot: SiteSnapshot;
  version: number;
  deploymentId: string;
}

/** Enforce per-project visibility. A `private` site is only viewable by a
 *  signed-in member of the owning organization. The session is resolved lazily
 *  straight from the request — and only when the site is private — so public
 *  sites pay nothing. We throw notFound (not forbidden) so a private site's
 *  existence is never leaked to anonymous visitors. */
const assertViewable = async (projectId: string, snapshot: SiteSnapshot): Promise<void> => {
  const visibility = (snapshot.project.config as { visibility?: string } | null)?.visibility;
  if (visibility !== 'private') {
    return;
  }
  const headers = getContext<HonoEnv>().req.raw.headers;
  const result = await auth.api.getSession({ headers }).catch(() => null);
  const userId = result?.user?.id;
  const project = userId ? await prisma.project.findUnique({ where: { id: projectId }, select: { organizationId: true } }) : null;
  const member = project
    ? await prisma.member.findUnique({ where: { organizationId_userId: { organizationId: project.organizationId, userId: userId as string } } })
    : null;
  if (!member) {
    throw notFound('site', { identifier: projectId, reason: 'private' });
  }
};

/** Overlay live, non-versioned site chrome from the Project row onto a snapshot.
 *  Branding, theme, and config (styling, navbar/footer, SEO, visibility,
 *  analytics, variables) reflect the current settings so appearance edits are
 *  live without a re-publish. Content, pages, languages and versions are left
 *  as captured — those are the versioned docs a publish freezes. */
const overlayLiveChrome = async (projectId: string, snapshot: SiteSnapshot): Promise<void> => {
  const live = await prisma.project.findUnique({
    where: { id: projectId },
    select: { name: true, description: true, icon: true, color: true, logoUrl: true, faviconUrl: true, theme: true, config: true },
  });
  if (!live || !snapshot.project) {
    return;
  }
  snapshot.project.name = live.name;
  snapshot.project.description = live.description;
  snapshot.project.icon = live.icon;
  snapshot.project.color = live.color;
  snapshot.project.logoUrl = live.logoUrl;
  snapshot.project.faviconUrl = live.faviconUrl;
  snapshot.project.theme = (live.theme as Record<string, unknown> | null) ?? null;
  snapshot.project.config = (live.config as Record<string, unknown> | null) ?? null;
};

const getPublished = async (identifier: string): Promise<PublishedSite> => {
  const projectId = await resolveProjectId(identifier);
  const deployment = await prisma.deployment.findFirst({ where: { projectId, status: 'READY' }, orderBy: { version: 'desc' } });
  if (!deployment?.snapshot) {
    throw notFound('site', { identifier, reason: 'not_published' });
  }
  const snapshot = deployment.snapshot as unknown as SiteSnapshot;
  // Legacy snapshots (captured before the languages feature) have no `languages`
  // array; normalize it here so every downstream consumer (activeLanguageCode,
  // defaultLanguage, getSite/getSitePage/searchSite) is safe rather than 500ing.
  if (snapshot.project && !Array.isArray(snapshot.project.languages)) {
    snapshot.project.languages = [];
  }
  if (snapshot.project && !Array.isArray(snapshot.project.versions)) {
    snapshot.project.versions = [{ id: 'main', name: 'main', slug: 'main', isDefault: true }];
  }
  // Overlay the LIVE site chrome (branding, styling, navbar/footer, SEO,
  // visibility, analytics) over the frozen snapshot so config/appearance edits
  // apply to the live site immediately — without a re-publish. Page CONTENT and
  // navigation STRUCTURE stay frozen in the snapshot (those are the versioned
  // docs that a publish captures); only presentational/config fields are live.
  await overlayLiveChrome(projectId, snapshot);
  await assertViewable(projectId, snapshot);
  return { snapshot, version: deployment.version, deploymentId: deployment.id };
};

/** Resolve the active language code: the requested `lang` if it exists in the
 *  snapshot, otherwise the project's default language. */
const activeLanguageCode = (snapshot: SiteSnapshot, lang?: string): string => {
  if (lang && snapshot.project.languages.some((l) => l.code === lang)) {
    return lang;
  }
  return defaultLanguage(snapshot.project).code;
};

/** Only the pages belonging to a given language (legacy pages without a code
 *  fall under whichever language is requested). */
const pagesForLanguage = (pages: SnapshotPage[], lang: string): SnapshotPage[] => pages.filter((p) => (p.languageCode || lang) === lang);

const versionsForSnapshot = (snapshot: SiteSnapshot): SnapshotVersion[] => {
  const configured = snapshot.project.versions ?? [];
  if (configured.length > 0) {
    return configured;
  }
  return [{ id: 'main', name: 'main', slug: 'main', isDefault: true }];
};

const activeVersion = (snapshot: SiteSnapshot, version?: string): SnapshotVersion => {
  const versions = versionsForSnapshot(snapshot);
  const requested = version?.trim();
  if (requested) {
    const match = versions.find((v) => v.slug === requested || v.name === requested || v.id === requested);
    if (match) {
      return match;
    }
  }
  return versions.find((v) => v.isDefault) ?? versions[0] ?? { id: 'main', name: 'main', slug: 'main', isDefault: true };
};

const matchingVersion = (snapshot: SiteSnapshot, version?: string): SnapshotVersion | undefined => {
  const requested = version?.trim();
  if (!requested) {
    return undefined;
  }
  return versionsForSnapshot(snapshot).find((v) => v.slug === requested || v.name === requested || v.id === requested);
};

const pageBelongsToVersion = (page: SnapshotPage, version: SnapshotVersion): boolean => {
  if (page.versionId) {
    return page.versionId === version.id;
  }
  if (page.versionSlug) {
    return page.versionSlug === version.slug;
  }
  return version.isDefault;
};

const pagesForVersion = (snapshot: SiteSnapshot, version: SnapshotVersion): SnapshotPage[] =>
  snapshot.pages.filter((page) => pageBelongsToVersion(page, version));

/** The published site shell: project branding + navigation tree (per language). */
export const getSite = async (identifier: string, lang?: string, version?: string) => {
  const { snapshot, version: deploymentVersion } = await getPublished(identifier);
  const docsVersion = activeVersion(snapshot, version);
  const activeLanguage = activeLanguageCode(snapshot, lang);
  const versionPages = pagesForVersion(snapshot, docsVersion);
  return {
    project: snapshot.project,
    languages: snapshot.project.languages,
    versions: versionsForSnapshot(snapshot),
    activeLanguage,
    activeVersion: docsVersion.slug,
    nav: buildNavTree(versionPages, activeLanguage),
    version: deploymentVersion,
    generatedAt: snapshot.generatedAt,
  };
};

/** Depth-first order of renderable pages — for prev/next links. */
const flattenNav = (nav: NavNode[]): NavNode[] =>
  nav.flatMap((node) => (node.kind === 'PAGE' ? [node, ...flattenNav(node.children)] : flattenNav(node.children)));

/** A single published page with TOC, breadcrumbs, and prev/next neighbours.
 *  Scoped to the active language, falling back to the default language. */
export const getSitePage = async (identifier: string, path: string, lang?: string, version?: string) => {
  const { snapshot } = await getPublished(identifier);
  const explicitVersion = matchingVersion(snapshot, version);
  let normalized = path.replace(/^\/+|\/+$/g, '');
  if (explicitVersion && (normalized === explicitVersion.slug || normalized.startsWith(`${explicitVersion.slug}/`))) {
    normalized = normalized.slice(explicitVersion.slug.length).replace(/^\/+/, '');
  }
  const activeLanguage = activeLanguageCode(snapshot, lang);
  const docsVersion = explicitVersion ?? activeVersion(snapshot, version);
  const versionPages = pagesForVersion(snapshot, docsVersion);

  const findIn = (langCode: string) => {
    const langPages = pagesForLanguage(versionPages, langCode);
    const found =
      langPages.find((p) => p.path === normalized && p.kind === 'PAGE' && !p.hidden) ??
      (normalized === '' ? firstPage(langPages, langCode) : undefined);
    return found ? { page: found, pages: langPages } : undefined;
  };

  // Try the active language; fall back to the default language's pages before 404.
  const defaultCode = defaultLanguage(snapshot.project).code;
  const match = findIn(activeLanguage) ?? (activeLanguage === defaultCode ? undefined : findIn(defaultCode));
  if (!match) {
    throw notFound('page', { path: normalized });
  }
  const { page, pages } = match;
  const navLanguage = page.languageCode || activeLanguage;

  const order = flattenNav(buildNavTree(pages, navLanguage));
  const index = order.findIndex((node) => node.path === page.path);
  const breadcrumbs = breadcrumbTrail(pages, page);

  const pageLanguage = snapshot.project.languages.find((l) => l.code === navLanguage);
  // hreflang alternates: link this page to its translations. When the page has a
  // `translationKey`, match by that (so languages whose slugs differ — e.g. EN
  // "introduction-merged" ↔ AR "introduction" — still pair up, using each
  // language's OWN path). Otherwise fall back to a same-path match. Languages with
  // no corresponding page get path:null and are omitted from hreflang, so we never
  // point a crawler at a missing or wrong-language URL.
  const alternates = snapshot.project.languages.map((l) => {
    const sibling = versionPages.find(
      (p) =>
        p.languageCode === l.code &&
        p.kind === 'PAGE' &&
        !p.hidden &&
        (page.translationKey ? p.translationKey === page.translationKey : p.path === page.path),
    );
    return { code: l.code, isDefault: l.isDefault, path: sibling ? sibling.path : null };
  });
  return {
    project: snapshot.project,
    // The language the page actually resolved in (may differ from the requested
    // ?lang when it fell back) — canonical/og/hreflang are built from this.
    activeLanguage: navLanguage,
    activeVersion: docsVersion.slug,
    versions: versionsForSnapshot(snapshot),
    page: {
      id: page.id,
      title: page.title,
      description: pageDescription(page),
      icon: page.icon,
      path: page.path,
      content: page.content,
      headings: extractHeadings(page.content),
      // Per-page SEO + layout behaviour overrides (highest precedence in head()).
      config: page.config ?? null,
    },
    // SEO defaults of this page's language — layered under the page's own SEO.
    languageConfig: pageLanguage?.config ?? null,
    // Surfaced for hreflang alternates in per-page SEO (path null = no such page).
    languages: alternates,
    breadcrumbs,
    prev: index > 0 ? neighbour(order[index - 1]) : null,
    next: index >= 0 && index < order.length - 1 ? neighbour(order[index + 1]) : null,
  };
};

const firstPage = (pages: SnapshotPage[], languageCode?: string): SnapshotPage | undefined => {
  const first = flattenNav(buildNavTree(pages, languageCode))[0];
  return first ? pages.find((p) => p.path === first.path) : undefined;
};

const neighbour = (node?: NavNode) => (node ? { title: node.title, path: node.path } : null);

const breadcrumbTrail = (pages: SnapshotPage[], page: SnapshotPage): Array<{ title: string; path: string }> => {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const trail: Array<{ title: string; path: string }> = [];
  let current: SnapshotPage | undefined = page;
  while (current) {
    trail.unshift({ title: current.title, path: current.path });
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return trail;
};

/** Full-text + fuzzy search over a published site; records a search analytics event.
 *  Scoped to the active language so each language has its own index. */
export const searchSite = async (identifier: string, query: string, lang?: string, limit?: number, version?: string) => {
  const { snapshot, deploymentId } = await getPublished(identifier);
  const activeLanguage = activeLanguageCode(snapshot, lang);
  const docsVersion = activeVersion(snapshot, version);
  const versionPages = pagesForVersion(snapshot, docsVersion);
  const index = await getCachedIndex(snapshot.project.id, `${deploymentId}:${docsVersion.slug}`, activeLanguage, versionPages);
  const hits = await searchDocs(index, query, { limit });
  // Only track queries of a meaningful length so the search-terms analytics
  // aren't flooded with single-keystroke typeahead fragments (i, in, int…).
  if (query.trim().length >= 3) {
    await trackEvent(snapshot.project.id, { type: 'search', query: query.trim() } as TrackEventBody).catch(() => undefined);
  }
  return { hits };
};

/** Public changelog for a site, derived from its READY deployments (newest first). */
export const getSiteChangelog = async (identifier: string) => {
  // Load (and visibility-gate) the published site first so a private site's
  // release history isn't exposed to anonymous visitors.
  const { snapshot } = await getPublished(identifier);
  const projectId = snapshot.project.id;
  const deployments = await prisma.deployment.findMany({
    where: { projectId, status: 'READY' },
    orderBy: { version: 'desc' },
    select: { version: true, completedAt: true, commitMessage: true, pagesCount: true },
  });
  return deployments.map((d) => ({
    version: d.version,
    date: d.completedAt,
    title: d.commitMessage || `Published v${d.version}`,
    pages: d.pagesCount,
  }));
};

/** Classify a User-Agent into a coarse device bucket for the analytics breakdown. */
const deviceFromUserAgent = (ua: string | null): string => {
  if (!ua) {
    return 'unknown';
  }
  if (/tablet|ipad|playbook|silk|android(?!.*mobile)/i.test(ua)) {
    return 'tablet';
  }
  if (/mobi|iphone|ipod|android.*mobile|blackberry|iemobile|opera mini/i.test(ua)) {
    return 'mobile';
  }
  return 'desktop';
};

/** Record a public pageview for a published site. Derives the device class from
 *  the User-Agent (and country from a CDN geo header, when present) so the
 *  analytics breakdowns are populated. */
export const recordSiteEvent = async (identifier: string, body: TrackEventBody) => {
  const projectId = await resolveProjectId(identifier);
  const headers = getContext<HonoEnv>().req.raw.headers;
  const device = deviceFromUserAgent(headers.get('user-agent'));
  const country = headers.get('cf-ipcountry') ?? headers.get('x-vercel-ip-country') ?? undefined;
  await trackEvent(projectId, body, { device, country }).catch(() => undefined);
  return { ok: true };
};

const escapeXml = (value: string): string =>
  value.replace(/[<>&'"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char] ?? char);

/** XML sitemap of every indexable (non-hidden, non-noindex) page across all
 *  languages of a site. Private/unpublished sites throw notFound (so they stay
 *  out of sitemaps); pages/languages marked noindex are excluded so the sitemap
 *  never contradicts the per-page `<meta robots noindex>` we serve. The default
 *  language emits clean (param-less) URLs to match the page's own canonical. */
export const getSiteSitemap = async (identifier: string): Promise<string> => {
  const { snapshot } = await getPublished(identifier);
  const base = `${env.APP_URL}/sites/${snapshot.project.id}`;
  const lastmod = snapshot.generatedAt;
  const config = snapshot.project.config as { visibility?: string; seo?: { allowIndex?: boolean } } | null;
  // A private or index-disabled site has an empty sitemap.
  if (config?.visibility === 'private' || config?.seo?.allowIndex === false) {
    return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>';
  }
  const defaultCode = defaultLanguage(snapshot.project).code;
  // Languages whose own SEO disallows indexing are excluded entirely.
  const blockedLangs = new Set(snapshot.project.languages.filter((l) => l.config?.seo?.allowIndex === false).map((l) => l.code));
  const urls = snapshot.pages
    .filter((page) => page.kind === 'PAGE' && !page.hidden && !page.config?.seo?.noindex && !blockedLangs.has(page.languageCode))
    .map((page) => {
      // Default-language pages use the clean URL (no ?lang) — their canonical.
      const pageVersion = versionsForSnapshot(snapshot).find((v) => pageBelongsToVersion(page, v));
      const versionPath = pageVersion && !pageVersion.isDefault ? `/${encodeURIComponent(pageVersion.slug)}` : '';
      const pagePath = page.path ? `/${page.path}` : '';
      const langQuery = page.languageCode && page.languageCode !== defaultCode ? `?lang=${encodeURIComponent(page.languageCode)}` : '';
      const loc = `${base}${versionPath}${pagePath}${langQuery}`;
      const lastmodTag = lastmod ? `<lastmod>${escapeXml(new Date(lastmod).toISOString())}</lastmod>` : '';
      return `  <url><loc>${escapeXml(loc)}</loc>${lastmodTag}</url>`;
    });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`;
};

/** robots.txt for a published site, pointing crawlers at its sitemap. The
 *  sitemap is reachable at the app origin through the same-origin /api proxy
 *  (until per-site custom domains serve it from the domain root). */
export const getSiteRobots = async (identifier: string): Promise<string> => {
  const { snapshot } = await getPublished(identifier);
  const projectId = snapshot.project.id;
  const config = snapshot.project.config as { visibility?: string; seo?: { allowIndex?: boolean } } | null;
  // A private or index-disabled site disallows all crawling and omits the sitemap.
  if (config?.visibility === 'private' || config?.seo?.allowIndex === false) {
    return 'User-agent: *\nDisallow: /\n';
  }
  return `User-agent: *\nAllow: /\nSitemap: ${env.APP_URL}/api/public/sites/${projectId}/sitemap.xml\n`;
};

/** Resolve a request Host (a connected, verified custom domain) to its project
 *  id — used by the app edge to serve custom domains at their own root. Returns
 *  null for unknown / unverified hosts. */
export const resolveDomainHost = async (host: string): Promise<string | null> => {
  const clean = (host ?? '').toLowerCase().split(':')[0]?.trim();
  if (!clean) {
    return null;
  }
  const domain = await prisma.domain.findFirst({ where: { domain: clean, verified: true }, select: { projectId: true } });
  if (domain?.projectId) {
    return domain.projectId;
  }

  const slug = projectSlugFromSubdomainHost(clean, env.SITE_BASE_DOMAIN);
  if (!slug) {
    return null;
  }
  const project = await prisma.project.findFirst({ where: { slug }, select: { id: true }, orderBy: { createdAt: 'asc' } });
  return project?.id ?? null;
};
