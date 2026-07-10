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

// One in-memory Orama index per (project, language, docs-version), keyed by the
// published deployment id so it rebuilds automatically when a new version is
// published. Including the version in the slot keeps distinct docs versions from
// evicting each other when a reader switches versions. LRU-bounded: the least
// recently searched slot is dropped once the cap is hit.
const cache = new LruCache<string, Entry>(MAX_CACHED_INDEXES);

const cacheKey = (projectId: string, lang: string, version: string): string => `${projectId}:${lang}:${version}`;

export const docsFromPages = (pages: SnapshotPage[]): SearchDoc[] =>
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
export const getCachedIndex = async (projectId: string, key: string, lang: string, pages: SnapshotPage[]): Promise<DocIndex> => {
  // `key` is `${deploymentId}:${versionSlug}` — the slug (no colons) scopes the
  // cache slot per version; the full key still triggers a rebuild on re-publish.
  const version = key.slice(key.indexOf(':') + 1) || 'main';
  const mapKey = cacheKey(projectId, lang, version);
  const existing = cache.get(mapKey);
  if (existing && existing.key === key) {
    return existing.index;
  }
  const scoped = pages.filter((page) => page.languageCode === lang);
  const index = await createDocIndex(docsFromPages(scoped), oramaLanguageForCode(lang));
  cache.set(mapKey, { key, index });
  return index;
};

export const invalidateIndex = (projectId: string): void => {
  const prefix = `${projectId}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
};
