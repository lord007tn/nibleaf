import { auth } from '@plume/auth/server';
import { prisma } from '@plume/database';
import { searchDocs } from '@plume/search';
import {
  buildNavTree,
  defaultLanguage,
  extractHeadings,
  type NavNode,
  pageDescription,
  type SiteSnapshot,
  type SnapshotPage,
} from '@plume/shared/site';
import type { TrackEventBody } from '@plume/validators';
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

/** The published site shell: project branding + navigation tree (per language). */
export const getSite = async (identifier: string, lang?: string) => {
  const { snapshot, version } = await getPublished(identifier);
  const activeLanguage = activeLanguageCode(snapshot, lang);
  return {
    project: snapshot.project,
    languages: snapshot.project.languages,
    activeLanguage,
    nav: buildNavTree(snapshot.pages, activeLanguage),
    version,
    generatedAt: snapshot.generatedAt,
  };
};

/** Depth-first order of renderable pages — for prev/next links. */
const flattenNav = (nav: NavNode[]): NavNode[] =>
  nav.flatMap((node) => (node.kind === 'PAGE' ? [node, ...flattenNav(node.children)] : flattenNav(node.children)));

/** A single published page with TOC, breadcrumbs, and prev/next neighbours.
 *  Scoped to the active language, falling back to the default language. */
export const getSitePage = async (identifier: string, path: string, lang?: string) => {
  const { snapshot } = await getPublished(identifier);
  const normalized = path.replace(/^\/+|\/+$/g, '');
  const activeLanguage = activeLanguageCode(snapshot, lang);

  const findIn = (langCode: string) => {
    const langPages = pagesForLanguage(snapshot.pages, langCode);
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
  // hreflang alternates: a page "corresponds" across languages only when another
  // language has a page at the SAME path (the one deterministic cross-language
  // link, since per-language slugs are independent). Languages without a matching
  // page get path:null and are omitted from hreflang — so we never point a
  // crawler at a missing or wrong-language URL.
  const alternates = snapshot.project.languages.map((l) => {
    const has = snapshot.pages.some((p) => p.languageCode === l.code && p.path === page.path && p.kind === 'PAGE' && !p.hidden);
    return { code: l.code, isDefault: l.isDefault, path: has ? page.path : null };
  });
  return {
    project: snapshot.project,
    // The language the page actually resolved in (may differ from the requested
    // ?lang when it fell back) — canonical/og/hreflang are built from this.
    activeLanguage: navLanguage,
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
export const searchSite = async (identifier: string, query: string, lang?: string, limit?: number) => {
  const { snapshot, deploymentId } = await getPublished(identifier);
  const activeLanguage = activeLanguageCode(snapshot, lang);
  const index = await getCachedIndex(snapshot.project.id, deploymentId, activeLanguage, snapshot.pages);
  const hits = await searchDocs(index, query, { limit });
  if (query.trim()) {
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

/** Record a public pageview for a published site. */
export const recordSiteEvent = async (identifier: string, body: TrackEventBody) => {
  const projectId = await resolveProjectId(identifier);
  await trackEvent(projectId, body).catch(() => undefined);
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
      const langQuery = page.languageCode && page.languageCode !== defaultCode ? `?lang=${encodeURIComponent(page.languageCode)}` : '';
      const loc = `${base}${page.path ? `/${page.path}` : ''}${langQuery}`;
      const lastmodTag = lastmod ? `<lastmod>${escapeXml(new Date(lastmod).toISOString())}</lastmod>` : '';
      return `  <url><loc>${escapeXml(loc)}</loc>${lastmodTag}</url>`;
    });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`;
};

/** robots.txt for a published site, pointing crawlers at its sitemap. The
 *  sitemap is reachable at the app origin through the same-origin /api proxy
 *  (until per-site custom domains serve it from the domain root). */
export const getSiteRobots = async (identifier: string): Promise<string> => {
  const projectId = await resolveProjectId(identifier);
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
  return domain?.projectId ?? null;
};
