import type { PublicAnalyticsEvent } from '@nibleaf/clickhouse';
import { prisma } from '@nibleaf/database';
import type { SearchScope } from '@nibleaf/search';
import { searchDocs } from '@nibleaf/search';
import {
  buildNavTree,
  defaultLanguage,
  extractHeadings,
  isPageTranslation,
  mergeLanguageChrome,
  type NavNode,
  pageDescription,
  projectSlugFromSubdomainHost,
  publicLanguages,
  publicSiteSnapshot,
  resolvePageCategory,
  type SiteSnapshot,
  type SnapshotLanguageConfig,
  type SnapshotPage,
  type SnapshotProject,
  type SnapshotVersion,
  withOpenApiNav,
} from '@nibleaf/shared/site';
import { getContext } from 'hono/context-storage';
import { env } from '@/env';
import { AppError, notFound } from '@/errors';
import { consumeAnswerQuota } from '@/lib/ai-search/quota';
import { answerPublishedSearch, answerSearchAvailable, runPublishedSearch } from '@/lib/ai-search/runtime';
import { buildChangelogRss } from '@/lib/changelog-rss';
import type { HonoEnv } from '@/lib/hono/context';
import { buildLlmsFullTxt, buildLlmsTxt } from '@/lib/llms-txt';
import { LruCache, TtlCache } from '@/lib/lru';
import { overlayLiveConfigPreservingPublishedRedirects } from '@/lib/published-config';
import { filterPagesForReader } from '@/lib/reader-scope';
import { getCachedIndex } from '@/lib/search-cache';
import { resolvePublishedSearchContext } from '@/lib/search-configuration';
import { trackProjectEvent } from './analytics';
import { stableHash } from './importers/content';
import { createNotificationsForOrgMembers } from './notifications';
import { resolveViewerAccess, type ViewerAccess } from './reader-access';

/** Resolve a published site by its canonical project id. */
const resolveProjectId = async (identifier: string): Promise<string> => {
  const byId = await prisma.project.findUnique({ where: { id: identifier }, select: { id: true } });
  if (!byId) {
    throw notFound('site', { identifier });
  }
  return byId.id;
};

interface PublishedSite {
  snapshot: SiteSnapshot;
  version: number;
  deploymentId: string;
  viewer: ViewerAccess;
}

/** The live, non-versioned site chrome fields read off the Project row. */
interface LiveChromeRow {
  name: string;
  description: string | null;
  icon: string | null;
  config: unknown;
  accessMode: 'PUBLIC' | 'WORKSPACE' | 'READERS';
  /** Moderation kill switch — a taken-down project must stop serving. */
  takedownAt: Date | null;
  /** Best verified domain (isPrimary first, oldest verified as fallback). */
  domains: { domain: string }[];
  /** Live per-language serving toggle + chrome/SEO overrides, so disabling a
   *  language or editing its localized chrome applies without a re-publish. */
  languages: {
    code: string;
    enabled: boolean;
    config: unknown;
    projectTranslations: { name: string | null; description: string | null }[];
  }[];
}

/** A snapshot project enriched with the fields the published-site edge needs
 *  (canonical/301 consolidation in apps/app reads `primaryDomain`). */
type PublicSnapshotProject = SnapshotProject & { primaryDomain: string | null; accessMode: 'PUBLIC' | 'WORKSPACE' | 'READERS' };

/** Deployment snapshots are immutable per deployment id, so deserializing the
 *  (potentially large) JSONB once per instance instead of once per page view is
 *  safe. Bounded LRU: cold sites fall out; a re-publish gets a new deployment
 *  id and therefore a fresh slot automatically. */
const snapshotCache = new LruCache<string, SiteSnapshot>(50);

/** Built llms.txt / llms-full.txt bodies are a pure function of the frozen
 *  snapshot's pages, so memoize them per deployment id — llms-full re-serializes
 *  every page's full Markdown, making it the most expensive public response to
 *  rebuild per request. Keyed by (immutable) deployment id, so a re-publish gets
 *  a fresh slot. Privacy is preserved: the visibility/index gate below returns an
 *  empty document BEFORE the cache is consulted, so a private site's content is
 *  never built into, or served from, these caches. */
const llmsTxtCache = new LruCache<string, string>(50);
const llmsFullTxtCache = new LruCache<string, string>(50);

/** Live project chrome is NOT frozen — config/appearance edits must show up on
 *  the live site within seconds, so this cache is TTL-bounded at 15s. Executable
 *  redirects are the exception and remain sourced from the READY snapshot. */
const liveChromeCache = new TtlCache<string, LiveChromeRow | null>(200, 15_000);

/** Apply local settings mutations immediately. Other API replicas remain
 * bounded by the documented 15-second live-chrome TTL. */
export const invalidatePublishedSiteConfig = (projectId: string): void => {
  liveChromeCache.delete(projectId);
};

const getLiveChrome = async (projectId: string): Promise<LiveChromeRow | null> => {
  const cached = liveChromeCache.get(projectId);
  if (cached !== undefined) {
    return cached;
  }
  const live = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      name: true,
      description: true,
      icon: true,
      config: true,
      accessMode: true,
      takedownAt: true,
      // ONLY an explicitly-designated primary domain may become the canonical /
      // 301 target. `verified` proves TXT ownership, not that the domain's CNAME
      // resolves here — consolidating onto a merely-verified domain would 301 a
      // working site into a host that does not serve it yet.
      domains: {
        where: { verified: true, isPrimary: true },
        orderBy: [{ verifiedAt: 'asc' }, { createdAt: 'asc' }],
        take: 1,
        select: { domain: true },
      },
      languages: {
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        select: {
          code: true,
          enabled: true,
          config: true,
          projectTranslations: { where: { projectId }, take: 1, select: { name: true, description: true } },
        },
      },
    },
  });
  liveChromeCache.set(projectId, live);
  return live;
};

/** Overlay live, non-versioned site chrome from the Project row onto a snapshot
 *  project. Branding and config (styling, navbar/footer, SEO, visibility,
 *  analytics, variables) reflect the current settings so appearance edits are
 *  live without a re-publish. Redirects, content, pages, languages and versions
 *  are left as captured — those are routing/versioned data a publish freezes.
 *  Returns a new object so the cached snapshot is never mutated per-request. */
const overlayLiveChrome = (project: SnapshotProject, live: LiveChromeRow | null): SnapshotProject => {
  if (!live) {
    return project;
  }
  // Overlay each frozen language's live `enabled` flag and config (matched by
  // code) so disabling a language, or editing its localized chrome/SEO, applies
  // within the cache TTL without a re-publish. The frozen language LIST stays
  // authoritative: languages added since the publish have no published pages,
  // so they never appear publicly until the next publish, and the frozen
  // label/direction/isDefault keep the exactly-one-default invariant intact.
  const liveByCode = new Map(live.languages.map((language) => [language.code, language]));
  return {
    ...project,
    name: live.name,
    description: live.description,
    icon: live.icon,
    config: overlayLiveConfigPreservingPublishedRedirects(project.config, (live.config as Record<string, unknown> | null) ?? {}),
    languages: project.languages.map((language) => {
      const row = liveByCode.get(language.code);
      if (!row) return language;
      const translation = row.projectTranslations[0];
      const base = (row.config as SnapshotLanguageConfig | null) ?? {};
      const config = {
        ...base,
        ...(translation?.name ? { name: translation.name } : {}),
        ...(translation?.description ? { description: translation.description } : {}),
      };
      return { ...language, enabled: row.enabled, config: Object.keys(config).length > 0 ? config : null };
    }),
  };
};

/** Moderation gate reusable by public surfaces that never load a snapshot (asset
 *  proxy, event tracking). Reads through the same 15s live-chrome cache, so a
 *  takedown stops every public surface within one TTL. */
export const isProjectTakenDown = async (projectId: string): Promise<boolean> => {
  const live = await getLiveChrome(projectId).catch(() => null);
  return Boolean(live?.takedownAt);
};

export const getProjectDeliveryAccess = async (projectId: string, headers: Headers): Promise<ViewerAccess | null> => {
  const live = await getLiveChrome(projectId).catch(() => null);
  if (!live || live.takedownAt) return null;
  return resolveViewerAccess(projectId, live.accessMode, headers);
};

const getPublished = async (identifier: string): Promise<PublishedSite> => {
  const projectId = await resolveProjectId(identifier);
  // Live chrome doubles as the moderation gate: a taken-down project stops
  // serving within the cache TTL (15s). notFound (not forbidden) so a taken
  // down site's existence is not advertised.
  const live = await getLiveChrome(projectId);
  if (live?.takedownAt) {
    throw notFound('site', { identifier, reason: 'takedown' });
  }
  // Cheap metadata-only lookup — the heavy `snapshot` JSONB column is only
  // fetched (and parsed) on a cache miss for this deployment id.
  const deployment = await prisma.deployment.findFirst({
    where: { projectId, status: 'READY' },
    orderBy: { version: 'desc' },
    select: { id: true, version: true },
  });
  if (!deployment) {
    throw notFound('site', { identifier, reason: 'not_published' });
  }
  let frozen = snapshotCache.get(deployment.id);
  if (!frozen) {
    const row = await prisma.deployment.findUnique({ where: { id: deployment.id }, select: { snapshot: true } });
    if (!row?.snapshot) {
      throw notFound('site', { identifier, reason: 'not_published' });
    }
    frozen = row.snapshot as unknown as SiteSnapshot;
    snapshotCache.set(deployment.id, frozen);
  }
  // Overlay the LIVE site chrome (branding, styling, navbar/footer, SEO,
  // visibility, analytics) over the frozen snapshot so config/appearance edits
  // apply to the live site within seconds — without a re-publish. Page CONTENT
  // and navigation STRUCTURE stay frozen in the snapshot (those are the
  // versioned docs that a publish captures); redirects are also kept frozen so
  // they switch atomically with the READY snapshot. The copy keeps the shared
  // cached snapshot immutable.
  // `primaryDomain` rides along so the app edge can consolidate canonicals and
  // 301 secondary origins onto the verified primary domain.
  const overlaid = overlayLiveChrome(frozen.project, live);
  const accessMode = live?.accessMode ?? 'PUBLIC';
  const project: PublicSnapshotProject = {
    ...overlaid,
    // Keep the legacy config flag coherent for older clients and SEO helpers,
    // while the database enum remains the authorization source of truth.
    config: { ...(overlaid.config ?? {}), visibility: accessMode === 'PUBLIC' ? 'public' : 'private' },
    primaryDomain: live?.domains[0]?.domain.toLowerCase() ?? null,
    accessMode,
  };
  const viewer = await resolveViewerAccess(projectId, live?.accessMode ?? 'PUBLIC', getContext<HonoEnv>().req.raw.headers);
  if (!viewer) {
    throw notFound('site', { identifier: projectId, reason: 'private' });
  }
  const pages = filterPagesForReader(frozen.pages, viewer.allowedPageIds);
  const snapshot: SiteSnapshot = { ...frozen, project, pages };
  return { snapshot, version: deployment.version, deploymentId: deployment.id, viewer };
};

/** Resolve the active language code: the requested `lang` if it exists in the
 *  snapshot AND is enabled, otherwise the project's default language. A request
 *  for a disabled language therefore falls back to the default instead of
 *  serving hidden content. */
const activeLanguageCode = (snapshot: SiteSnapshot, lang?: string): string => {
  if (lang && publicLanguages(snapshot.project.languages).some((l) => l.code === lang)) {
    return lang;
  }
  return defaultLanguage(snapshot.project).code;
};

/** Only the pages belonging to a given language. */
const pagesForLanguage = (pages: SnapshotPage[], lang: string): SnapshotPage[] => pages.filter((p) => p.languageCode === lang);

const defaultVersion = (snapshot: SiteSnapshot): SnapshotVersion => {
  const defaults = snapshot.project.versions.filter((version) => version.isDefault);
  if (defaults.length !== 1 || !defaults[0]) {
    throw new Error(`Snapshot project ${snapshot.project.id} must have exactly one default version.`);
  }
  return defaults[0];
};

const activeVersion = (snapshot: SiteSnapshot, version?: string): SnapshotVersion => {
  const requested = version?.trim();
  if (requested) {
    const match = snapshot.project.versions.find((candidate) => candidate.slug === requested);
    if (match) {
      return match;
    }
  }
  return defaultVersion(snapshot);
};

const matchingVersion = (snapshot: SiteSnapshot, version?: string): SnapshotVersion | undefined => {
  const requested = version?.trim();
  if (!requested) {
    return undefined;
  }
  return snapshot.project.versions.find((candidate) => candidate.slug === requested);
};

const pageBelongsToVersion = (page: SnapshotPage, version: SnapshotVersion): boolean => page.versionId === version.id;

const pagesForVersion = (snapshot: SiteSnapshot, version: SnapshotVersion): SnapshotPage[] =>
  snapshot.pages.filter((page) => pageBelongsToVersion(page, version));

/** The published site shell: project branding + navigation tree (per language). */
export const getSite = async (identifier: string, lang?: string, version?: string) => {
  const { snapshot, version: deploymentVersion } = await getPublished(identifier);
  const docsVersion = activeVersion(snapshot, version);
  const activeLanguage = activeLanguageCode(snapshot, lang);
  const versionPages = pagesForVersion(snapshot, docsVersion);
  // Only enabled languages are exposed publicly (switcher, hreflang, payload).
  const servedLanguages = publicLanguages(snapshot.project.languages);
  // The ACTIVE language's config (localized site name/description + per-language
  // SEO defaults) — sourced from the snapshot exactly like getSitePage's
  // languageConfig, so the site chrome can localize its brand + description.
  const shellLanguage = servedLanguages.find((language) => language.code === activeLanguage);
  // Overlay the active language's chrome overrides (navbar/footer/banner/search)
  // onto the project config AFTER the live-chrome overlay (done in getPublished),
  // so the published-site chrome keeps reading `project.config` unchanged.
  // NEVER for the default language: in the settings model the "Default" scope IS
  // the project config, so a language later promoted to default must not keep
  // applying chrome overrides it accumulated while it was secondary.
  const project = {
    ...snapshot.project,
    config: shellLanguage?.isDefault ? snapshot.project.config : mergeLanguageChrome(snapshot.project.config, shellLanguage?.config),
    languages: servedLanguages,
  };
  return {
    project,
    languages: servedLanguages,
    versions: snapshot.project.versions,
    activeLanguage,
    activeVersion: docsVersion.slug,
    languageConfig: shellLanguage?.config ?? null,
    nav: withOpenApiNav(buildNavTree(versionPages, activeLanguage), snapshot.openapi),
    openapi: snapshot.openapi
      ? {
          title: snapshot.openapi.title,
          path: snapshot.openapi.path,
          contentHash: snapshot.openapi.contentHash,
          updatedAt: snapshot.openapi.updatedAt,
        }
      : null,
    version: deploymentVersion,
    generatedAt: snapshot.generatedAt,
  };
};

/** The immutable published OpenAPI document. This goes through the exact same
 *  publication, takedown, and private-site membership gates as pages. */
export const getSiteOpenApi = async (identifier: string) => {
  const { snapshot } = await getPublished(identifier);
  if (!snapshot.openapi) {
    throw notFound('OpenAPI document', { identifier });
  }
  return {
    document: snapshot.openapi.document,
    metadata: {
      title: snapshot.openapi.title,
      path: snapshot.openapi.path,
      contentHash: snapshot.openapi.contentHash,
      updatedAt: snapshot.openapi.updatedAt,
    },
    project: snapshot.project,
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
      (normalized === '' ? firstPage(langPages, langCode) : undefined) ??
      // A group/section prefix (e.g. a navbar tab pointing at `/guides`)
      // resolves to its first page in nav order, Mintlify-style. Paths with no
      // pages beneath them still 404.
      firstPageUnder(langPages, langCode, normalized);
    return found ? { page: found, pages: langPages } : undefined;
  };

  // Try the active language; fall back to the default language's pages before 404.
  const defaultCode = defaultLanguage(snapshot.project).code;
  const match = findIn(activeLanguage) ?? (activeLanguage === defaultCode ? undefined : findIn(defaultCode));
  if (!match) {
    throw notFound('page', { path: normalized });
  }
  const { page, pages } = match;
  const navLanguage = page.languageCode;

  const order = flattenNav(buildNavTree(pages, navLanguage));
  const index = order.findIndex((node) => node.path === page.path);
  const breadcrumbs = breadcrumbTrail(pages, page);
  const siblingPages = pages.filter((candidate) => candidate.kind === 'PAGE' && candidate.parentId === page.parentId);
  const category = resolvePageCategory(page, siblingPages.length)?.title;
  if (category && breadcrumbs.at(-2)?.title !== category) {
    const categoryLanding = siblingPages
      .filter((candidate) => candidate.languageCode === page.languageCode && resolvePageCategory(candidate, siblingPages.length)?.title === category)
      .sort((a, b) => a.position - b.position)[0];
    breadcrumbs.splice(-1, 0, { title: category, path: categoryLanding?.path ?? page.path });
  }

  const servedLanguages = publicLanguages(snapshot.project.languages);
  const pageLanguage = servedLanguages.find((l) => l.code === navLanguage);
  const currentPageIndexable = page.config?.seo?.noindex !== true && pageLanguage?.config?.seo?.allowIndex !== false;
  // hreflang alternates: link this page to its translations. When the page has a
  // `translationKey`, match by that (so languages whose slugs differ — e.g. EN
  // "introduction-merged" ↔ AR "introduction" — still pair up, using each
  // language's OWN path). Otherwise fall back to a same-path match. Languages with
  // no corresponding page get path:null and are omitted from hreflang, so we never
  // point a crawler at a missing or wrong-language URL. Disabled languages are
  // excluded entirely — their pages aren't served, so they must not be linked.
  const alternates = servedLanguages.map((l) => {
    const sibling = versionPages.find(
      (p) => p.languageCode === l.code && p.kind === 'PAGE' && !p.hidden && p.config?.seo?.noindex !== true && isPageTranslation(page, p),
    );
    const languageIndexable = l.config?.seo?.allowIndex !== false;
    return { code: l.code, isDefault: l.isDefault, path: currentPageIndexable && languageIndexable && sibling ? sibling.path : null };
  });
  return {
    // Same per-language chrome merge as getSite, applied for the language the
    // page actually resolved in (after the live-chrome overlay in getPublished).
    // Skipped for the default language — its scope IS the project config.
    project: {
      ...snapshot.project,
      config: pageLanguage?.isDefault ? snapshot.project.config : mergeLanguageChrome(snapshot.project.config, pageLanguage?.config),
      languages: servedLanguages,
    },
    // The language the page actually resolved in (may differ from the requested
    // ?lang when it fell back) — canonical/og/hreflang are built from this.
    activeLanguage: navLanguage,
    activeVersion: docsVersion.slug,
    versions: snapshot.project.versions,
    page: {
      id: page.id,
      // Snapshots published before this field was introduced still get a
      // truthful lower-bound publication date from their last modification.
      createdAt: page.createdAt ?? page.updatedAt,
      updatedAt: page.updatedAt,
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

/** First renderable page whose path sits under `prefix/` — resolves group URLs. */
const firstPageUnder = (pages: SnapshotPage[], languageCode: string | undefined, prefix: string): SnapshotPage | undefined => {
  if (!prefix) {
    return undefined;
  }
  const first = flattenNav(buildNavTree(pages, languageCode)).find((node) => node.path.startsWith(`${prefix}/`));
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
  const analyticsStartedAt = performance.now();
  const { snapshot, deploymentId, viewer } = await getPublished(identifier);
  const request = resolvePublishedSearchContext(snapshot, { language: lang, version, limit });
  const activeLanguage = request.language;
  const docsVersion = request.version;
  const versionPages = pagesForVersion(snapshot, docsVersion);
  const resultLimit = request.limit;
  const scope: SearchScope = {
    projectId: snapshot.project.id,
    deploymentId,
    versionSlug: docsVersion.slug,
    language: activeLanguage,
    visibility: (snapshot.project as PublicSnapshotProject).accessMode === 'PUBLIC' ? 'public' : 'private',
    allowedPageIds: viewer.allowedPageIds,
  };
  const result = await runPublishedSearch(
    scope,
    query,
    resultLimit,
    async () => {
      const index = await getCachedIndex(
        snapshot.project.id,
        `${deploymentId}:${docsVersion.slug}`,
        activeLanguage,
        versionPages,
        viewer.allowedPageIds,
      );
      return searchDocs(index, query, { limit: resultLimit });
    },
    getContext<HonoEnv>().req.raw.signal,
  );
  // Only track queries of a meaningful length so the search-terms analytics
  // aren't flooded with single-keystroke typeahead fragments (i, in, int…).
  if (query.trim().length >= 3) {
    const latencyMs = Math.max(0, Math.round(performance.now() - analyticsStartedAt));
    const base = { source: 'public_site' as const, consentState: 'unknown' as const };
    void Promise.allSettled([
      trackProjectEvent(snapshot.project.id, { name: 'search_query_submitted', query: query.trim(), language: activeLanguage }, base),
      trackProjectEvent(
        snapshot.project.id,
        { name: 'search_results_returned', resultCount: result.hits.length, latencyMs, cacheStatus: 'unknown', language: activeLanguage },
        base,
      ),
      ...(result.hits.length === 0
        ? [
            trackProjectEvent(
              snapshot.project.id,
              { name: 'search_zero_result', resultCount: 0, latencyMs, noAnswerReason: 'no_match', language: activeLanguage },
              base,
            ),
          ]
        : []),
    ]);
  }
  return { hits: result.hits, runtime: result.runtime, capabilities: { answer: request.configuration.aiAnswers && answerSearchAvailable() } };
};

/** Grounded answer mode uses the exact same server-derived publication and
 * reader scope as results mode. The client cannot submit any tenant/page filter. */
export const answerSite = async (identifier: string, query: string, lang?: string, version?: string) => {
  const { snapshot, deploymentId, viewer } = await getPublished(identifier);
  const request = resolvePublishedSearchContext(snapshot, { language: lang, version });
  if (!request.configuration.aiAnswers || !answerSearchAvailable()) {
    throw new AppError({ code: 'search:unavailable', message: 'AI answers are not configured for this Nibleaf instance.' });
  }
  const activeLanguage = request.language;
  const docsVersion = request.version;
  const quota = await consumeAnswerQuota(snapshot.project.id).catch((cause) => {
    throw new AppError({ code: 'search:unavailable', message: 'AI answer quota service is unavailable.', cause });
  });
  if (!quota.allowed) {
    throw new AppError({ code: 'http:rate_limited', message: 'This site has reached its daily AI answer quota.' });
  }
  const scope: SearchScope = {
    projectId: snapshot.project.id,
    deploymentId,
    versionSlug: docsVersion.slug,
    language: activeLanguage,
    visibility: (snapshot.project as PublicSnapshotProject).accessMode === 'PUBLIC' ? 'public' : 'private',
    allowedPageIds: viewer.allowedPageIds,
  };
  const answer = await answerPublishedSearch(scope, query, getContext<HonoEnv>().req.raw.signal).catch((cause) => {
    if (cause instanceof AppError) throw cause;
    throw new AppError({ code: 'search:unavailable', message: 'AI answer generation is temporarily unavailable.', cause });
  });
  return { ...answer, quotaRemaining: quota.remaining };
};

const changelogEntries = async (projectId: string) => {
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

/** Public changelog for a site, derived from its READY deployments (newest first). */
export const getSiteChangelog = async (identifier: string) => {
  // Load (and visibility-gate) the published site first so a private site's
  // release history isn't exposed to anonymous visitors.
  const { snapshot } = await getPublished(identifier);
  return changelogEntries(snapshot.project.id);
};

/** RSS 2.0 representation of the same immutable release history. The app edge
 * rebases internal /sites/:id URLs to a verified custom domain when present. */
export const getSiteChangelogRss = async (identifier: string): Promise<SiteTextDocument> => {
  const { snapshot } = await getPublished(identifier);
  const entries = await changelogEntries(snapshot.project.id);
  const config = seoConfigOf(snapshot);
  return {
    body: buildChangelogRss({
      baseUrl: `${env.APP_URL}/sites/${snapshot.project.id}`,
      title: snapshot.project.name,
      description: snapshot.project.description || snapshot.project.name,
      entries,
    }),
    isPrivate: config?.visibility === 'private',
  };
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

/** How long one feedback notification "covers" a project: while an UNREAD
 *  feedback notification younger than this exists, further feedback events
 *  don't fan out again (a burst of reader votes → one bell entry). */
const FEEDBACK_NOTIFICATION_WINDOW_MS = 60 * 60 * 1000;

/** Fan a reader-feedback event out to the org's bell inboxes, throttled per
 *  project. Best-effort: the public track endpoint must never fail on this. */
const notifyFeedback = async (projectId: string, body: PublicAnalyticsEvent): Promise<void> => {
  try {
    const recentUnread = await prisma.notification.findFirst({
      where: {
        projectId,
        type: 'feedback',
        readAt: null,
        createdAt: { gt: new Date(Date.now() - FEEDBACK_NOTIFICATION_WINDOW_MS) },
      },
      select: { id: true },
    });
    if (recentUnread) {
      return;
    }
    const sentiment = body.payload.name === 'feedback_submitted' ? (body.payload.feedback === 'helpful' ? 'helpful' : 'not helpful') : null;
    const feedbackPath = body.payload.name === 'feedback_submitted' ? body.payload.path : undefined;
    const page = feedbackPath ? `"${feedbackPath.slice(0, 120)}"` : 'a page';
    await createNotificationsForOrgMembers(projectId, {
      type: 'feedback',
      title: 'New reader feedback',
      body: sentiment ? `A reader marked ${page} as ${sentiment}.` : `A reader left feedback on ${page}.`,
      href: `/app/projects/${projectId}/analytics`,
    });
  } catch {
    // never fail the public event write over the inbox
  }
};

/** Record a public pageview for a published site. Derives the device class from
 *  the User-Agent (and country from a CDN geo header, when present) so the
 *  analytics breakdowns are populated. */
export const recordSiteEvent = async (identifier: string, body: PublicAnalyticsEvent) => {
  const projectId = await resolveProjectId(identifier);
  // A taken-down project must not keep accumulating analytics rows — this is the
  // one public write path that never goes through getPublished's gate.
  if (await isProjectTakenDown(projectId)) {
    throw notFound('site', { identifier, reason: 'takedown' });
  }
  const headers = getContext<HonoEnv>().req.raw.headers;
  if (!(await getProjectDeliveryAccess(projectId, headers))) {
    throw notFound('site', { identifier, reason: 'private' });
  }
  const device = deviceFromUserAgent(headers.get('user-agent'));
  const country = headers.get('cf-ipcountry') ?? headers.get('x-vercel-ip-country') ?? undefined;
  await trackProjectEvent(projectId, body.payload, {
    source: 'public_site',
    consentState: body.consentState,
    eventId: body.eventId,
    sessionId: body.sessionId,
    country,
    device,
  }).catch(() => undefined);
  if (body.payload.name === 'feedback_submitted') {
    await notifyFeedback(projectId, body);
  }
  return { ok: true };
};

const escapeXml = (value: string): string =>
  value.replace(/[<>&'"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char] ?? char);

/** A public plain-text/XML document for a site. `isPrivate` lets the handler
 *  decide cacheability: private-site responses vary by session cookie and must
 *  never get a shared (`public`) Cache-Control. */
export interface SiteTextDocument {
  body: string;
  isPrivate: boolean;
}

type SiteSeoConfig = { visibility?: string; seo?: { allowIndex?: boolean } } | null;

const seoConfigOf = (snapshot: SiteSnapshot): SiteSeoConfig => snapshot.project.config as SiteSeoConfig;

const isoTimestamp = (value: string, label: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Snapshot contains an invalid ${label} timestamp.`);
  }
  return date.toISOString();
};

/** XML sitemap of every indexable (non-hidden, non-noindex) page across all
 *  languages of a site. Private/unpublished sites throw notFound (so they stay
 *  out of sitemaps); pages/languages marked noindex are excluded so the sitemap
 *  never contradicts the per-page `<meta robots noindex>` we serve. The default
 *  language emits clean (param-less) URLs to match the page's own canonical. */
export const getSiteSitemap = async (identifier: string): Promise<SiteTextDocument> => {
  const { snapshot: published } = await getPublished(identifier);
  // Disabled languages (and their pages) are not served, so they never appear.
  const snapshot = publicSiteSnapshot(published);
  const base = `${env.APP_URL}/sites/${snapshot.project.id}`;
  const config = seoConfigOf(snapshot);
  const isPrivate = config?.visibility === 'private';
  // A private or index-disabled site has an empty sitemap.
  if (isPrivate || config?.seo?.allowIndex === false) {
    return { body: '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>', isPrivate };
  }
  const defaultCode = defaultLanguage(snapshot.project).code;
  // Languages whose own SEO disallows indexing are excluded entirely.
  const blockedLangs = new Set(snapshot.project.languages.filter((l) => l.config?.seo?.allowIndex === false).map((l) => l.code));
  const urls = snapshot.pages
    .filter(
      (page) =>
        page.kind === 'PAGE' &&
        !page.hidden &&
        !page.config?.seo?.noindex &&
        !page.config?.seo?.canonicalUrl?.trim() &&
        !blockedLangs.has(page.languageCode),
    )
    .map((page) => {
      // Default-language pages use the clean URL (no ?lang) — their canonical.
      const pageVersion = snapshot.project.versions.find((version) => pageBelongsToVersion(page, version));
      if (!pageVersion) {
        throw new Error(`Snapshot page ${page.id} references an unknown version.`);
      }
      const versionPath = !pageVersion.isDefault ? `/${encodeURIComponent(pageVersion.slug)}` : '';
      const pagePath = page.path ? `/${page.path}` : '';
      const langQuery = page.languageCode !== defaultCode ? `?lang=${encodeURIComponent(page.languageCode)}` : '';
      const loc = `${base}${versionPath}${pagePath}${langQuery}`;
      const lastmod = isoTimestamp(page.updatedAt, 'page updatedAt');
      return `  <url><loc>${escapeXml(loc)}</loc><lastmod>${escapeXml(lastmod)}</lastmod></url>`;
    });
  return {
    body: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`,
    isPrivate,
  };
};

/** robots.txt for a published site, pointing crawlers at its sitemap. The
 *  sitemap is reachable at the app origin through the same-origin /api proxy
 *  (until per-site custom domains serve it from the domain root). */
export const getSiteRobots = async (identifier: string): Promise<SiteTextDocument> => {
  const { snapshot } = await getPublished(identifier);
  const projectId = snapshot.project.id;
  const config = seoConfigOf(snapshot);
  const isPrivate = config?.visibility === 'private';
  // A private or index-disabled site disallows all crawling and omits the sitemap.
  if (isPrivate || config?.seo?.allowIndex === false) {
    return { body: 'User-agent: *\nDisallow: /\n', isPrivate };
  }
  return { body: `User-agent: *\nAllow: /\nSitemap: ${env.APP_URL}/api/public/sites/${projectId}/sitemap.xml\n`, isPrivate };
};

/** llms.txt for a published site (llmstxt.org): title, description and a
 *  Markdown link list of every indexable page — so AI assistants can consume
 *  the docs without scraping. Same privacy rules as the sitemap: anonymous
 *  visitors of private sites get 404 from getPublished, members get an empty
 *  document, and noindex pages/languages are excluded. */
/** llms bodies vary with the live per-language serving/indexing flags AND the
 *  live-overlaid project name/description (both overlay the frozen snapshot),
 *  so the cache key carries them alongside the deployment id — a language
 *  toggle or a project rename busts the cached document within the live-chrome
 *  TTL instead of serving a stale one. */
const llmsCacheKey = (deploymentId: string, snapshot: SiteSnapshot): string => {
  const flags = snapshot.project.languages
    .map((l) => `${l.code}=${l.enabled === false ? 0 : 1}${l.config?.seo?.allowIndex === false ? 'n' : 'y'}`)
    .join(',');
  const identity = stableHash(`${snapshot.project.name} ${snapshot.project.description ?? ''}`);
  return `${deploymentId}:${flags}:${identity}`;
};

export const getSiteLlmsTxt = async (identifier: string): Promise<SiteTextDocument> => {
  const { snapshot: published, deploymentId } = await getPublished(identifier);
  const config = seoConfigOf(published);
  const isPrivate = config?.visibility === 'private';
  if (isPrivate || config?.seo?.allowIndex === false) {
    return { body: '', isPrivate };
  }
  const cacheKey = llmsCacheKey(deploymentId, published);
  const cached = llmsTxtCache.get(cacheKey);
  if (cached !== undefined) {
    return { body: cached, isPrivate };
  }
  // Disabled languages (and their pages) are excluded, mirroring the sitemap.
  const snapshot = publicSiteSnapshot(published);
  const body = buildLlmsTxt(snapshot, `${env.APP_URL}/sites/${snapshot.project.id}`);
  llmsTxtCache.set(cacheKey, body);
  return { body, isPrivate };
};

/** llms-full.txt: the concatenated Markdown of every indexable page with
 *  per-page headers and source URLs. Same privacy rules as llms.txt. */
export const getSiteLlmsFullTxt = async (identifier: string): Promise<SiteTextDocument> => {
  const { snapshot: published, deploymentId } = await getPublished(identifier);
  const config = seoConfigOf(published);
  const isPrivate = config?.visibility === 'private';
  if (isPrivate || config?.seo?.allowIndex === false) {
    return { body: '', isPrivate };
  }
  const cacheKey = llmsCacheKey(deploymentId, published);
  const cached = llmsFullTxtCache.get(cacheKey);
  if (cached !== undefined) {
    return { body: cached, isPrivate };
  }
  const snapshot = publicSiteSnapshot(published);
  const body = buildLlmsFullTxt(snapshot, `${env.APP_URL}/sites/${snapshot.project.id}`);
  llmsFullTxtCache.set(cacheKey, body);
  return { body, isPrivate };
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
