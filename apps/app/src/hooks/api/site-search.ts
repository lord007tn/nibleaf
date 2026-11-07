import { keepPreviousData, queryOptions, skipToken, useQuery } from '@tanstack/react-query';
import { searchSiteFn } from '@/functions/site-search';
import { queryKeys } from './query-keys';

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
    queryKey: queryKeys.site.search(siteId ?? '', query, language, version, limit, prefer),
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
