import { randomUUID } from 'node:crypto';
import type { AnalyticsPayload, ConsentState, PublicAnalyticsEvent } from '@nibleaf/clickhouse';
import { prisma } from '@nibleaf/database';
import type { SearchHit, SearchScope } from '@nibleaf/search';
import { searchDocs } from '@nibleaf/search';
import { type AddonDeliveryPlanAssignment, projectAddonRowsForDelivery, projectConfigWithAddons } from '@nibleaf/shared/addons';
import type { PublishedAssetReferences } from '@nibleaf/shared/asset-references';
import { isPublicMarkdownPage } from '@nibleaf/shared/public-markdown';
import {
  buildNavTree,
  defaultLanguage,
  explicitPageDescription,
  extractHeadings,
  isPageTranslation,
  mergeLanguageChrome,
  type NavNode,
  pageExcerpt,
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
import { AssetReferenceAccess } from '@/lib/asset-reference-access';
import { buildChangelogRss } from '@/lib/changelog-rss';
import type { HonoEnv } from '@/lib/hono/context';
import { buildLlmsFullTxt, buildLlmsTxt } from '@/lib/llms-txt';
import { LruCache, TtlCache } from '@/lib/lru';
import { sanitizePublishedSiteActionUrls } from '@/lib/published-action-urls';
import { overlayLiveConfigPreservingPublishedRedirects } from '@/lib/published-config';
import { buildPublishedPageMarkdown } from '@/lib/published-markdown';
import { filterPagesForReader } from '@/lib/reader-scope';
import { getCachedIndex } from '@/lib/search-cache';
import {
  resolvePreferredSearchLanguage,
  resolvePublishedSearchContext,
  resolvePublishedSearchLanguages,
  resolvePublishedSearchRequest,
} from '@/lib/search-configuration';
import { mergeLanguageSearchHits } from '@/lib/search-language-merge';
import { matchedSearchSection, type SearchHitSection } from '@/lib/search-sections';
import { trackProjectEvent, trackProjectEvents } from './analytics';
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

type LiveDeployment = { id: string; version: number; frozen: SiteSnapshot };

/** The live, non-versioned site chrome fields read off the Project row. */
interface LiveChromeRow {
  stamp: string | null;
  name: string;
  description: string | null;
  icon: string | null;
  config: unknown;
  accessMode: 'PUBLIC' | 'WORKSPACE' | 'READERS';
  /** Invited readers sites: whether the sign-in screen offers "Ask for access". */
  readerAccessRequests: boolean;
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
  addons: { key: string; enabled: boolean; config: unknown }[];
  organization: { usagePlan: AddonDeliveryPlanAssignment | null };
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
// Asset delivery accepts up to 15s of deployment lag; getPublished reads the current READY deployment directly.
const liveDeploymentCache = new TtlCache<string, LiveDeployment | null>(50, 15_000);
const assetReferences = new AssetReferenceAccess();
const assetHeadSelect = { id: true, version: true, assetReferenceBytes: true, assetSourceBytes: true, assetSourcePages: true } as const;
type AssetDeploymentHead = {
  id: string;
  version: number;
  assetReferenceBytes: number | null;
  assetSourceBytes: number | null;
  assetSourcePages: number | null;
};
const assetDeploymentHeads = new TtlCache<string, AssetDeploymentHead>(256, 15_000);
const deploymentMissCache = new TtlCache<string, { deploymentId: string; lookup: Promise<{ id: string; version: number } | null> }>(256, 1000);

/** Apply local settings mutations immediately. Other API replicas remain
 * bounded by the documented 15-second live-chrome TTL. */
export const invalidatePublishedSiteConfig = (projectId: string): void => {
  liveChromeCache.delete(projectId);
  liveDeploymentCache.delete(projectId);
  assetDeploymentHeads.delete(projectId);
  deploymentMissCache.delete(projectId);
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
      readerAccessRequests: true,
      takedownAt: true,
      addons: { select: { key: true, enabled: true, config: true } },
      organization: {
        select: {
          usagePlan: {
            select: {
              status: true,
              effectiveAt: true,
              expiresAt: true,
              plan: {
                select: {
                  key: true,
                  active: true,
                  entitlements: { select: { capabilityKey: true, enabled: true, meter: { select: { active: true } } } },
                },
              },
            },
          },
        },
      },
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
  const stamped = live ? { ...live, stamp: await assetReferences.stamp(projectId, live) } : null;
  if (!stamped || stamped.stamp !== null) liveChromeCache.set(projectId, stamped);
  return stamped;
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
  const liveConfig = projectConfigWithAddons(live.config, projectAddonRowsForDelivery(live.addons, live.organization.usagePlan));
  return {
    ...project,
    name: live.name,
    description: live.description,
    icon: live.icon,
    config: overlayLiveConfigPreservingPublishedRedirects(project.config, liveConfig),
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

const getProjectDeliveryAccess = async (projectId: string, headers: Headers): Promise<ViewerAccess | null> => {
  const live = await getLiveChrome(projectId).catch(() => null);
  if (!live || live.takedownAt) return null;
  return resolveViewerAccess(projectId, live.accessMode, headers);
};

/** Whether a viewer may read site-wide material that no page grant covers, such
 *  as the API reference and the release history. */
const hasSiteWideAccess = (viewer: ViewerAccess): boolean => viewer.allowedPageIds === null;

/** The live READY deployment and its frozen snapshot, or null when the project
 *  has nothing published. */
const loadDeploymentSnapshot = async (deployment: { id: string; version: number } | null): Promise<LiveDeployment | null> => {
  if (!deployment) return null;
  let frozen = snapshotCache.get(deployment.id);
  if (!frozen) {
    const row = await prisma.deployment.findUnique({ where: { id: deployment.id }, select: { snapshot: true } });
    if (!row?.snapshot) return null;
    frozen = row.snapshot as unknown as SiteSnapshot;
    snapshotCache.set(deployment.id, frozen);
  }
  return { id: deployment.id, version: deployment.version, frozen };
};

const findLiveDeployment = (projectId: string) =>
  prisma.deployment.findFirst({
    where: { projectId, status: 'READY' },
    orderBy: { version: 'desc' },
    select: { id: true, version: true },
  });

const loadLiveDeployment = async (projectId: string): Promise<LiveDeployment | null> => loadDeploymentSnapshot(await findLiveDeployment(projectId));

const findAssetDeployment = (projectId: string) =>
  prisma.deployment.findFirst({
    where: { projectId, status: 'READY' },
    orderBy: { version: 'desc' },
    select: assetHeadSelect,
  });

const readerReferencesAsset = async (
  projectId: string,
  deployment: AssetDeploymentHead,
  live: LiveChromeRow,
  key: string,
  grants: Set<string>,
): Promise<boolean> => {
  let index: PublishedAssetReferences | null = null;
  let legacy: SiteSnapshot | undefined;
  if (deployment.assetReferenceBytes) {
    index = await assetReferences.load(projectId, deployment.id, deployment.assetReferenceBytes, async () => {
      const row = await prisma.deployment.findUnique({ where: { id: deployment.id, projectId }, select: { assetReferenceIndex: true } });
      return (row?.assetReferenceIndex ?? null) as unknown as PublishedAssetReferences | null;
    });
    if (!index) return false;
  } else {
    // The migration measures legacy snapshots once. Oversized old deployments need republishing, not request-time scans.
    if (!assetReferences.canReadLegacy(deployment.assetSourceBytes, deployment.assetSourcePages)) return false;
    legacy = snapshotCache.get(deployment.id);
    if (!legacy) {
      if (!assetReferences.reserveRead(deployment.assetSourceBytes ?? 0)) return false;
      legacy = (await loadDeploymentSnapshot(deployment))?.frozen;
    }
    if (!legacy) return false;
  }
  const base = index?.chromeBase ?? legacy?.project;
  if (!base) return false;
  return assetReferences.allows({
    projectId,
    deploymentId: deployment.id,
    index,
    legacy,
    key,
    grants,
    chromeStamp: live.stamp,
    chrome: () => overlayLiveChrome(base, live),
  });
};

const findLiveDeploymentAfterMiss = (projectId: string, deploymentId: string) => {
  const cached = deploymentMissCache.get(projectId);
  if (cached?.deploymentId === deploymentId) return cached.lookup;
  const lookup = findLiveDeployment(projectId).catch((error: unknown) => {
    deploymentMissCache.delete(projectId);
    throw error;
  });
  deploymentMissCache.set(projectId, { deploymentId, lookup });
  return lookup;
};

/** Authorize one stored project asset. Site-wide viewers may load any asset of
 *  the project. A page-scoped reader may load only an asset referenced by the
 *  site chrome or by a page they are allowed to read in the live deployment; a
 *  reader without any effective grant may load none. */
/** Whether `key` is the logo or favicon a private site's sign-in screen shows
 *  to visitors who can't read the site yet. Only those exact configured
 *  branding files qualify; every other asset of the site stays private. */
export const isPrivateSiteBrandingAsset = async (projectId: string, key: string): Promise<boolean> => {
  const live = await getLiveChrome(projectId).catch(() => null);
  if (!live || live.takedownAt || live.accessMode === 'PUBLIC') return false;
  const branding = ((live.config ?? {}) as { branding?: Record<string, unknown> }).branding ?? {};
  return [branding.logoLight, branding.logoDark, branding.favicon].some((value) => {
    if (typeof value !== 'string' || !value) return false;
    try {
      return decodeURIComponent(new URL(value, 'http://branding.invalid').pathname) === `/api/public/assets/${key}`;
    } catch {
      return false;
    }
  });
};

export const getProjectAssetAccess = async (projectId: string, key: string, headers: Headers): Promise<ViewerAccess | null> => {
  const live = await getLiveChrome(projectId).catch(() => null);
  if (!live || live.takedownAt) return null;
  const viewer = await resolveViewerAccess(projectId, live.accessMode, headers);
  if (!viewer || hasSiteWideAccess(viewer)) return viewer;
  const allowedPageIds = viewer.allowedPageIds;
  if (!allowedPageIds || allowedPageIds.size === 0) return null;
  let deployment = assetDeploymentHeads.get(projectId);
  if (!deployment) {
    try {
      const current = await findAssetDeployment(projectId);
      if (!current) return null;
      deployment = current;
      assetDeploymentHeads.set(projectId, deployment);
    } catch {
      return null;
    }
  }
  try {
    if (await readerReferencesAsset(projectId, deployment, live, key, allowedPageIds)) return viewer;
    // Assets accept a 15s deployment lag; a miss checks READY metadata without extending removed-image exposure.
    const current = await findLiveDeploymentAfterMiss(projectId, deployment.id);
    if (!current) {
      assetDeploymentHeads.delete(projectId);
      return null;
    }
    if (current.id === deployment.id) return null;
    const fresh = await findAssetDeployment(projectId);
    if (!fresh) return null;
    assetDeploymentHeads.set(projectId, fresh);
    return (await readerReferencesAsset(projectId, fresh, live, key, allowedPageIds)) ? viewer : null;
  } catch {
    return null;
  }
};

/** What the sign-in screen of a private site may show a visitor who can't read
 *  it yet: the site's own name, logo and colours, its default language, and who
 *  can sign in. Never a page, title or anything else from its content. */
const privateSiteGate = (projectId: string, project: PublicSnapshotProject, acceptsRequests: boolean) => {
  const config = (project.config ?? {}) as { branding?: Record<string, unknown>; styling?: Record<string, unknown> };
  const branding = config.branding ?? {};
  const pick = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
  const language = project.languages.find((item) => item.isDefault) ?? project.languages[0];
  return {
    projectId,
    name: project.name,
    mode: project.accessMode,
    // Whether the sign-in screen offers "Ask for access".
    requests: project.accessMode === 'READERS' && acceptsRequests,
    language: language ? { code: language.code, direction: language.direction } : null,
    config: {
      branding: { logoLight: pick(branding.logoLight), logoDark: pick(branding.logoDark), favicon: pick(branding.favicon) },
      styling: config.styling ?? null,
    },
  };
};

const getPublished = async (identifier: string): Promise<PublishedSite> => {
  const projectId = await resolveProjectId(identifier);
  // Live chrome doubles as the moderation gate: a taken-down project stops
  // serving within the cache TTL (15s). notFound (not forbidden) so a taken
  // down site's existence is not advertised.
  const live = await getLiveChrome(projectId);
  if (!live || live.takedownAt) {
    throw notFound('site', { identifier, reason: live?.takedownAt ? 'takedown' : 'delivery_configuration_unavailable' });
  }
  const deployment = await loadLiveDeployment(projectId);
  if (!deployment) {
    throw notFound('site', { identifier, reason: 'not_published' });
  }
  const { frozen } = deployment;
  // Asset requests follow a deployment already observed by the page response, even inside the miss-lookup TTL.
  if (liveDeploymentCache.get(projectId)?.id !== deployment.id) {
    liveDeploymentCache.set(projectId, deployment);
    deploymentMissCache.delete(projectId);
    assetDeploymentHeads.delete(projectId);
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
  const accessMode = live.accessMode;
  const project: PublicSnapshotProject = {
    ...overlaid,
    // Keep the legacy config flag coherent for older clients and SEO helpers,
    // while the database enum remains the authorization source of truth.
    config: { ...(overlaid.config ?? {}), visibility: accessMode === 'PUBLIC' ? 'public' : 'private' },
    primaryDomain: live.domains[0]?.domain.toLowerCase() ?? null,
    accessMode,
  };
  const viewer = await resolveViewerAccess(projectId, live.accessMode, getContext<HonoEnv>().req.raw.headers);
  if (!viewer) {
    throw notFound('site', { identifier: projectId, reason: 'private', gate: privateSiteGate(projectId, project, live.readerAccessRequests) });
  }
  const pages = filterPagesForReader(frozen.pages, viewer.allowedPageIds);
  // No page grant covers the API reference, so only site-wide viewers get it.
  const openapi = hasSiteWideAccess(viewer) ? frozen.openapi : null;
  const snapshot: SiteSnapshot = { ...frozen, project, pages, openapi };
  return { snapshot: sanitizePublishedSiteActionUrls(snapshot), version: deployment.version, deploymentId: deployment.id, viewer };
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
  const { snapshot, deploymentId, version: deploymentVersion, viewer } = await getPublished(identifier);
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
    // Signed in on the site itself (never on a public site, whose shell is shared-cacheable).
    signedIn: viewer.siteSession === true,
    capabilities: {
      answer:
        resolvePublishedSearchRequest(snapshot.project.config, {}).configuration.aiAnswers &&
        (await answerSearchAvailable(snapshot.project.id, deploymentId)),
    },
  };
};

/** The immutable published OpenAPI document. This goes through the exact same
 *  publication, takedown, and private-site membership gates as pages, and is
 *  available only to site-wide viewers. */
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
      // Only an author-written summary is a visible lede. The derived excerpt
      // travels separately for SEO/social fallbacks, so the reader never renders
      // the page's own first paragraph twice.
      description: explicitPageDescription(page),
      excerpt: pageExcerpt(page),
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

/**
 * Canonical public Markdown representation for one published page.
 *
 * This deliberately fails closed for every credentialed/private surface. A
 * workspace member or invited reader may render HTML, but cannot turn private
 * or audience-restricted content into a crawlable Markdown response.
 */
export const getSitePageMarkdown = async (identifier: string, path: string, lang?: string, version?: string): Promise<SiteTextDocument> => {
  const data = await getSitePage(identifier, path, lang, version);
  const requestedLanguage = lang?.trim();
  if (requestedLanguage && data.activeLanguage !== requestedLanguage) {
    throw notFound('page', { path, language: requestedLanguage, reason: 'language_fallback' });
  }
  // A private site's page reached this point only for a viewer who may read it
  // (getSitePage applied the access gate and page grants): its Markdown is
  // theirs too, never shared-cached. Public sites keep the public-discovery rule.
  if ((data.project.config as { visibility?: string } | null)?.visibility === 'private') {
    return { body: buildPublishedPageMarkdown(data), isPrivate: true };
  }
  if (!isPublicMarkdownPage(data)) {
    throw notFound('page', { path, reason: 'not_public_markdown' });
  }
  return { body: buildPublishedPageMarkdown(data), isPrivate: false };
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

type LocalizedSearchHit = SearchHit & { language: string; section?: SearchHitSection };

/** Full-text + fuzzy search over a published site; records a search analytics event.
 *  The reader UI searches every published language. An explicit `lang` remains
 *  supported for API clients that intentionally want a single-language scope. */
export const searchSite = async (
  identifier: string,
  query: string,
  lang?: string,
  limit?: number,
  version?: string,
  analytics: { sessionId?: string; consentState?: ConsentState } = {},
  /** The reader's language: ranked first, without narrowing the search. */
  prefer?: string,
) => {
  const searchId = randomUUID();
  const analyticsStartedAt = performance.now();
  const { snapshot, deploymentId, viewer } = await getPublished(identifier);
  const request = resolvePublishedSearchContext(snapshot, { language: lang, version, limit });
  const docsVersion = request.version;
  const versionPages = pagesForVersion(snapshot, docsVersion);
  const resultLimit = request.limit;
  const requestedLanguages = resolvePublishedSearchLanguages(snapshot, lang);
  const perLanguage = await Promise.all(
    requestedLanguages.map(async (language) => {
      const scope: SearchScope = {
        projectId: snapshot.project.id,
        deploymentId,
        versionSlug: docsVersion.slug,
        language,
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
            language,
            versionPages,
            viewer.allowedPageIds,
          );
          return searchDocs(index, query, { limit: resultLimit });
        },
        getContext<HonoEnv>().req.raw.signal,
      );
      return { language, result };
    }),
  );
  const pageById = new Map(versionPages.map((page) => [page.id, page]));
  const hits: LocalizedSearchHit[] = mergeLanguageSearchHits(
    perLanguage,
    resultLimit,
    resolvePreferredSearchLanguage(snapshot, prefer) ?? request.language,
  ).map((hit) => {
    // Point the reader at the matching heading when the match is inside a
    // section, previewing that section rather than the page's first mention.
    const page = pageById.get(hit.id);
    const match = page ? matchedSearchSection(page, query, `${deploymentId}:${page.id}`) : undefined;
    return match ? { ...hit, section: match.section, snippet: match.snippet || hit.snippet } : hit;
  });
  // Empty or trimmed-out scopes did not produce these results. When there are
  // no hits, report the runtimes of every attempted scope instead.
  const returnedLanguages = new Set(hits.map((hit) => hit.language));
  const runtimes = new Set(
    perLanguage.filter(({ language }) => hits.length === 0 || returnedLanguages.has(language)).map(({ result }) => result.runtime),
  );
  const runtime = runtimes.size > 1 ? 'mixed' : ([...runtimes][0] ?? 'legacy');
  const analyticsLanguage = lang ? request.language : 'all';
  const latencyMs = Math.max(0, Math.round(performance.now() - analyticsStartedAt));
  const payloads: AnalyticsPayload[] = [
    { name: 'search_query_submitted', searchId, query: query.trim().slice(0, 200), language: analyticsLanguage },
    { name: 'search_results_returned', searchId, resultCount: hits.length, latencyMs, cacheStatus: 'unknown', language: analyticsLanguage },
    ...(hits.length === 0
      ? [
          {
            name: 'search_zero_result' as const,
            searchId,
            resultCount: 0,
            latencyMs,
            noAnswerReason: 'no_match' as const,
            language: analyticsLanguage,
          },
        ]
      : []),
  ];
  // One project lookup for the whole request, outside the search response path.
  // Settled-search SQL collapses typeahead rather than dropping short queries.
  const headers = getContext<HonoEnv>().req.raw.headers;
  void trackProjectEvents(snapshot.project.id, payloads, {
    source: 'public_site',
    consentState: analytics.consentState ?? 'unknown',
    sessionId: analytics.sessionId,
    userAgent: headers.get('user-agent') ?? undefined,
  }).catch(() => undefined);
  return {
    hits,
    searchId,
    runtime,
    capabilities: { answer: request.configuration.aiAnswers && (await answerSearchAvailable(snapshot.project.id, deploymentId)) },
  };
};

/** Reader-scoped grounded-answer context shared by one-shot answers and chat.
 * Tenant, deployment, version, language, visibility and page grants all come
 * from the server-resolved publication; the caller can only choose among the
 * published languages/versions, never widen the reader's scope. */
export const resolvePublishedAnswerContext = async (identifier: string, lang?: string, version?: string) => {
  const { snapshot, deploymentId, viewer } = await getPublished(identifier);
  const request = resolvePublishedSearchContext(snapshot, { language: lang, version });
  const available = request.configuration.aiAnswers && (await answerSearchAvailable(snapshot.project.id, deploymentId));
  const scope: SearchScope = {
    projectId: snapshot.project.id,
    deploymentId,
    versionSlug: request.version.slug,
    language: request.language,
    visibility: (snapshot.project as PublicSnapshotProject).accessMode === 'PUBLIC' ? 'public' : 'private',
    allowedPageIds: viewer.allowedPageIds,
  };
  // `snapshot.pages` is already filtered to the reader's grants.
  return { snapshot, deploymentId, request, scope, available, versionPages: pagesForVersion(snapshot, request.version) };
};

/** Grounded answer mode uses the exact same server-derived publication and
 * reader scope as results mode. The client cannot submit any tenant/page filter. */
export const answerSite = async (identifier: string, query: string, lang?: string, version?: string) => {
  const { snapshot, scope, available, versionPages } = await resolvePublishedAnswerContext(identifier, lang, version);
  if (!available) {
    throw new AppError({ code: 'search:unavailable', message: 'AI answers are not ready for this workspace.' });
  }
  const quota = await consumeAnswerQuota(snapshot.project.id).catch((cause) => {
    throw new AppError({ code: 'search:unavailable', message: 'AI answer quota service is unavailable.', cause });
  });
  if (!quota.allowed) {
    throw new AppError({ code: 'http:rate_limited', message: 'This site has reached its daily AI answer quota.' });
  }
  const answer = await answerPublishedSearch(scope, query, getContext<HonoEnv>().req.raw.signal, {
    languages: resolvePublishedSearchLanguages(snapshot),
    defaultLanguage: defaultLanguage(snapshot.project).code,
    pages: versionPages,
  }).catch((cause) => {
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

/** Release history describes the whole site, so a page-scoped reader cannot
 *  read it. */
const getPublishedReleaseHistory = async (identifier: string): Promise<PublishedSite> => {
  const published = await getPublished(identifier);
  if (!hasSiteWideAccess(published.viewer)) {
    throw notFound('changelog', { identifier: published.snapshot.project.id, reason: 'page_scoped_reader' });
  }
  return published;
};

/** Public changelog for a site, derived from its READY deployments (newest first). */
export const getSiteChangelog = async (identifier: string) => {
  // Load (and visibility-gate) the published site first so a private site's
  // release history isn't exposed to anonymous visitors.
  const { snapshot } = await getPublishedReleaseHistory(identifier);
  return changelogEntries(snapshot.project.id);
};

/** RSS 2.0 representation of the same immutable release history. The app edge
 * rebases internal /sites/:id URLs to a verified custom domain when present. */
export const getSiteChangelogRss = async (identifier: string): Promise<SiteTextDocument> => {
  const { snapshot } = await getPublishedReleaseHistory(identifier);
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
export const deviceFromUserAgent = (ua: string | null): string => {
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
      params: { sentiment, path: feedbackPath ?? null },
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
    occurredAt: body.occurredAt,
    userAgent: headers.get('user-agent') ?? undefined,
    siteHost: headers.get('origin') ?? undefined,
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
  return {
    body: `User-agent: OAI-SearchBot\nAllow: /\n\nUser-agent: *\nAllow: /\nSitemap: ${env.APP_URL}/api/public/sites/${projectId}/sitemap.xml\n`,
    isPrivate,
  };
};

/** llms.txt for a published site (llmstxt.org): title, description and a
 *  Markdown link list of every indexable page — so AI assistants can consume
 *  the docs without scraping. Anonymous visitors of private sites get 404 from
 *  getPublished; a signed-in reader or member gets the pages they can read. */
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
  // Built per request from this viewer's pages: never cached across viewers.
  if (isPrivate)
    return { body: buildLlmsTxt(publicSiteSnapshot(published), `${env.APP_URL}/sites/${published.project.id}`, { privateSite: true }), isPrivate };
  if (config?.seo?.allowIndex === false) {
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
 *  per-page headers and source URLs. Same access rules as llms.txt. */
export const getSiteLlmsFullTxt = async (identifier: string): Promise<SiteTextDocument> => {
  const { snapshot: published, deploymentId } = await getPublished(identifier);
  const config = seoConfigOf(published);
  const isPrivate = config?.visibility === 'private';
  // Built per request from this viewer's pages: never cached across viewers.
  if (isPrivate) {
    return {
      body: buildLlmsFullTxt(publicSiteSnapshot(published), `${env.APP_URL}/sites/${published.project.id}`, { privateSite: true }),
      isPrivate,
    };
  }
  if (config?.seo?.allowIndex === false) {
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

/** Used only by the authenticated internal collector / direct API observer.
 * Project identity is resolved here, never trusted as tenant context. */
export const recordCrawlerRequest = async (
  identifier: string,
  payload: AnalyticsPayload,
  options: { userAgent: string; eventId: string; occurredAt: string },
) => {
  const projectId = await resolveProjectId(identifier);
  if (await isProjectTakenDown(projectId)) return;
  await trackProjectEvent(projectId, payload, { ...options, source: 'public_site', consentState: 'unknown', device: 'bot' });
};
