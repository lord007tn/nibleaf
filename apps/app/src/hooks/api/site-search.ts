import { keepPreviousData, queryOptions, skipToken, useQuery } from '@tanstack/react-query';
import { searchSiteFn } from '@/functions/site-search';

/** Reader search query keys, under the reader's `['site', id]` namespace
 * (siteQueryKeys in site-query-options.ts). Kept with the lazily loaded search
 * hook so neither module loads the other. */
export const siteSearchQueryKeys = {
  search: (id: string, q: string, lang?: string, version?: string, limit?: number, prefer?: string) =>
    ['site', id, 'search', q, lang ?? null, version ?? null, limit ?? null, prefer ?? null] as const,
  /** Prefix of every reader search for one site, for invalidation. */
  all: (id: string) => ['site', id, 'search'] as const,
};

interface SiteSearchInput {
  siteId: string | undefined;
  query: string;
  language?: string;
  /** The reader's language: ranked first, without narrowing the search. */
  prefer?: string;
  version?: string;
  limit?: number;
}

/** Reader search results for one query. Lives with its hook (not in site-query-options.ts)
 * because only the lazily loaded search dialog uses it. */
const siteSearchQueryOptions = ({ siteId, query, language, prefer, version, limit }: SiteSearchInput) =>
  queryOptions({
    queryKey: siteSearchQueryKeys.search(siteId ?? '', query, language, version, limit, prefer),
    queryFn:
      siteId && query.trim()
        ? // The signal cancels the request once the reader has typed past it.
          ({ signal }) =>
            searchSiteFn({
              data: {
                projectId: siteId,
                query,
                ...(language ? { language } : {}),
                ...(prefer ? { prefer } : {}),
                ...(version ? { version } : {}),
                ...(limit ? { limit } : {}),
              },
              signal,
            })
        : skipToken,
  });

export const useSiteSearch = (
  siteId: string | undefined,
  query: string,
  { language, prefer, version, limit, enabled = true }: Omit<SiteSearchInput, 'siteId' | 'query'> & { enabled?: boolean } = {},
) =>
  useQuery({
    ...siteSearchQueryOptions({ siteId, query, language, prefer, version, limit }),
    enabled,
    // The last results stay on screen (dimmed) while the next query loads.
    placeholderData: keepPreviousData,
  });
