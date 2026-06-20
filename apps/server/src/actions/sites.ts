import { prisma } from '@plume/database';
import { searchDocs } from '@plume/search';
import { buildNavTree, defaultLanguage, type NavNode, extractHeadings, pageDescription, type SiteSnapshot, type SnapshotPage } from '@plume/shared/site';
import type { TrackEventBody } from '@plume/validators';
import { notFound } from '@/errors';
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

const getPublished = async (identifier: string): Promise<PublishedSite> => {
  const projectId = await resolveProjectId(identifier);
  const deployment = await prisma.deployment.findFirst({ where: { projectId, status: 'READY' }, orderBy: { version: 'desc' } });
  if (!deployment?.snapshot) {
    throw notFound('site', { identifier, reason: 'not_published' });
  }
  return { snapshot: deployment.snapshot as unknown as SiteSnapshot, version: deployment.version, deploymentId: deployment.id };
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
const pagesForLanguage = (pages: SnapshotPage[], lang: string): SnapshotPage[] =>
  pages.filter((p) => (p.languageCode || lang) === lang);

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
const flattenNav = (nav: NavNode[]): NavNode[] => nav.flatMap((node) => (node.kind === 'PAGE' ? [node, ...flattenNav(node.children)] : flattenNav(node.children)));

/** A single published page with TOC, breadcrumbs, and prev/next neighbours.
 *  Scoped to the active language, falling back to the default language. */
export const getSitePage = async (identifier: string, path: string, lang?: string) => {
  const { snapshot } = await getPublished(identifier);
  const normalized = path.replace(/^\/+|\/+$/g, '');
  const activeLanguage = activeLanguageCode(snapshot, lang);

  const findIn = (langCode: string) => {
    const langPages = pagesForLanguage(snapshot.pages, langCode);
    const found = langPages.find((p) => p.path === normalized && p.kind === 'PAGE' && !p.hidden) ?? (normalized === '' ? firstPage(langPages, langCode) : undefined);
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

  return {
    project: snapshot.project,
    page: {
      id: page.id,
      title: page.title,
      description: pageDescription(page),
      icon: page.icon,
      path: page.path,
      content: page.content,
      headings: extractHeadings(page.content),
    },
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
  const projectId = await resolveProjectId(identifier);
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
