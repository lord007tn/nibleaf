import { createDocIndex, type DocIndex, oramaLanguageForCode, type SearchDoc } from '@plume/search';
import { extractHeadings, type SnapshotPage } from '@plume/shared/site';

interface Entry {
  key: string;
  index: DocIndex;
}

// One in-memory Orama index per (project, language), keyed by the published
// deployment id so it rebuilds automatically when a new version is published.
const cache = new Map<string, Entry>();

const cacheKey = (projectId: string, lang: string): string => `${projectId}:${lang}`;

export const docsFromPages = (pages: SnapshotPage[]): SearchDoc[] =>
  pages
    .filter((page) => page.kind === 'PAGE' && !page.hidden)
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
 *  scoped to a single language. Legacy pages without a languageCode are indexed
 *  under whichever language is requested so old snapshots still search. */
export const getCachedIndex = async (projectId: string, key: string, lang: string, pages: SnapshotPage[]): Promise<DocIndex> => {
  const mapKey = cacheKey(projectId, lang);
  const existing = cache.get(mapKey);
  if (existing && existing.key === key) {
    return existing.index;
  }
  const scoped = pages.filter((page) => (page.languageCode || lang) === lang);
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
