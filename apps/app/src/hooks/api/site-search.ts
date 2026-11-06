import { keepPreviousData, queryOptions, skipToken, useMutation, useQuery } from '@tanstack/react-query';
import { answerSiteFn, searchSiteFn } from '@/functions/site-search';
import { queryKeys } from './query-keys';

interface SiteSearchInput {
  siteId: string | undefined;
  query: string;
  language?: string;
  version?: string;
  limit?: number;
}

/** Reader search results for one query. Lives with its hook (not in site-query-options.ts)
 * because only the lazily loaded search dialog uses it. */
const siteSearchQueryOptions = ({ siteId, query, language, version, limit }: SiteSearchInput) =>
  queryOptions({
    queryKey: queryKeys.site.search(siteId ?? '', query, language, version, limit),
    queryFn:
      siteId && query.trim()
        ? // The signal cancels the request once the reader has typed past it.
          ({ signal }) =>
            searchSiteFn({
              data: {
                projectId: siteId,
                query,
                ...(language ? { language } : {}),
                ...(version ? { version } : {}),
                ...(limit ? { limit } : {}),
              },
              signal,
            })
        : skipToken,
  });

export const useSiteSearch = (siteId: string | undefined, query: string, language?: string, version?: string, limit?: number, enabled = true) =>
  useQuery({
    ...siteSearchQueryOptions({ siteId, query, language, version, limit }),
    enabled,
    // The last results stay on screen (dimmed) while the next query loads.
    placeholderData: keepPreviousData,
  });

export const useAnswerSite = () =>
  useMutation({
    mutationFn: (input: { projectId: string; query: string; language?: string; version?: string }) => answerSiteFn({ data: input }),
  });
