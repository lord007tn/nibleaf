import { createDocIndex, type DocIndex, oramaLanguageForCode, type SearchDoc } from '@nibleaf/search';
import { extractHeadings, type SnapshotPage } from '@nibleaf/shared/site';
import { LruCache } from './lru';

interface Entry {
  key: string;
  index: DocIndex;
}

/** Bound on live Orama indexes: they hold full page content, so an instance
 *  serving many sites/languages must evict cold ones instead of growing forever. */
const MAX_CACHED_INDEXES = 50;

// One in-memory Orama index per (project, language, docs-version, authorization
// scope), keyed by the published deployment id so it rebuilds automatically
// when a new version is published. The authorization scope is mandatory: a
// workspace member may index every page while a dedicated reader may see only a
// grant subset, and those indexes must never share one cache slot.
const cache = new LruCache<string, Entry>(MAX_CACHED_INDEXES);

const authorizationScopeKey = (allowedPageIds: ReadonlySet<string> | null): string => {
  if (allowedPageIds === null) return 'full';
  // Length-prefix each id so the representation is deterministic and cannot
  // collide through a delimiter embedded in an id.
  return `pages:${[...allowedPageIds]
    .sort()
    .map((id) => `${id.length}:${id}`)
    .join('')}`;
};

const cacheKey = (projectId: string, lang: string, version: string, allowedPageIds: ReadonlySet<string> | null): string =>
  `${projectId}:${lang}:${version}:${authorizationScopeKey(allowedPageIds)}`;

const docsFromPages = (pages: SnapshotPage[]): SearchDoc[] =>
  pages
    // Exclude pages we serve `<meta robots noindex>` for, so in-product search
    // never surfaces a page we've told crawlers to ignore.
    .filter((page) => page.kind === 'PAGE' && !page.hidden && !page.config?.seo?.noindex)
    .map((page) => ({
      id: page.id,
      title: page.title,
      path: page.path,
      description: page.description ?? '',
      // Include the sidebar label (if it differs from the title) so a search for
      // the short nav label still finds the page.
      headings: [page.config?.sidebarTitle?.trim(), ...extractHeadings(page.content).map((heading) => heading.text)].filter(Boolean).join(' '),
      content: page.content,
      icon: page.icon ?? undefined,
    }));

/** Get (or build) the cached search index for a project's published deployment,
 *  scoped to a single language. */
export const getCachedIndex = async (
  projectId: string,
  key: string,
  lang: string,
  pages: SnapshotPage[],
  allowedPageIds: ReadonlySet<string> | null,
): Promise<DocIndex> => {
  // `key` is `${deploymentId}:${versionSlug}` — the slug (no colons) scopes the
  // cache slot per version; the full key still triggers a rebuild on re-publish.
  const version = key.slice(key.indexOf(':') + 1) || 'main';
  const mapKey = cacheKey(projectId, lang, version, allowedPageIds);
  const existing = cache.get(mapKey);
  if (existing && existing.key === key) {
    return existing.index;
  }
  const scoped = pages.filter((page) => page.languageCode === lang);
  const index = await createDocIndex(docsFromPages(scoped), oramaLanguageForCode(lang));
  cache.set(mapKey, { key, index });
  return index;
};
