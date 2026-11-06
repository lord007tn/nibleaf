import { queryOptions, skipToken, useMutation, useQuery } from '@tanstack/react-query';
import { answerSiteFn, searchSiteFn } from '@/functions/site-search';
import { queryKeys } from './query-keys';

/*
 * Reader-site search. The factory lives here rather than in ./query-options
 * because it calls a server function (`@/functions/site-search`), which is not
 * part of the loader-safe API client.
 */

const siteSearchQueryOptions = (siteId: string | undefined, query: string, language?: string, version?: string, limit?: number) =>
  queryOptions({
    queryKey: queryKeys.site.search(siteId ?? '', query, language, version, limit),
    queryFn:
      siteId && query.trim()
        ? () =>
            searchSiteFn({
              data: {
                projectId: siteId,
                query,
                ...(language ? { language } : {}),
                ...(version ? { version } : {}),
                ...(limit ? { limit } : {}),
              },
            })
        : skipToken,
  });

export const useSiteSearch = (siteId: string | undefined, query: string, language?: string, version?: string, limit?: number, enabled = true) =>
  useQuery({ ...siteSearchQueryOptions(siteId, query, language, version, limit), enabled });

export const useAnswerSite = () =>
  useMutation({
    mutationFn: (input: { projectId: string; query: string; language?: string; version?: string }) => answerSiteFn({ data: input }),
  });
